"""HTTP境界・重複配送・送信結果不明時の安全性を検証する。"""
import hashlib
import hmac
import json
from pathlib import Path
import sys
import time
import unittest
from unittest.mock import Mock
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from http_app.domain import Policy, Work, plan
from http_app.receiver import create_receiver
from http_app.worker import Worker
from http_app.cloud import FirestoreStore


class MemoryStore(FirestoreStore):
    def __init__(self):
        self.data = {}
    def _change(self, key, fn):
        result, update = fn(self.data.get(key, {}))
        if update is not None:
            self.data.setdefault(key, {}).update(update)
        return result


class Queue:
    def __init__(self):
        self.items = {}
    def enqueue(self, work):
        self.items[work.key] = work


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.policy = Policy('TTEST', 'UBOT', 'DTEST', owner_user='UOWNER', owner_dm='DTEST')
        self.event = {'type': 'event_callback', 'team_id': 'TTEST', 'event_id': 'Ev1',
                      'event': {'type': 'message', 'channel': 'DTEST', 'user': 'UOWNER', 'ts': '100.001', 'text': '<@UBOT> 質問'}}
        self.queue = Queue()
        self.client = create_receiver('fake-signing-secret', self.policy, self.queue).test_client()
    def post(self, body=None, age=0, invalid=False):
        body = json.dumps(self.event if body is None else body, ensure_ascii=False).encode()
        ts = str(int(time.time()) - age)
        sig = 'v0=' + hmac.new(b'fake-signing-secret', b'v0:' + ts.encode() + b':' + body, hashlib.sha256).hexdigest()
        return self.client.post('/slack/events', data=body, content_type='application/json', headers={
            'X-Slack-Request-Timestamp': ts, 'X-Slack-Signature': 'invalid' if invalid else sig})
    def test_signed_challenge(self):
        response = self.post({'type': 'url_verification', 'challenge': 'test'})
        self.assertEqual(response.json, {'challenge': 'test'})
    def test_invalid_signature_and_replay_rejected(self):
        self.assertEqual(self.post(invalid=True).status_code, 401)
        self.assertEqual(self.post(age=301).status_code, 401)
        self.assertFalse(self.queue.items)
    def test_ack_only_after_queue_persisted(self):
        self.queue.enqueue = Mock(side_effect=TimeoutError)
        self.assertEqual(self.post().status_code, 503)
    def test_duplicate_event_and_mention_one_work(self):
        self.assertEqual(self.post().status_code, 200)
        self.post()
        self.event['event_id'] = 'Ev2'
        self.event['event']['type'] = 'app_mention'
        self.post()
        self.assertEqual(len(self.queue.items), 1)
    def test_owner_only_and_own_bot_filter(self):
        for user in ['UOTHER', 'UBOT']:
            self.event['event']['user'] = user
            self.post()
        self.assertFalse(self.queue.items)
    def test_thread_reply_not_automatic_answer(self):
        self.event['event']['thread_ts'] = '90.000'
        self.assertEqual(plan(self.event, self.policy), [])
        self.event['event']['type'] = 'app_mention'
        self.assertEqual(plan(self.event, self.policy)[0].thread_ts, '90.000')
    def test_workflow_blocks_and_other_bot_are_supported(self):
        policy = Policy('TTEST', 'UBOT', 'DTEST', owner_only=False)
        self.event['event'].update(text='', user='UWORKFLOW', bot_id='BOTHER', blocks=[{'type':'section','text':{'type':'mrkdwn','text':'質問本文'}}])
        self.assertEqual(plan(self.event, policy)[0].text, '質問本文')
    def test_send_timeout_never_posts_again(self):
        work = plan(self.event, self.policy)[0]
        store, send = MemoryStore(), Mock(side_effect=TimeoutError)
        worker = Worker(store, Mock(return_value='回答'), send, Mock())
        self.assertEqual(worker.process(work), 200)
        self.assertEqual(worker.process(work), 200)
        self.assertEqual(send.call_count, 1)
    def test_answer_failure_can_retry_without_post(self):
        work = plan(self.event, self.policy)[0]
        send = Mock(return_value='123.000')
        worker = Worker(MemoryStore(), Mock(side_effect=[TimeoutError(), '回答']), send, Mock())
        self.assertEqual(worker.process(work), 503)
        self.assertEqual(worker.process(work), 200)
        self.assertEqual(worker.process(work), 200)
        send.assert_called_once()
    def test_lease_prevents_parallel_processing(self):
        store = MemoryStore()
        self.assertEqual(store.claim('key', 'owner1', 100), 'claimed')
        self.assertEqual(store.claim('key', 'owner2', 200), 'busy')
        self.assertEqual(store.claim('key', 'owner2', 500), 'claimed')
        with self.assertRaises(RuntimeError):
            store.posting('key', 'owner1', now=200)
    def test_crash_after_posting_is_quarantined(self):
        store = MemoryStore()
        store.claim('key', 'owner1', 100)
        store.posting('key', 'owner1', now=200)
        self.assertEqual(store.claim('key', 'owner2', 200), 'busy')
        self.assertEqual(store.claim('key', 'owner2', 500), 'uncertain')
    def test_queue_saved_but_ack_lost_is_idempotent(self):
        enqueue = self.queue.enqueue
        def lost_ack(item):
            enqueue(item)
            raise TimeoutError()
        self.queue.enqueue = lost_ack
        self.assertEqual(self.post().status_code, 503)
        self.queue.enqueue = enqueue
        self.assertEqual(self.post().status_code, 200)
        self.assertEqual(len(self.queue.items), 1)

    def test_expiring_lease_cannot_post(self):
        store = MemoryStore()
        store.claim('key', 'owner', 100)
        with self.assertRaises(RuntimeError):
            store.posting('key', 'owner', now=410)

    def test_auth_recovery_resets_alert(self):
        store = MemoryStore()
        store.claim('auth', 'owner', 100)
        self.assertTrue(store.reserve_alert('auth'))
        self.assertFalse(store.reserve_alert('auth'))
        self.assertTrue(store.reserve_alert('auth', 'uncertain'))
        store.finish('auth', 'owner', 'retry', alert_states=[])
        self.assertTrue(store.reserve_alert('auth'))


if __name__ == '__main__':
    unittest.main()
