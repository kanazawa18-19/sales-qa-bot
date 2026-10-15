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

    def test_poll_delay_has_margin_but_stalls_still_fail(self):
        for key, minutes in [('lastRun', 75), ('lastRecentCycle', 90)]:
            state = dict(self.state, **{key: (self.now - dt.timedelta(minutes=minutes)).isoformat()})
            self.assertEqual(monitor.assess(state, self.now), [])
            state[key] = (self.now - dt.timedelta(minutes=minutes, seconds=1)).isoformat()
            self.assertTrue(monitor.assess(state, self.now))

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


class NotificationTests(unittest.TestCase):
    def test_manual_success_notifies_but_clock_success_does_not(self):
        stamp = dt.datetime(2026, 10, 15, 3, tzinfo=dt.timezone.utc)
        for clock_id, count in [('', 1), ('clock-request', 0)]:
            with tempfile.TemporaryDirectory() as temp:
                cwd = os.getcwd()
                try:
                    os.chdir(temp)
                    ops = Mock()
                    ops.run_link.return_value = '\nrun-link'
                    with patch.object(sys, 'argv', ['monitor', '--notify']), patch.object(monitor, 'read_heartbeat', return_value={}), patch.object(monitor, 'assess', return_value=[]), patch.dict(sys.modules, {'runtime_ops': ops}), patch.dict(os.environ, {'GITHUB_EVENT_NAME': 'workflow_dispatch', 'CLOCK_REQUEST_ID': clock_id}), patch.object(monitor.dt, 'datetime', wraps=dt.datetime) as clock:
                        clock.now.return_value = stamp
                        self.assertEqual(monitor.main(), 0)
                    self.assertEqual(ops.notify.call_count, count)
                finally:
                    os.chdir(cwd)


class OutcomeTests(unittest.TestCase):
    def test_diagnosed_problem_only_succeeds_when_notification_completes(self):
        for notify, notice_failure, expected in [(False, False, 1), (True, False, 0), (True, True, 1)]:
            with tempfile.TemporaryDirectory() as temp:
                cwd = os.getcwd()
                try:
                    os.chdir(temp)
                    ops = Mock()
                    ops.run_link.return_value = '\nrun-link'
                    if notice_failure:
                        ops.notify.side_effect = RuntimeError('private-token')
                    with patch.object(sys, 'argv', ['monitor'] + (['--notify'] if notify else [])), patch.object(monitor, 'read_heartbeat', return_value={}), patch.object(monitor, 'assess', return_value=['資料更新の失敗継続または停滞']), patch.dict(sys.modules, {'runtime_ops': ops}):
                        self.assertEqual(monitor.main(), expected)
                    self.assertIn('資料更新の失敗継続または停滞', Path('monitor-evidence/health.json').read_text())
                finally:
                    os.chdir(cwd)

    def test_source_sync_stall_is_not_reported_as_clock_failure(self):
        fixture = MonitorTests()
        fixture.setUp()
        fixture.state['clock'].update(ok=False, code='CLOCK_SYNC_STALE')
        self.assertEqual(monitor.assess(fixture.state, fixture.now), ['資料更新の失敗継続または停滞'])


if __name__ == '__main__':
    unittest.main()
