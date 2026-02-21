import time
import logging
import hashlib
import socket
import os
import collections
import json
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


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
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
        Uses the event's actual SystemTime + ip + username + source_port.
        Two real attacks at different times will have different SystemTime
        values, so they will always be treated as distinct events.
        """
        parts = (
            parsed.get("timestamp") or "",
            parsed.get("ip_address") or "",
            parsed.get("username") or "",
            parsed.get("source_port") or "",
        )
        return hashlib.sha256("|".join(parts).encode()).hexdigest()[:16]

    @staticmethod
    def parse_event_xml(xml_string):
        root = ET.fromstring(xml_string)
        data = {}
        for item in root.findall(".//e:Data", EVT_NS):
            name = item.get("Name")
            if name:
                data[name] = item.text
        time_created = root.find(".//e:TimeCreated", EVT_NS)
        return {
            "timestamp": time_created.get("SystemTime")
            if time_created is not None
            else None,
            "ip_address": data.get("IpAddress"),
            "username": data.get("TargetUserName"),
            "domain": data.get("TargetDomainName"),
            "logon_type": data.get("LogonType"),
            "status": data.get("Status"),
            "workstation": data.get("WorkstationName"),
            "source_port": data.get("IpPort"),
        }

    # IPs that should be ignored (localhost / loopback noise)
    _IGNORED_IPS = frozenset({"-", "::1", "127.0.0.1", "0.0.0.0"})

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
                    ip = parsed.get("ip_address") or "-"
                    if ip not in self._IGNORED_IPS:
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
                        ip = parsed.get("ip_address") or "-"
                        if ip not in self._IGNORED_IPS:
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
        payload = {
            "vm_id": self.vm_id,
            "hostname": self.hostname,
            "events": events,
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

    def run(self):
        logger.info("Agent started  vm_id=%s  hostname=%s", self.vm_id, self.hostname)

        if not win32evtlog or not win32event or not win32con:
            logger.error("Cannot run: win32evtlog/win32event/win32con not available")
            return

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
            while True:
                try:
                    result = win32event.WaitForSingleObject(
                        self._signal_event, wait_timeout_ms
                    )

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
                        # DIAG: Also try pulling directly from the subscription
                        # to detect if events are there but signal isn't firing.
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
                        time.sleep(self.poll_interval)

                except Exception as exc:
                    logger.exception("Error in subscription loop: %s", exc)
                    time.sleep(self.poll_interval)
        finally:
            self._cleanup_subscription()

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
        while True:
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
            time.sleep(self.poll_interval)


if __name__ == "__main__":
    import yaml

    try:
        with open("config.yaml") as f:
            config = yaml.safe_load(f)
        agent = SecurityEventAgent(config)
        agent.run()
    except KeyboardInterrupt:
        print("Agent stopped manually.")
