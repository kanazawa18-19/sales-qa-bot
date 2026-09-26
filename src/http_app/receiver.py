"""受信確認はキューへの保存後に返し、回答生成はここでは実行しない。"""
import hashlib
import hmac
import json
import time
from flask import Flask, request
from .domain import plan


def valid_signature(raw, timestamp, signature, secret, now=None):
    try:
        if abs((time.time() if now is None else now) - int(timestamp)) > 300:
            return False
    except (ValueError, TypeError):
        return False
    expected = "v0=" + hmac.new(secret.encode(), b"v0:" + timestamp.encode() + b":" + raw, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected.encode(), signature.encode("utf-8", "replace"))


def create_receiver(secret, policy, queue):
    if not secret or not policy.team_id or not policy.bot_user_id:
        raise ValueError("RECEIVER_CONFIGURATION_REQUIRED")
    if policy.owner_only and (not policy.owner_user or not policy.owner_dm):
        raise ValueError("OWNER_ONLY_CONFIGURATION_REQUIRED")
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = 1024 * 1024

    @app.get("/healthz")
    def health():
        return {"role": "slack_receiver", "owner_only": policy.owner_only}

    @app.post("/slack/events")
    def receive():
        raw = request.get_data()
        if not valid_signature(raw, request.headers.get("X-Slack-Request-Timestamp", ""),
                               request.headers.get("X-Slack-Signature", ""), secret):
            return "unauthorized", 401
        try:
            envelope = json.loads(raw)
            if not isinstance(envelope, dict):
                return "invalid", 400
            if envelope.get("type") == "url_verification":
                challenge = envelope.get("challenge")
                return ({"challenge": challenge}, 200) if isinstance(challenge, str) else ("invalid", 400)
            work = plan(envelope, policy)
        except (ValueError, TypeError, AttributeError):
            return "invalid", 400
        try:
            for item in work:
                queue.enqueue(item)
        except Exception:
            # 保存できなければSlackに再送してもらう。部分保存もキーで重複防止。
            return "temporarily unavailable", 503
        return "", 200

    return app
