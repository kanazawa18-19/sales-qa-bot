"""停止・時刻異常を正常と判定しないことを外部通信なしで確認。"""
import datetime as dt
import importlib.util
from pathlib import Path
import unittest
import tempfile
import os
import sys
from unittest.mock import patch, Mock

spec = importlib.util.spec_from_file_location('gas_monitor', Path(__file__).resolve().parents[1] / 'scripts/gas_monitor.py')
monitor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(monitor)

class MonitorTests(unittest.TestCase):
    def setUp(self):
        self.now = dt.datetime(2026, 9, 27, tzinfo=dt.timezone.utc)
        stamp = self.now.isoformat()
        self.state = dict(schema=1, observedAt=stamp, lastRun=stamp,
                          lastRecentCycle=stamp, lastDeepCycle=stamp,
                          enabled=True, clockEnabled=True, pollTriggers=1, clockTriggers=1,
                          clock=dict(checkedAt=stamp, ok=True, lastAuthSuccess=stamp))

    def test_fresh(self):
        self.assertEqual(monitor.assess(self.state, self.now), [])

    def test_each_stale_signal_is_detected(self):
        for key in ['observedAt', 'lastRun', 'lastRecentCycle', 'lastDeepCycle']:
            state = dict(self.state, **{key:'2026-09-25T00:00:00Z'})
            self.assertTrue(monitor.assess(state, self.now), key)

    def test_missing_invalid_and_future_fail_closed(self):
        for value in [None, 'invalid', '2026-09-28T00:00:00Z']:
            self.assertTrue(monitor.assess(dict(self.state, observedAt=value), self.now))

    def test_clock_auth_trigger_budget_and_duration(self):
        for delta in [dict(clockEnabled=False), dict(pollTriggers=0), dict(clockTriggers=2),
                      dict(clock={}), dict(daily={'startedAt':self.now.timestamp()*1000,'ms':14400000}),
                      dict(health={'durationMs':120001}), dict(health={'status':'error'})]:
            self.assertTrue(monitor.assess(dict(self.state, **delta), self.now), delta)

    def test_read_failure_saves_evidence_and_notifies(self):
        with tempfile.TemporaryDirectory() as temp:
            cwd = os.getcwd()
            try:
                os.chdir(temp)
                ops = Mock()
                ops.run_link.return_value = '\nrun-link'
                with patch.object(sys, 'argv', ['monitor', '--notify']), patch.object(monitor, 'read_heartbeat', side_effect=RuntimeError('private-token')), patch.dict(sys.modules, {'runtime_ops':ops}):
                    self.assertEqual(monitor.main(), 1)
                saved = Path('monitor-evidence/health.json').read_text()
                self.assertNotIn('private-token', saved)
                ops.notify.assert_called_once()
                self.assertIn('run-link', ops.notify.call_args.args[0])
            finally:
                os.chdir(cwd)

if __name__ == '__main__':
    unittest.main()
