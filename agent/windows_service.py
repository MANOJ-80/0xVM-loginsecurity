import logging
import os
import sys
import traceback

import servicemanager
import win32service
import win32serviceutil

from main import SecurityEventAgent, _load_config, _runtime_dir, _setup_logging


class SecurityMonitorService(win32serviceutil.ServiceFramework):
    _svc_name_ = "SecurityMonitorAgent"
    _svc_display_name_ = "Security Monitor Agent"
    _svc_description_ = (
        "Monitors Windows Security Event Log (Event ID 4625) and sends "
        "failed login events to the central collector API."
    )

    def __init__(self, args):
        super().__init__(args)
        self._agent = None
        self._base_dir = _runtime_dir()

    def SvcStop(self):
        self.ReportServiceStatus(win32service.SERVICE_STOP_PENDING)
        logging.info("SCM requested service stop.")
        if self._agent:
            self._agent.stop()

    def SvcDoRun(self):
        os.chdir(self._base_dir)
        config_path = os.path.join(self._base_dir, "config.yaml")

        try:
            config = _load_config(config_path)
            log_cfg = config.get("logging", {})
            log_file = log_cfg.get("file") or os.path.join(self._base_dir, "agent.log")
            _setup_logging(
                log_file=log_file,
                max_bytes=log_cfg.get("max_bytes", 5 * 1024 * 1024),
                backup_count=log_cfg.get("backup_count", 3),
            )
        except Exception as exc:
            servicemanager.LogErrorMsg(
                f"SecurityMonitorAgent failed before run: {exc}\n{traceback.format_exc()}"
            )
            return

        self.ReportServiceStatus(win32service.SERVICE_RUNNING)
        servicemanager.LogInfoMsg("SecurityMonitorAgent service started.")

        try:
            self._agent = SecurityEventAgent(config)
            self._agent.run()
        except Exception:
            logging.exception("Service crashed.")
            servicemanager.LogErrorMsg(
                "SecurityMonitorAgent crashed:\n" + traceback.format_exc()
            )
            raise
        finally:
            servicemanager.LogInfoMsg("SecurityMonitorAgent service stopped.")


if __name__ == "__main__":
    # Service binary started by SCM (no args): host service class.
    # Command-line usage for debug/install style commands stays available.
    if len(sys.argv) == 1:
        servicemanager.Initialize()
        servicemanager.PrepareToHostSingle(SecurityMonitorService)
        servicemanager.StartServiceCtrlDispatcher()
    else:
        win32serviceutil.HandleCommandLine(SecurityMonitorService)
