"""署名付きHTTP受信→NotebookLM→本人DM返信を1回検証。Slack受信先は変更しない。"""
import hashlib
import hmac
import json
import logging
import os
from pathlib import Path
import secrets
import sys
import threading
import time
import requests
from werkzeug.serving import make_server

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
sys.path.insert(0, str(ROOT / 'tests'))
from ai_assistant import AIAssistant
from http_app.adapters import SlackIO
from http_app.domain import Policy
from http_app.receiver import create_receiver
from http_app.worker import Worker
from test_http_app import MemoryStore, Queue


def main():
    logging.disable(logging.CRITICAL)
    channel, owner, bot, team = 'D0B87Q9U54G', 'U03JFKXG6C8', 'U0B87Q9P99N', 'T1CSJ782K'
    question = 'ホテルラボはどのようなサービスですか？資料に基づいて簡潔に教えてください。'
    slack = SlackIO(os.environ['SLACK_BOT_TOKEN'], bot, team)
    policy = Policy(team, bot, channel, owner_user=owner, owner_dm=channel)
    queue, secret = Queue(), secrets.token_hex(32)
    app = create_receiver(secret, policy, queue)
    server = make_server('127.0.0.1', 0, app)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    ai = AIAssistant()
    try:
        parent = slack.client.chat_postMessage(channel=channel, text='【HTTP受信方式テスト】\n'+question+'\n署名付きの模擬イベントで受信処理とNotebookLMの実回答を確認します。')
        event = {'type':'event_callback','team_id':team,'event_id':'test-'+secrets.token_hex(8),
                 'event':{'type':'message','user':owner,'channel':channel,'ts':parent['ts'],'text':question}}
        raw = json.dumps(event,ensure_ascii=False).encode()
        ts = str(int(time.time()))
        signature = 'v0='+hmac.new(secret.encode(),b'v0:'+ts.encode()+b':'+raw,hashlib.sha256).hexdigest()
        url = f'http://127.0.0.1:{server.server_port}/slack/events'
        start = time.monotonic()
        for _ in range(2):
            response = requests.post(url,data=raw,headers={'Content-Type':'application/json','X-Slack-Request-Timestamp':ts,'X-Slack-Signature':signature},timeout=3)
            response.raise_for_status()
        elapsed = time.monotonic()-start
        if len(queue.items) != 1:
            raise RuntimeError('DUPLICATE_WORK')
        count = []
        def send(work,answer):
            reply = slack.send(work, answer)
            count.append(reply)
            return reply
        def alert(text,key,work=None,state="retry"):
            raise RuntimeError('HTTP_WORKER_FAILED')
        worker = Worker(MemoryStore(), lambda question: ai.answer(question,[])[0], send, alert)
        work = next(iter(queue.items.values()))
        if worker.process(work) != 200 or worker.process(work) != 200 or len(count) != 1:
            raise RuntimeError('HTTP_WORKER_FAILED')
        print(f'HTTP_OWNER_SMOKE_OK channel={channel} parent={parent["ts"]} reply={count[0]} ack_two_requests_seconds={elapsed:.3f}')
    finally:
        server.shutdown()
        if ai._storage_path:
            Path(ai._storage_path).unlink(missing_ok=True)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('HTTP_OWNER_SMOKE_FAILED（秘密情報保護のため例外本文は非表示）')
        sys.exit(1)
