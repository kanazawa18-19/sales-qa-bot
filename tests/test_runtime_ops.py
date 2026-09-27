"""実通信を置換し、古い認証の上書きと成功判定を検証する。"""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch, Mock

spec = importlib.util.spec_from_file_location('runtime_ops', Path(__file__).resolve().parents[1] / 'scripts/runtime_ops.py')
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)


class RuntimeTests(unittest.TestCase):
    def test_queued_secret_is_not_overwritten(self):
        with patch.dict(ops.os.environ, {'GITHUB_RUN_ID': '123'}), patch.object(ops, 'github', side_effect=[{'updated_at': '2026-09-27T01:00:01Z'}, {'created_at': '2026-09-27T01:00:00Z'}]), patch.object(ops, 'previous_refresh_runs', return_value=[]), patch.object(ops, 'notify'), patch.object(ops.subprocess, 'run') as run:
            self.assertEqual(ops.refresh(), 1)
            run.assert_not_called()

    def test_notification_failure_does_not_change_auth_success(self):
        old = '2026-09-01T00:00:00Z'
        with patch.dict(ops.os.environ, {'GITHUB_RUN_ID': '123', 'NOTEBOOKLM_STORAGE_JSON': '{}'}), patch.object(ops, 'github', side_effect=[{'updated_at': old}, {'created_at': old}, {'updated_at': old}, {'updated_at': '2099-01-01T00:00:00Z'}]), patch.object(ops.subprocess, 'run', return_value=Mock(stdout='{"status":"ok"}')), patch.object(ops, 'previous_refresh_runs', return_value=[]), patch.object(ops, 'notify', side_effect=RuntimeError):
            self.assertEqual(ops.refresh(), 0)

    def test_consecutive_auth_failure_does_not_repeat_dm(self):
        with patch.object(ops, 'github', side_effect=RuntimeError), patch.object(ops, 'previous_refresh_runs', return_value=[{'conclusion': 'failure'}]), patch.object(ops, 'notify') as notify:
            self.assertEqual(ops.refresh(), 1)
            notify.assert_not_called()

    def test_gas_clock_disables_only_dispatch(self):
        child = Mock()
        child.poll.return_value = None
        with patch.dict(ops.os.environ, {"AUTH_CLOCK_OWNER": "gas"}), patch.object(ops.subprocess, "Popen", return_value=child), patch.object(ops.time, "monotonic", side_effect=[0, 0, 0, 0, 0, 2]), patch.object(ops.time, "sleep"), patch.object(ops, "dispatch_refresh") as dispatch, patch.object(ops, "previous_refresh_runs", return_value=[]) as health:
            self.assertEqual(ops.supervise(duration=1), 0)
            dispatch.assert_not_called()
            health.assert_called_once()

    def test_rotation_stops_child(self):
        child = Mock()
        child.poll.return_value = None
        with patch.object(ops.subprocess, 'Popen', return_value=child):
            self.assertEqual(ops.supervise(duration=0), 0)
            child.terminate.assert_called_once()
            child.wait.assert_called_once()

    def test_early_exit_notifies_owner(self):
        child = Mock()
        child.poll.return_value = 1
        with patch.object(ops.subprocess, 'Popen', return_value=child), patch.object(ops, 'notify') as notify, patch.object(ops, 'github', return_value={'workflow_runs': []}), patch.object(ops.time, 'sleep'):
            self.assertEqual(ops.supervise(), 1)
            notify.assert_called_once()


if __name__ == '__main__':
    unittest.main()
