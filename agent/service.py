"""
Windows Service wrapper for SecurityEventAgent.

Usage (run as Administrator):
    python service.py install      Install the service
    python service.py start        Start the service
    python service.py stop         Stop the service
    python service.py remove       Uninstall the service
    python service.py restart      Restart the service

Or use standard Windows tools after install:
    net start SecurityMonitorAgent
    net stop SecurityMonitorAgent
    services.msc  → SecurityMonitorAgent → Properties → Startup Type: Automatic

The service runs under the Local System account by default.
To change, use services.msc → Log On tab.
"""

import os
import sys
import yaml

import win32serviceutil
import win32service
import servicemanager

# Ensure the working directory is the agent folder so config.yaml
# and _seen.json are found correctly.
_AGENT_DIR = os.path.dirname(os.path.abspath(__file__))
os.chdir(_AGENT_DIR)

from main import SecurityEventAgent, _setup_logging, logger


class SecurityMonitorService(win32serviceutil.ServiceFramework):
    """Windows Service that runs the SecurityEventAgent."""

    _svc_name_ = "SecurityMonitorAgent"
    _svc_display_name_ = "Security Monitor Agent"
    _svc_description_ = (
        "Monitors Windows Security Event Log for failed login attempts "
        "(Event ID 4625) and sends them to the central collector."
    )

    def __init__(self, args):
        win32serviceutil.ServiceFramework.__init__(self, args)
        self._agent = None

    def SvcStop(self):
        """Called by the SCM when the service is asked to stop."""
        self.ReportServiceStatus(win32service.SERVICE_STOP_PENDING)
        logger.info("Service stop requested by SCM")

        # Signal the agent to exit its main loop
        if self._agent:
            self._agent.stop()

    def SvcDoRun(self):
        """Called by the SCM when the service starts."""
        self.ReportServiceStatus(win32service.SERVICE_RUNNING)

        servicemanager.LogMsg(
            servicemanager.EVENTLOG_INFORMATION_TYPE,
            servicemanager.PYS_SERVICE_STARTED,
            (self._svc_name_, ""),
        )

        try:
            self._run_agent()
        except Exception as exc:
            logger.exception("Service crashed: %s", exc)
            servicemanager.LogErrorMsg(f"SecurityMonitorAgent crashed: {exc}")

        servicemanager.LogMsg(
            servicemanager.EVENTLOG_INFORMATION_TYPE,
            servicemanager.PYS_SERVICE_STOPPED,
            (self._svc_name_, ""),
        )

    def _run_agent(self):
        """Load config, set up logging, and run the agent."""
        config_path = os.path.join(_AGENT_DIR, "config.yaml")

        try:
            with open(config_path) as f:
                config = yaml.safe_load(f)
        except Exception as exc:
            logger.error("Cannot load %s: %s", config_path, exc)
            servicemanager.LogErrorMsg(
                f"SecurityMonitorAgent: Cannot load config.yaml: {exc}"
            )
            return

        # Set up log rotation
        log_cfg = config.get("logging", {})
        _setup_logging(
            log_file=log_cfg.get("file", os.path.join(_AGENT_DIR, "agent.log")),
            max_bytes=log_cfg.get("max_bytes", 5 * 1024 * 1024),
            backup_count=log_cfg.get("backup_count", 3),
        )

        logger.info("Service starting agent...")
        self._agent = SecurityEventAgent(config)
        self._agent.run()
        logger.info("Service agent exited.")


if __name__ == "__main__":
    if len(sys.argv) == 1:
        # Started by the SCM — not from command line
        servicemanager.Initialize()
        servicemanager.PrepareToHostSingle(SecurityMonitorService)
        servicemanager.StartServiceCtrlDispatcher()
    else:
        # Command line: install / start / stop / remove / restart
        win32serviceutil.HandleCommandLine(SecurityMonitorService)
