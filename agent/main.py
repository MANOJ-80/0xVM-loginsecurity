import time
import threading
import logging
import logging.handlers
import hashlib
import socket
import os
import sys
import collections
import json
from datetime import datetime, timezone
import requests
import xml.etree.ElementTree as ET

try:
    import win32evtlog
except ImportError:
    win32evtlog = None
    print("Warning: win32evtlog is not available. Please run on Windows.")

try:
    import win32event
    import win32con
except ImportError:
    win32event = None
    win32con = None
    print("Warning: win32event is not available. Please run on Windows.")

try:
    import ctypes

    _EvtClose = None
    if hasattr(ctypes, "windll"):
        _EvtClose = ctypes.windll.wevtapi.EvtClose
except ImportError:
    _EvtClose = None


def close_evt_handle(handle):
    """Close event handle - works with or without pywin32's EvtClose"""
    if handle is None:
        return
    if win32evtlog and hasattr(win32evtlog, "EvtClose"):
        try:
            win32evtlog.EvtClose(handle)
            return
        except Exception:
            pass
    if _EvtClose:
        try:
            _EvtClose(handle)
        except Exception:
            pass


LOG_FORMAT = "%(asctime)s [%(levelname)s] %(message)s"


def _runtime_dir():
    """
    Return the directory that should hold config/log/state files.

    - Frozen exe (PyInstaller): directory of the exe.
    - Python source run: directory of this file.
    """
    if getattr(sys, "frozen", False):
        return os.path.dirname(os.path.abspath(sys.executable))
    return os.path.dirname(os.path.abspath(__file__))


def _load_config(config_path):
    """Load YAML config from disk."""
    import yaml

    with open(config_path, "r", encoding="utf-8") as f:
        config = yaml.safe_load(f)
    return config or {}


def _setup_logging(log_file="agent.log", max_bytes=5 * 1024 * 1024, backup_count=3):
    """
    Configure logging with both console and rotating file output.

    Defaults: 5 MB per file, 3 backups → max ~20 MB disk usage.
    The file handler rotates automatically when the current log
    exceeds max_bytes; old files are named agent.log.1, .2, .3.

    Safe to call multiple times — clears existing handlers first.
    """
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.handlers.clear()

    fmt = logging.Formatter(LOG_FORMAT)

    # Console handler (always present so the user can watch live)
    console = logging.StreamHandler()
    console.setFormatter(fmt)
    root.addHandler(console)

    # Rotating file handler
    try:
        file_handler = logging.handlers.RotatingFileHandler(
            log_file,
            maxBytes=max_bytes,
            backupCount=backup_count,
            encoding="utf-8",
        )
        file_handler.setFormatter(fmt)
        root.addHandler(file_handler)
    except Exception as e:
        # If we can't open the log file (permissions, path issues),
        # fall back to console-only and warn.
        root.warning("Could not set up log file '%s': %s", log_file, e)


# Basic console-only logging until _setup_logging() is called from __main__
logging.basicConfig(level=logging.INFO, format=LOG_FORMAT)
logger = logging.getLogger(__name__)

# XML namespace used in Windows event XML
EVT_NS = {"e": "http://schemas.microsoft.com/win/2004/08/events/event"}


