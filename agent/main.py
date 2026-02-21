import time
import logging
import socket
import json
import os
import collections
import requests
from datetime import datetime
import xml.etree.ElementTree as ET

try:
    import win32evtlog
except ImportError:
    win32evtlog = None
    print("Warning: win32evtlog is not available. Please run on Windows.")

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
)
logger = logging.getLogger(__name__)

# XML namespace used in Windows event XML
EVT_NS = {'e': 'http://schemas.microsoft.com/win/2004/08/events/event'}

class SecurityEventAgent:
    """
    Monitors local Windows Security Event Log for Event ID 4625
    (failed logon) and sends normalized events to the central
    collector API.
    """
    def __init__(self, config):
        self.vm_id = config['vm_id']
        self.collector_url = config['collector_url']
        self.poll_interval = config.get('poll_interval', 2)
        self.event_id = config.get('event_id', 4625)
        self.hostname = socket.gethostname()

        self._retry_queue = collections.deque(maxlen=5000)
        self._bookmark_path = f"{self.vm_id}_bookmark.xml"
        self._bookmark = self._load_bookmark()

    def _load_bookmark(self):
        if not win32evtlog: return None
        if os.path.exists(self._bookmark_path):
            try:
                with open(self._bookmark_path, 'r') as f:
                    xml_text = f.read().strip()
                if xml_text:
                    return win32evtlog.EvtCreateBookmark(xml_text)
            except Exception:
                logger.warning("Could not load bookmark; starting from now")
        return None

    def _save_bookmark(self, bookmark_handle):
        if not win32evtlog: return
        xml_text = win32evtlog.EvtRender(bookmark_handle, win32evtlog.EvtRenderBookmark)
        with open(self._bookmark_path, 'w') as f:
            f.write(xml_text)

    @staticmethod
    def parse_event_xml(xml_string):
        root = ET.fromstring(xml_string)
        data = {}
        for item in root.findall('.//e:Data', EVT_NS):
            name = item.get('Name')
            if name:
                data[name] = item.text
        time_created = root.find('.//e:TimeCreated', EVT_NS)
        return {
            'timestamp': time_created.get('SystemTime') if time_created is not None else None,
            'ip_address': data.get('IpAddress'),
            'username': data.get('TargetUserName'),
            'domain': data.get('TargetDomainName'),
            'logon_type': data.get('LogonType'),
            'status': data.get('Status'),
            'workstation': data.get('WorkstationName'),
            'source_port': data.get('IpPort'),
        }

    def query_new_events(self):
        if not win32evtlog:
            logger.warning("Skipping event collection - not on Windows")
            return []

        query = f"*[System[EventID={self.event_id}]]"
        flags = win32evtlog.EvtQueryChannelPath | win32evtlog.EvtQueryForwardDirection
        query_handle = win32evtlog.EvtQuery('Security', flags, query)

        if self._bookmark is not None:
            try:
                win32evtlog.EvtSeek(query_handle, 1, self._bookmark, win32evtlog.EvtSeekRelativeToBookmark)
            except Exception:
                logger.debug("Bookmark seek failed; reading from start")

        new_events = []
        last_handle = None

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
                    if parsed.get('ip_address') and parsed['ip_address'] != '-':
                        new_events.append(parsed)
                except Exception as exc:
                    logger.warning("Failed to parse event XML: %s", exc)
                last_handle = h

        if last_handle is not None:
            self._bookmark = win32evtlog.EvtCreateBookmark(None)
            win32evtlog.EvtUpdateBookmark(self._bookmark, last_handle)
            self._save_bookmark(self._bookmark)

        return new_events

    def send_events(self, events):
        payload = {
            'vm_id': self.vm_id,
            'hostname': self.hostname,
            'events': events,
        }
        try:
            response = requests.post(self.collector_url, json=payload, verify=False, timeout=10)
            if response.status_code == 200:
                logger.info("Sent %d event(s) to collector", len(events))
                return True
            else:
                logger.error("Collector returned HTTP %d", response.status_code)
        except Exception as e:
            logger.error("Failed to reach collector: %s", e)

        self._retry_queue.extend(events)
        return False

    def _flush_retry_queue(self):
        if not self._retry_queue: return
        batch = list(self._retry_queue)
        self._retry_queue.clear()
        logger.info("Retrying %d queued event(s)...", len(batch))
        self.send_events(batch)

    def run(self):
        logger.info("Agent started  vm_id=%s  hostname=%s", self.vm_id, self.hostname)
        logger.info("Polling every %d second(s)...", self.poll_interval)
        while True:
            try:
                events = self.query_new_events()
                if events:
                    for ev in events:
                        logger.info("Failed login: user=%s  ip=%s", ev.get('username'), ev.get('ip_address'))
                    self.send_events(events)
                self._flush_retry_queue()
            except Exception as exc:
                logger.exception("Unexpected error: %s", exc)
            time.sleep(self.poll_interval)

if __name__ == '__main__':
    import yaml
    try:
        with open('config.yaml') as f:
            config = yaml.safe_load(f)
        agent = SecurityEventAgent(config)
        agent.run()
    except KeyboardInterrupt:
        print("Agent stopped manually.")
