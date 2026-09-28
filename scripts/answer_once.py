"""GASのHTTP直接受信キューから渡された1件だけをNotebookLMで回答する。常駐botは起動しない。
採否の最終判断はhttp_app.domain.plan()（既存のCloud HTTP受信案と同じ、Slackイベントの関連度判定）に委ねる。
"""
import datetime as dt
import json
import logging
import os
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from ai_assistant import AIAssistant
from http_app.domain import Policy, plan
from slack_sdk import WebClient

TS_RE = re.compile(r"[0-9]+\.[0-9]+")


def build_envelope():
    channel = os.environ.get("SLACK_CHANNEL", "")
    ts = os.environ.get("SLACK_TS", "")
    return {
        "team_id": os.environ.get("SLACK_TEAM_ID", ""),
        "type": "event_callback",
        "event": {
            "type": os.environ.get("SLACK_EVENT_TYPE", "message"),
            "channel": channel,
            "user": os.environ.get("SLACK_USER", ""),
            "ts": ts,
            "thread_ts": os.environ.get("SLACK_THREAD_TS") or ts,
            "text": os.environ.get("SLACK_TEXT", ""),
        },
    }


def main():
    # 外部ライブラリのエラー本文に認証情報が含まれる可能性を避ける。
    logging.disable(logging.CRITICAL)
    request_id = os.environ.get("REQUEST_ID", "")
    stage = "configuration"
    assistant = None
    try:
        client = WebClient(token=os.environ["SLACK_BOT_TOKEN"], retry_handlers=[])
        stage = "slack_identity"
        identity = client.auth_test()
        bot_user_id = identity["user_id"]
        envelope = build_envelope()
        if envelope["team_id"] and identity["team_id"] != envelope["team_id"]:
            raise ValueError("TEAM_ID_MISMATCH")

        stage = "plan"
        owner_only = os.environ.get("OWNER_ONLY", "true") == "true"
        policy = Policy(
            team_id=identity["team_id"], bot_user_id=bot_user_id,
            ai_channel=os.environ.get("AI_CHANNEL_ID", ""),
            owner_only=owner_only,
            owner_user=os.environ.get("OWNER_USER_ID", ""),
            owner_dm=os.environ.get("OWNER_DM_ID", ""),
        )
        works = plan(envelope, policy)
        event = envelope["event"]
        if not works:
            # @botとだけ打って本文が空のケースは、既存bot.pyのhandle_mentionと同じ案内を返す。
            # owner_only中はテスト範囲を超えて案内メッセージだけが漏れないよう、その場合は出さない。
            owner_blocked = policy.owner_only and (event["channel"] != policy.owner_dm or event["user"] != policy.owner_user)
            if event["type"] == "app_mention" and not owner_blocked:
                client.chat_postMessage(channel=event["channel"], thread_ts=event["thread_ts"],
                                         text="質問を入力してください。例：`@bot 解約の際の手順は？`",
                                         unfurl_links=False, unfurl_media=False)
                print("GUIDANCE_SENT " + json.dumps({"request_id": request_id}))
                return 0
            print("SKIPPED " + json.dumps({"request_id": request_id, "reason": "not_relevant"}))
            return 0
        work = works[0]

        # app_mentionは既存bot.pyと同じく受付メッセージを先に出す。AIチャンネルの自動回答は出さない。
        if event["type"] == "app_mention":
            client.chat_postMessage(channel=work.channel, thread_ts=work.thread_ts, text="回答を生成中...",
                                     unfurl_links=False, unfurl_media=False)

        stage = "notebooklm_answer"
        started = dt.datetime.now(dt.timezone.utc).isoformat()
        assistant = AIAssistant()
        try:
            answer, _ = assistant.answer(work.text, [])
        except Exception:
            # 既存bot.pyと同じく、失敗メッセージはevent種別で使い分ける（handle_mention/handle_messageの実際の文言）。
            answer = ("回答の生成に失敗しました。しばらくしてから再試行してください。" if event["type"] == "app_mention"
                      else "回答の生成に失敗しました。")
        answered = dt.datetime.now(dt.timezone.utc).isoformat()

        stage = "slack_post_unknown_on_failure"
        result = client.chat_postMessage(channel=work.channel, thread_ts=work.thread_ts, text=answer,
                                          unfurl_links=False, unfurl_media=False)
        posted_text = result.get("message", {}).get("text")
        if (not result.get("ok", True) or result.get("channel") != work.channel
                or not TS_RE.fullmatch(result.get("ts", "")) or not isinstance(posted_text, str) or not posted_text.strip()):
            raise ValueError("SLACK_POST_UNVERIFIED")
        print("ANSWER_SENT " + json.dumps({
            "request_id": request_id, "channel": work.channel, "thread_ts": work.thread_ts,
            "reply_ts": result["ts"], "started_at": started, "answered_at": answered,
        }, ensure_ascii=False))
        return 0
    except Exception:
        print(f"ANSWER_FAILED stage={stage} request_id={request_id}（例外本文は認証情報保護のため非表示）")
        return 1
    finally:
        if assistant and assistant._storage_path:
            Path(assistant._storage_path).unlink(missing_ok=True)


if __name__ == "__main__":
    sys.exit(main())
