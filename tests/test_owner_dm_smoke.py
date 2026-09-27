"""単発試験の宛先・照合ID・結果不明時の再送禁止を検証する。"""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('owner_dm_smoke', Path(__file__).resolve().parents[1] / 'scripts/owner_dm_smoke.py')
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)

class OwnerSmokeTests(unittest.TestCase):
    def execute(self, request_id, post_error=False):
        client = Mock()
        client.auth_test.return_value = {'team_id': 'T1CSJ782K', 'user_id': 'U0B87Q9P99N'}
        def post(**kwargs):
            if post_error:
                raise TimeoutError('secret')
            return {'channel': kwargs['channel'], 'message': {'text': kwargs['text']}, 'ts': '1.2'}
        client.chat_postMessage.side_effect = post
        assistant = Mock(_storage_path=None)
        assistant.answer.return_value = ('資料による回答', [])
        output = io.StringIO()
        with patch.dict(smoke.os.environ, {'CLOCK_REQUEST_ID': request_id, 'SLACK_BOT_TOKEN': 'dummy', 'NOTEBOOKLM_NOTEBOOK_ID': 'ff4df3ed-ae9a-4684-a8d1-8b00a8833ba0'}), patch.object(smoke, 'WebClient', return_value=client), patch.object(smoke, 'AIAssistant', return_value=assistant), contextlib.redirect_stdout(output):
            result = smoke.main()
        return result, client, output.getvalue()

    def test_correlation_hash_and_fixed_dm(self):
        request_id = '11111111-1111-1111-1111-111111111111'
        result, client, output = self.execute(request_id)
        self.assertEqual(result, 0)
        client.chat_postMessage.assert_called_once()
        sent = client.chat_postMessage.call_args.kwargs
        self.assertEqual(sent['channel'], smoke.CHANNEL)
        self.assertIn(request_id, sent['text'])
        evidence = json.loads(output.split('DM_SENT ')[1])
        self.assertEqual(evidence['message_sha256'], hashlib.sha256(sent['text'].encode()).hexdigest())
        self.assertLessEqual(evidence['started_at'], evidence['answered_at'])
        self.assertLessEqual(evidence['answered_at'], evidence['posted_at'])

    def test_unknown_post_is_not_retried(self):
        result, client, output = self.execute('', post_error=True)
        self.assertEqual(result, 1)
        client.chat_postMessage.assert_called_once()
        self.assertNotIn('secret', output)
        self.assertNotIn('DM_SENT', output)

    def test_invalid_id_never_sends(self):
        result, client, _ = self.execute('invalid')
        self.assertEqual(result, 1)
        client.chat_postMessage.assert_not_called()
