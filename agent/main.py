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
    import ctypes

    _EvtClose = None
    if hasattr(ctypes, "windll"):
        _EvtClose = ctypes.windll.wevtapi.EvtClose
except ImportError:
    _EvtClose = None


def close_evt_handle(handle):
    """Close event handle - works with or without pywin32's EvtClose"""
    if not handle:
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
            # With a small number of 4625 events this rarely triggers,
            # but protects against machines under sustained brute-force.
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

    def query_new_events(self):
        if not win32evtlog:
            logger.warning("Skipping event collection - not on Windows")
            return []

        # Simple EventID filter — Windows handles this fast.
        # Dedup layer filters out already-sent events in O(1) per event.
        query = f"*[System[EventID={self.event_id}]]"
        flags = win32evtlog.EvtQueryChannelPath | win32evtlog.EvtQueryReverseDirection

        query_handle = win32evtlog.EvtQuery("Security", flags, query)

        all_events = []

        try:
            while True:
                try:
                    handles = win32evtlog.EvtNext(query_handle, 50, -1, 0)
                except Exception:
                    break
                if not handles:
                    break

                for h in handles:
                    xml_string = win32evtlog.EvtRender(h, win32evtlog.EvtRenderEventXml)
                    try:
                        parsed = self.parse_event_xml(xml_string)
                        ip = parsed.get("ip_address") or "-"
                        if ip not in self._IGNORED_IPS:
                            all_events.append(parsed)
                    except Exception as exc:
                        logger.warning("Failed to parse event XML: %s", exc)

                # If all events in this batch are already seen, stop early.
                # Since we read newest-first (ReverseDirection), once we hit
                # events we've already processed, older ones are guaranteed seen too.
                if all_events:
                    batch_fps = [
                        self._event_fingerprint(ev)
                        for ev in all_events[-len(handles) :]
                    ]
                    if all(fp in self._seen_events for fp in batch_fps):
                        break
        finally:
            close_evt_handle(query_handle)

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
        logger.info("Polling every %d second(s)...", self.poll_interval)
        while True:
            try:
                events = self.query_new_events()
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
