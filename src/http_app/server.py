"""Cloud Runの起動点。受信サービスと非公開ワーカーを同じイメージから作る。"""
import logging
import os
import re
import time
import uuid
from flask import Flask, request
from .domain import Policy, Work
from .receiver import create_receiver


def policy_from_env():
    return Policy(team_id=os.environ["SLACK_TEAM_ID"], bot_user_id=os.environ["BOT_USER_ID"],
                  ai_channel=os.environ["AI_CHANNEL_ID"],
                  owner_only=os.environ.get("OWNER_ONLY", "true") != "false",
                  owner_user=os.environ.get("OWNER_USER_ID", ""), owner_dm=os.environ.get("OWNER_DM_ID", ""))


def create_app():
    from .cloud import TaskQueue, FirestoreStore
    from .adapters import Secrets, NotebookAnswers, SlackIO
    from .worker import Worker
    project = os.environ["GOOGLE_CLOUD_PROJECT"]
    policy = policy_from_env()
    logging.getLogger("notebooklm").setLevel(logging.CRITICAL)
    if os.environ.get("HTTP_ROLE") == "receiver":
        queue = TaskQueue(project, os.environ["TASKS_REGION"], os.environ["TASKS_QUEUE"],
                          os.environ["WORKER_URL"], os.environ["TASKS_SERVICE_ACCOUNT"])
        return create_receiver(os.environ["SLACK_SIGNING_SECRET"], policy, queue)
    if os.environ.get("HTTP_ROLE") != "worker":
        raise ValueError("HTTP_ROLE_REQUIRED")
    secrets = Secrets(project)
    store = FirestoreStore(project)
    notebook = NotebookAnswers(secrets, os.environ["NOTEBOOKLM_NOTEBOOK_ID"])
    slack = SlackIO(os.environ["SLACK_BOT_TOKEN"], policy.bot_user_id, policy.team_id)
    def alert(text, key, work=None, state="retry"):
        if store.reserve_alert(key, state):
            link = (f"https://app.slack.com/archives/{work.channel}/p{work.thread_ts.replace('.', '')}" if work else "")
            slack.client.chat_postMessage(channel=policy.owner_dm,
                text=f"Sales QA Bot：{text}\n{link}\n処理ID: {key}", unfurl_links=False)
    worker = Worker(store, notebook, slack.send, alert)
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = 1024 * 1024

    def authorized():
        # Cloud Run IAMに加えて呼出元とaudienceを検証する。ヘッダー名だけでは信頼しない。
        from google.oauth2 import id_token
        from google.auth.transport.requests import Request
        bearer = request.headers.get("Authorization", "")
        if not bearer.startswith("Bearer "):
            return False
        try:
            claims = id_token.verify_oauth2_token(bearer[7:], Request(), os.environ["WORKER_URL"])
            return claims.get("email_verified") is True and claims.get("email") == os.environ["TASKS_SERVICE_ACCOUNT"]
        except Exception:
            return False

    @app.get("/healthz")
    def health():
        return {"role": "worker", "owner_only": policy.owner_only}

    @app.post("/tasks/process")
    def process():
        if not authorized():
            return "unauthorized", 401
        try:
            data = request.get_json()
            work = Work(**data)
            if not re.fullmatch(r"[0-9a-f]{64}", work.key) or work.kind != "answer":
                return "invalid", 400
            if policy.owner_only and work.channel != policy.owner_dm:
                return "forbidden", 403
        except (TypeError, ValueError):
            return "invalid", 400
        try:
            return "", worker.process(work)
        except Exception:
            return "temporarily unavailable", 503

    @app.post("/tasks/refresh-auth")
    def refresh():
        if not authorized():
            return "unauthorized", 401
        key, owner = "notebooklm-auth-refresh", str(uuid.uuid4())
        state = store.claim(key, owner, time.time())
        if state == "busy":
            return "busy", 503
        try:
            notebook.refresh()
            store.finish(key, owner, "retry", last_success=time.time(), alert_states=[])
            return "", 200
        except Exception:
            store.fail(key, owner)
            try:
                alert("NotebookLMの認証更新に失敗しました。再ログインが必要になる場合があります。", key)
            except Exception:
                pass
            return "temporarily unavailable", 503

    return app
