"""本人専用DMへNotebookLMの実回答を1回だけ送る。常駐botは起動しない。"""
import datetime as dt
import hashlib
import json
import re
import logging
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from ai_assistant import AIAssistant
from slack_sdk import WebClient

QUESTION = "ホテルラボはどのようなサービスですか？資料に基づいて簡潔に教えてください。"
CHANNEL = "D0B87Q9U54G"


def main():
    # 外部ライブラリのエラー本文に認証情報が含まれる可能性を避ける。
    logging.disable(logging.CRITICAL)
    started = dt.datetime.now(dt.timezone.utc).isoformat()
    request_id = os.environ.get("CLOCK_REQUEST_ID", "")
    assistant = None
    stage = "configuration"
    try:
        if os.environ.get("NOTEBOOKLM_NOTEBOOK_ID") != "ff4df3ed-ae9a-4684-a8d1-8b00a8833ba0":
            raise ValueError()
        if request_id and not re.fullmatch(r"[a-f0-9-]{36}", request_id):
            raise ValueError()
        client = WebClient(token=os.environ["SLACK_BOT_TOKEN"], retry_handlers=[])
        stage = "slack_identity"
        identity = client.auth_test()
        if identity["team_id"] != "T1CSJ782K" or identity["user_id"] != "U0B87Q9P99N":
            raise ValueError()
        stage = "notebooklm_answer"
        assistant = AIAssistant()
        answer, _ = assistant.answer(QUESTION, [])
        answered = dt.datetime.now(dt.timezone.utc).isoformat()
        message = f"【NotebookLM実回答テスト】\n質問：{QUESTION}\n\n{answer}"
        if request_id:
            message += f"\n\n照合ID：{request_id}"
        if len(message) > 35000:
            raise ValueError()
        print("NotebookLMの実回答を取得。本人DMへ1回送信します。", flush=True)
        stage = "slack_post_unknown_on_failure"
        result = client.chat_postMessage(channel=CHANNEL, text=message,
                                         unfurl_links=False, unfurl_media=False)
        if result["channel"] != CHANNEL or result["message"]["text"] != message:
            raise ValueError()
        print("DM_SENT " + json.dumps({"channel": CHANNEL, "ts": result["ts"],
              "request_id": request_id, "started_at": started, "answered_at": answered,
              "posted_at": dt.datetime.now(dt.timezone.utc).isoformat(),
              "message_sha256": hashlib.sha256(message.encode()).hexdigest(),
              "message_length": len(message)}, ensure_ascii=False))
        return 0
    except Exception:
        print(f"TEST_FAILED stage={stage}（例外本文は認証情報保護のため非表示）")
        return 1
    finally:
        if assistant and assistant._storage_path:
            Path(assistant._storage_path).unlink(missing_ok=True)


if __name__ == "__main__":
    sys.exit(main())