class SecurityEventAgent:
    """
    Monitors local Windows Security Event Log for Event ID 4625
    (failed logon) and sends normalized events to the central
    collector API.

    Uses EvtSubscribe with a pull-model (SignalEvent) for real-time
    event detection — the OS signals the agent the instant a matching
    event is written to the log.
    """

    def __init__(self, config):
        self.vm_id = config["vm_id"]
        self.collector_url = config["collector_url"]
        self.poll_interval = config.get("poll_interval", 10)
        self.event_id = config.get("event_id", 4625)
        self.hostname = socket.gethostname()

        self._retry_queue = collections.deque(maxlen=5000)

        # Dedup: track fingerprints of events we already sent
        self._seen_path = f"{self.vm_id}_seen.json"
        self._seen_events = self._load_seen()

        # Subscription handles (set in run())
        self._signal_event = None
        self._subscription_handle = None

        # Graceful shutdown flag — set by stop() or Windows Service manager
        self._stop_event = threading.Event()

    def stop(self):
        """Signal the agent to shut down gracefully."""
        logger.info("Stop requested — shutting down...")
        self._stop_event.set()
        # Also wake the WaitForSingleObject call immediately so the
        # main loop doesn't block for up to poll_interval seconds.
        if self._signal_event and win32event:
            try:
                win32event.SetEvent(self._signal_event)
            except Exception:
                pass

    # Maximum number of fingerprints to keep in the seen set.
    # Prevents unbounded memory growth on long-running agents.
    _MAX_SEEN = 50_000

    def _load_seen(self):
        """Load set of already-sent event fingerprints from disk."""
        if os.path.exists(self._seen_path):
            try:
                with open(self._seen_path, "r") as f:
                    data = json.load(f)
                if isinstance(data, list):
                    # Keep only the most recent entries if file is oversized
                    return set(data[-self._MAX_SEEN :])
            except Exception:
                logger.warning("Could not load seen events file; starting fresh")
        return set()

    def _save_seen(self):
        """Persist seen fingerprints to disk so restarts don't re-send."""
        try:
            # Cap the set to prevent unbounded growth on disk/memory.
            if len(self._seen_events) > self._MAX_SEEN:
                trimmed = list(self._seen_events)[-self._MAX_SEEN :]
                self._seen_events = set(trimmed)

            with open(self._seen_path, "w") as f:
                json.dump(list(self._seen_events), f)
        except Exception as e:
            logger.warning("Could not save seen events: %s", e)

    @staticmethod
    def _event_fingerprint(parsed):
        """
        Create a unique fingerprint for a Windows event.
        Uses the event's raw UTC SystemTime + ip + username + source_port.
        Two real attacks at different times will have different SystemTime
        values, so they will always be treated as distinct events.

        IMPORTANT: Always use _raw_utc (the original UTC string from the
        event XML) — never the converted local timestamp.  This keeps
        fingerprints stable across timezone changes and preserves
        compatibility with existing _seen.json files.
        """
        parts = (
            parsed.get("_raw_utc") or "",
            parsed.get("ip_address") or "",
            parsed.get("username") or "",
            parsed.get("source_port") or "",
        )
        return hashlib.sha256("|".join(parts).encode()).hexdigest()[:16]

    @staticmethod
    def _utc_to_local(utc_string):
        """
        Convert a Windows SystemTime UTC string to local time string.
        Input:  '2026-02-21T16:42:04.7999016Z'
        Output: '2026-02-21T22:12:04.7999016' (for IST, UTC+5:30)
        """
        if not utc_string:
            return None
        try:
            # Windows SystemTime has 7-digit fractional seconds; Python
            # only handles 6.  Trim to 6 for parsing, but preserve the
            # original precision in the output string.
            clean = utc_string.rstrip("Z")
            orig_frac = "0"
            if "." in clean:
                date_part, orig_frac = clean.split(".", 1)
                parse_frac = orig_frac[:6]
                clean = f"{date_part}.{parse_frac}"
            else:
                clean = clean + ".0"
            dt_utc = datetime.strptime(clean, "%Y-%m-%dT%H:%M:%S.%f")
            dt_utc = dt_utc.replace(tzinfo=timezone.utc)
            dt_local = dt_utc.astimezone()  # converts to system local tz
            return dt_local.strftime("%Y-%m-%dT%H:%M:%S.") + orig_frac
        except Exception:
            return utc_string  # fallback: return original if parsing fails

    @staticmethod
    def parse_event_xml(xml_string):
        root = ET.fromstring(xml_string)
        data = {}
        for item in root.findall(".//e:Data", EVT_NS):
            name = item.get("Name")
            if name:
                data[name] = item.text
        time_created = root.find(".//e:TimeCreated", EVT_NS)
        raw_utc = time_created.get("SystemTime") if time_created is not None else None
        # SubStatus has the specific failure reason (e.g. 0xC0000064 = no
        # such user, 0xC000006A = wrong password).  Status is always the
        # generic 0xC000006D ("logon failure") and is useless on its own.
        # We send SubStatus as `status` so the backend stores the useful
        # code in failure_reason.  Fall back to Status if SubStatus is
        # missing or zero.
        sub = data.get("SubStatus")
        primary = data.get("Status")
        reason = sub if (sub and sub != "0x0") else primary

        return {
            "timestamp": SecurityEventAgent._utc_to_local(raw_utc),
            "_raw_utc": raw_utc,  # kept for fingerprinting (dedup)
            "ip_address": data.get("IpAddress"),
            "username": data.get("TargetUserName"),
            "domain": data.get("TargetDomainName"),
            "logon_type": data.get("LogonType"),
            "status": reason,
            "workstation": data.get("WorkstationName"),
            "source_port": data.get("IpPort"),
        }

    # IPs that should be ignored (localhost / loopback noise).
    # NOTE: Local GUI failed logons often use IpAddress "-" with
    # interactive logon types (2/7). Those are allowed separately.
    _IGNORED_IPS = frozenset({"-", "::1", "127.0.0.1", "0.0.0.0"})
    _ALLOW_DASH_IP_LOGON_TYPES = frozenset({"2", "7"})

    @classmethod
    def _should_include_event(cls, parsed):
        """
        Decide whether an event should be kept after XML parsing.

        Keep remote events with a real source IP.
        Also keep local interactive GUI failures where Windows reports
        IpAddress as "-" (common for local console/unlock attempts).
        """
        ip = (parsed.get("ip_address") or "-").strip()
        if ip not in cls._IGNORED_IPS:
            return True

        if ip == "-":
            logon_type = str(parsed.get("logon_type") or "").strip()
            if logon_type in cls._ALLOW_DASH_IP_LOGON_TYPES:
                return True

        return False

    def _create_subscription(self):
        """
        Create an EvtSubscribe pull-subscription on the Security log.

        Uses EvtSubscribeToFutureEvents so we only get events that occur
        after the subscription is created. On first startup, existing
        events are already in _seen_events (loaded from disk). On fresh
        installs, we do a one-time historical scan first (see run()).

        Returns (signal_event, subscription_handle).
        """
        query = f"*[System[EventID={self.event_id}]]"

        # Manual-reset event (2nd param=True): stays signaled until we
        # explicitly reset it. This avoids a race where auto-reset could
        # consume the signal before we call EvtNext.
        signal_event = win32event.CreateEvent(None, True, False, None)

        # pywin32 EvtSubscribe signature:
        #   EvtSubscribe(ChannelPath, Flags, SignalEvent, Callback,
        #                Context, Query, Session, Bookmark)
        subscription_handle = win32evtlog.EvtSubscribe(
            "Security",
            win32evtlog.EvtSubscribeToFutureEvents,
            signal_event,
            None,  # Callback (not used in pull mode)
            None,  # Context
            query,
        )

        logger.info(
            "EvtSubscribe created: signal_event=%s, subscription=%s",
            signal_event,
            subscription_handle,
        )

        return signal_event, subscription_handle

    def _pull_events_from_subscription(self):
        """
        Pull all available events from the subscription handle.
        Returns a list of parsed, deduped, IP-filtered event dicts
        ready to send.
        """
        if not self._subscription_handle:
            return []

        all_events = []

        while True:
            try:
                # Timeout=0: return immediately with whatever is available.
                # Do NOT use -1 (INFINITE) here — on a subscription handle,
                # EvtNext with INFINITE timeout will block forever waiting
                # for more events once the buffered ones are consumed.
                handles = win32evtlog.EvtNext(self._subscription_handle, 50, 0, 0)
            except Exception:
                break
            if not handles:
                break

            for h in handles:
                try:
                    xml_string = win32evtlog.EvtRender(h, win32evtlog.EvtRenderEventXml)
                    parsed = self.parse_event_xml(xml_string)
                    if self._should_include_event(parsed):
                        all_events.append(parsed)
                except Exception as exc:
                    logger.warning("Failed to parse event XML: %s", exc)
                finally:
                    # We own these handles in pull mode — must close them
                    close_evt_handle(h)

        # --- Dedup: only return events we haven't sent before ---
        new_events = []
        for ev in all_events:
            fp = self._event_fingerprint(ev)
            if fp not in self._seen_events:
                new_events.append(ev)
                self._seen_events.add(fp)

        if all_events:
            logger.info(
                "Read %d event(s) from log, %d are new (unseen)",
                len(all_events),
                len(new_events),
            )

        # Persist seen set after filtering
        if new_events:
            self._save_seen()

        return new_events

    def _scan_existing_events(self):
        """
        One-time scan of existing 4625 events at startup.
        Uses EvtQuery with ReverseDirection + early-exit on seen events
        to quickly catch any events that were generated while the agent
        was offline.
        """
        query = f"*[System[EventID={self.event_id}]]"
        flags = win32evtlog.EvtQueryChannelPath | win32evtlog.EvtQueryReverseDirection

        try:
            query_handle = win32evtlog.EvtQuery("Security", flags, query)
        except Exception as e:
            logger.error("EvtQuery failed during startup scan: %s", e)
            return []

        all_events = []

        try:
            while True:
                try:
                    handles = win32evtlog.EvtNext(query_handle, 50, -1, 0)
                except Exception:
                    break
                if not handles:
                    break

                batch_start = len(all_events)

                for h in handles:
                    try:
                        xml_string = win32evtlog.EvtRender(
                            h, win32evtlog.EvtRenderEventXml
                        )
                        parsed = self.parse_event_xml(xml_string)
                        if self._should_include_event(parsed):
                            all_events.append(parsed)
                    except Exception as exc:
                        logger.warning("Failed to parse event XML: %s", exc)
                    finally:
                        close_evt_handle(h)

                # Early exit: newest-first, so once a full batch is seen,
                # everything older is guaranteed seen too.
                batch_events = all_events[batch_start:]
                if batch_events:
                    batch_fps = [self._event_fingerprint(ev) for ev in batch_events]
                    if all(fp in self._seen_events for fp in batch_fps):
                        break
        finally:
            close_evt_handle(query_handle)

        # --- Dedup ---
        new_events = []
        for ev in all_events:
            fp = self._event_fingerprint(ev)
            if fp not in self._seen_events:
                new_events.append(ev)
                self._seen_events.add(fp)

        if all_events:
            logger.info(
                "Startup scan: %d event(s) in log, %d are new (unseen)",
                len(all_events),
                len(new_events),
            )

        if new_events:
            self._save_seen()

        return new_events

    def send_events(self, events, is_retry=False):
        # Strip internal-only fields before sending to the collector.
        # _raw_utc is used for fingerprinting but the backend doesn't
        # know about it (and Pydantic would reject the extra field).
        clean_events = [
            {k: v for k, v in ev.items() if k != "_raw_utc"} for ev in events
        ]
        payload = {
            "vm_id": self.vm_id,
            "hostname": self.hostname,
            "events": clean_events,
        }
        try:
            response = requests.post(
                self.collector_url, json=payload, verify=False, timeout=30
            )
            if response.status_code == 200:
                logger.info("Sent %d event(s) to collector", len(events))
                return True
            else:
                logger.error("Collector returned HTTP %d", response.status_code)
        except Exception as e:
            logger.error("Failed to reach collector: %s", e)

        if not is_retry:
            self._retry_queue.extend(events)
        return False

    def _flush_retry_queue(self):
        if not self._retry_queue:
            return
        batch = list(self._retry_queue)
        logger.info("Retrying %d queued event(s)...", len(batch))
        success = self.send_events(batch, is_retry=True)
        if success:
            self._retry_queue.clear()

    def _register_with_collector(self):
        """
        Register this VM with the collector on startup so it appears in
        GET /api/v1/vms.  Best-effort: logs a warning on failure but
        never blocks the agent from running.
        """
        try:
            # Derive base URL from collector_url (strip /api/v1/events)
            base = self.collector_url
            if base.endswith("/events"):
                base = base[: -len("/events")]
            elif base.endswith("/events/"):
                base = base[: -len("/events/")]
            register_url = f"{base}/vms"

            # Get local IP — use the IP of the interface that routes to
            # the collector.  Falls back to 0.0.0.0 if detection fails.
            local_ip = "0.0.0.0"
            try:
                s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                s.connect(("8.8.8.8", 80))
                local_ip = s.getsockname()[0]
                s.close()
            except Exception:
                pass

            payload = {
                "vm_id": self.vm_id,
                "hostname": self.hostname,
                "ip_address": local_ip,
                "collection_method": "agent",
            }
            resp = requests.post(register_url, json=payload, verify=False, timeout=10)
            if resp.status_code == 200:
                logger.info(
                    "Registered with collector: vm_id=%s  ip=%s",
                    self.vm_id,
                    local_ip,
                )
            else:
                logger.warning(
                    "Registration returned HTTP %d: %s",
                    resp.status_code,
                    resp.text[:200],
                )
        except Exception as e:
            logger.warning("Could not register with collector: %s", e)

    def run(self):
        logger.info("Agent started  vm_id=%s  hostname=%s", self.vm_id, self.hostname)

        if not win32evtlog or not win32event or not win32con:
            logger.error("Cannot run: win32evtlog/win32event/win32con not available")
            return

        # --- Phase 0: Register with collector ---
        self._register_with_collector()

        # --- Phase 1: Scan for events generated while agent was offline ---
        logger.info("Scanning existing events...")
        try:
            missed_events = self._scan_existing_events()
            if missed_events:
                for ev in missed_events:
                    logger.info(
                        "Failed login: user=%s  ip=%s",
                        ev.get("username"),
                        ev.get("ip_address"),
                    )
                self.send_events(missed_events)
        except Exception as exc:
            logger.exception("Startup scan failed: %s", exc)

        # --- Phase 2: Subscribe for real-time events ---
        try:
            self._signal_event, self._subscription_handle = self._create_subscription()
        except Exception as exc:
            logger.exception("EvtSubscribe failed: %s", exc)
            logger.error(
                "Falling back to polling mode (poll_interval=%ds)",
                self.poll_interval,
            )
            self._run_polling_fallback()
            return

        logger.info("Real-time subscription active (EvtSubscribe)")

        # --- Diagnostic: verify event handle plumbing works ---
        # Manually signal the event and check if WaitForSingleObject sees it.
        # This isolates whether the issue is our event handle or EvtSubscribe.
        win32event.SetEvent(self._signal_event)
        diag = win32event.WaitForSingleObject(self._signal_event, 0)
        if diag == win32con.WAIT_OBJECT_0:
            logger.info(
                "DIAG: Manual SetEvent -> WaitForSingleObject works (handle plumbing OK)"
            )
            win32event.ResetEvent(self._signal_event)
            # Drain any events that arrived between subscription creation and now
            self._pull_events_from_subscription()
        else:
            logger.error(
                "DIAG: Manual SetEvent failed! WaitForSingleObject returned %d", diag
            )

        # Use poll_interval as the WaitForSingleObject timeout (in ms).
        # This means: wake instantly on new events, but also wake every
        # poll_interval seconds to flush retry queue if needed.
        wait_timeout_ms = self.poll_interval * 1000

        try:
            while not self._stop_event.is_set():
                try:
                    result = win32event.WaitForSingleObject(
                        self._signal_event, wait_timeout_ms
                    )

                    if self._stop_event.is_set():
                        break

                    if result == win32con.WAIT_OBJECT_0:
                        # Signal fired — new events available
                        logger.info(
                            "Signal received — pulling events from subscription"
                        )
                        # Reset the manual-reset event before pulling,
                        # so any events arriving during pull will re-signal.
                        win32event.ResetEvent(self._signal_event)
                        events = self._pull_events_from_subscription()
                        if events:
                            for ev in events:
                                logger.info(
                                    "Failed login: user=%s  ip=%s",
                                    ev.get("username"),
                                    ev.get("ip_address"),
                                )
                            self.send_events(events)
                        elif self._retry_queue:
                            self._flush_retry_queue()

                    elif result == win32con.WAIT_TIMEOUT:
                        # Timeout — no new events via signal.
                        # Also try pulling directly from the subscription
                        # to detect if events are there but signal isn't firing.
                        # On some pywin32 builds the SignalEvent never fires
                        # even though EvtNext returns events just fine.
                        events = self._pull_events_from_subscription()
                        if events:
                            logger.warning(
                                "DIAG: Signal did NOT fire, but %d event(s) "
                                "found by direct pull! EvtSubscribe signaling "
                                "is broken on this system.",
                                len(events),
                            )
                            for ev in events:
                                logger.info(
                                    "Failed login: user=%s  ip=%s",
                                    ev.get("username"),
                                    ev.get("ip_address"),
                                )
                            self.send_events(events)
                        elif self._retry_queue:
                            self._flush_retry_queue()

                    else:
                        # WAIT_FAILED or WAIT_ABANDONED — unexpected
                        logger.error(
                            "WaitForSingleObject returned unexpected: %d",
                            result,
                        )
                        self._stop_event.wait(self.poll_interval)

                except Exception as exc:
                    logger.exception("Error in subscription loop: %s", exc)
                    self._stop_event.wait(self.poll_interval)
        finally:
            self._cleanup_subscription()
            logger.info("Agent stopped cleanly.")

    def _cleanup_subscription(self):
        """Release subscription and signal event handles."""
        if self._subscription_handle:
            close_evt_handle(self._subscription_handle)
            self._subscription_handle = None
        if self._signal_event:
            try:
                win32event.CloseHandle(self._signal_event)
            except Exception:
                pass
            self._signal_event = None

    def _run_polling_fallback(self):
        """
        Fallback polling loop if EvtSubscribe is unavailable.
        Uses the same EvtQuery approach from previous versions.
        """
        logger.info("Polling every %d second(s)...", self.poll_interval)
        while not self._stop_event.is_set():
            try:
                events = self._scan_existing_events()
                if events:
                    for ev in events:
                        logger.info(
                            "Failed login: user=%s  ip=%s",
                            ev.get("username"),
                            ev.get("ip_address"),
                        )
                    self.send_events(events)
                elif self._retry_queue:
                    self._flush_retry_queue()
            except Exception as exc:
                logger.exception("Unexpected error: %s", exc)
            self._stop_event.wait(self.poll_interval)

def _run_console():
    """Entry point for running the agent in console mode (dev / direct run)."""
    import signal

    base_dir = _runtime_dir()
    os.chdir(base_dir)

    config = _load_config(os.path.join(base_dir, "config.yaml"))

    log_cfg = config.get("logging", {})
    log_file = log_cfg.get("file") or os.path.join(base_dir, "agent.log")
    _setup_logging(
        log_file=log_file,
        max_bytes=log_cfg.get("max_bytes", 5 * 1024 * 1024),
        backup_count=log_cfg.get("backup_count", 3),
    )

    agent = SecurityEventAgent(config)

    def _shutdown(signum, frame):
        agent.stop()

    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)
    if hasattr(signal, "SIGBREAK"):
        signal.signal(signal.SIGBREAK, _shutdown)

    agent.run()
    print("Agent stopped.")


if __name__ == "__main__":
    _run_console()
