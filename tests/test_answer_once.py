"""GAS直接受信キューからの単発回答で、関連判定・受付メッセージ・失敗時の扱いを検証する。"""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('answer_once', Path(__file__).resolve().parents[1] / 'scripts/answer_once.py')
answer_once = importlib.util.module_from_spec(spec)
spec.loader.exec_module(answer_once)

BASE_ENV = {
    'REQUEST_ID': '11111111-1111-1111-1111-111111111111',
    'SLACK_BOT_TOKEN': 'dummy',
    'AI_CHANNEL_ID': 'CAI',
    'OWNER_ONLY': 'false',
    'SLACK_TEAM_ID': 'T1',
    'SLACK_CHANNEL': 'CAI',
    'SLACK_TS': '100.1',
    'SLACK_THREAD_TS': '',
    'SLACK_EVENT_TYPE': 'message',
    'SLACK_USER': 'UASK',
    'SLACK_TEXT': '質問です',
}


class AnswerOnceTests(unittest.TestCase):
    def execute(self, env_overrides=None, answer_error=False, post_error=False, post_channel=None, post_ts='200.2'):
        env = {**BASE_ENV, **(env_overrides or {})}
        client = Mock()
        client.auth_test.return_value = {'team_id': 'T1', 'user_id': 'UBOT'}

        def post(**kwargs):
            if post_error:
                raise TimeoutError('secret')
            return {'ok': True, 'channel': post_channel or kwargs['channel'], 'ts': post_ts, 'message': {'text': kwargs['text']}}
        client.chat_postMessage.side_effect = post
        assistant = Mock(_storage_path=None)
        if answer_error:
            assistant.answer.side_effect = RuntimeError('secret')
        else:
            assistant.answer.return_value = ('資料による回答', [])
        output = io.StringIO()
        with patch.dict(answer_once.os.environ, env, clear=True), \
             patch.object(answer_once, 'WebClient', return_value=client), \
             patch.object(answer_once, 'AIAssistant', return_value=assistant), \
             contextlib.redirect_stdout(output):
            result = answer_once.main()
        return result, client, output.getvalue()

    def test_app_mention_anywhere_posts_generating_then_answer(self):
        result, client, output = self.execute({'SLACK_EVENT_TYPE': 'app_mention', 'SLACK_CHANNEL': 'COTHER', 'SLACK_TEXT': '<@UBOT> 質問'})
        self.assertEqual(result, 0)
        self.assertEqual(client.chat_postMessage.call_count, 2)
        texts = [c.kwargs['text'] for c in client.chat_postMessage.call_args_list]
        self.assertEqual(texts[0], '回答を生成中...')
        self.assertEqual(texts[1], '資料による回答')
        evidence = json.loads(output.split('ANSWER_SENT ')[1])
        self.assertEqual(evidence['request_id'], BASE_ENV['REQUEST_ID'])
        self.assertEqual(evidence['reply_ts'], '200.2')

    def test_top_level_ai_channel_message_answers_without_generating_notice(self):
        result, client, output = self.execute()
        self.assertEqual(result, 0)
        self.assertEqual(client.chat_postMessage.call_count, 1)
        self.assertIn('ANSWER_SENT', output)

    def test_mention_with_empty_text_sends_guidance_like_bot_py(self):
        result, client, output = self.execute({'SLACK_EVENT_TYPE': 'app_mention', 'SLACK_CHANNEL': 'COTHER', 'SLACK_TEXT': '<@UBOT>'})
        self.assertEqual(result, 0)
        client.chat_postMessage.assert_called_once()
        self.assertIn('質問を入力してください', client.chat_postMessage.call_args.kwargs['text'])
        self.assertIn('GUIDANCE_SENT', output)

    def test_mention_with_empty_text_under_owner_only_stays_silent(self):
        result, client, output = self.execute({
            'SLACK_EVENT_TYPE': 'app_mention', 'SLACK_CHANNEL': 'COTHER', 'SLACK_TEXT': '<@UBOT>',
            'OWNER_ONLY': 'true', 'OWNER_USER_ID': 'UOWNER', 'OWNER_DM_ID': 'DOWNER',
        })
        self.assertEqual(result, 0)
        client.chat_postMessage.assert_not_called()
        self.assertIn('SKIPPED', output)

    def test_mention_failure_message_matches_bot_py_handle_mention(self):
        result, client, output = self.execute({'SLACK_EVENT_TYPE': 'app_mention', 'SLACK_CHANNEL': 'COTHER', 'SLACK_TEXT': '<@UBOT> 質問'}, answer_error=True)
        self.assertEqual(result, 0)
        sent_text = client.chat_postMessage.call_args.kwargs['text']
        self.assertEqual(sent_text, '回答の生成に失敗しました。しばらくしてから再試行してください。')

    def test_thread_reply_in_ai_channel_is_skipped(self):
        result, client, output = self.execute({'SLACK_THREAD_TS': '90.0'})
        self.assertEqual(result, 0)
        client.chat_postMessage.assert_not_called()
        self.assertIn('SKIPPED', output)

    def test_message_outside_ai_channel_is_skipped(self):
        result, client, output = self.execute({'SLACK_CHANNEL': 'COTHER'})
        self.assertEqual(result, 0)
        client.chat_postMessage.assert_not_called()
        self.assertIn('SKIPPED', output)

    def test_owner_only_blocks_non_owner_even_for_mention(self):
        result, client, output = self.execute({
            'OWNER_ONLY': 'true', 'OWNER_USER_ID': 'UOWNER', 'OWNER_DM_ID': 'DOWNER',
            'SLACK_EVENT_TYPE': 'app_mention', 'SLACK_CHANNEL': 'COTHER',
        })
        self.assertEqual(result, 0)
        client.chat_postMessage.assert_not_called()
        self.assertIn('SKIPPED', output)

    def test_owner_only_allows_owner_dm(self):
        result, client, output = self.execute({
            'OWNER_ONLY': 'true', 'OWNER_USER_ID': 'UASK', 'OWNER_DM_ID': 'CAI',
        })
        self.assertEqual(result, 0)
        self.assertIn('ANSWER_SENT', output)

    def test_team_mismatch_never_posts(self):
        result, client, output = self.execute({'SLACK_TEAM_ID': 'TOTHER'})
        self.assertEqual(result, 1)
        client.chat_postMessage.assert_not_called()
        self.assertNotIn('secret', output)

    def test_notebooklm_failure_still_sends_a_failure_reply(self):
        result, client, output = self.execute(answer_error=True)
        self.assertEqual(result, 0)
        sent_text = client.chat_postMessage.call_args.kwargs['text']
        self.assertEqual(sent_text, '回答の生成に失敗しました。')
        self.assertNotIn('secret', output)

    def test_unverified_post_is_failure_and_hides_exception_text(self):
        result, client, output = self.execute(post_error=True)
        self.assertEqual(result, 1)
        self.assertNotIn('secret', output)
        self.assertNotIn('ANSWER_SENT', output)

    def test_wrong_destination_channel_is_not_success(self):
        result, client, output = self.execute(post_channel='COTHER')
        self.assertEqual(result, 1)
        self.assertNotIn('ANSWER_SENT', output)


if __name__ == '__main__':
    unittest.main()
