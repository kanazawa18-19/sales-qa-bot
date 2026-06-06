import os
import ssl
import logging
from slack_bolt import App
from slack_bolt.adapter.socket_mode import SocketModeHandler

from sheets import SheetsClient
from notion_client_wrapper import NotionClient
from ai_assistant import AIAssistant

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = App(token=os.environ.get("SLACK_BOT_TOKEN"))

sheets = SheetsClient()
notion = NotionClient()
ai = AIAssistant()

_bot_id = app.client.auth_test().get("bot_id")


def _rebuild_sheets():
    global sheets
    logger.info("Rebuilding SheetsClient due to SSL error")
    sheets = SheetsClient()

QA_CHANNEL_ID = os.environ.get("QA_CHANNEL_ID")
AI_CHANNEL_ID = os.environ.get("AI_CHANNEL_ID")
SERVICE_MATERIALS = os.environ.get("SERVICE_MATERIALS_TEXT", "")


def capture_thread(client, channel: str, thread_ts: str):
    try:
        result = client.conversations_replies(channel=channel, ts=thread_ts, limit=200)
        messages = result.get("messages", [])
        if not messages:
            return

        question_msg = messages[0]
        question_msg["channel"] = channel
        answer_msgs = messages[1:]

        # Bot自身の返答は除外
        answer_msgs = [m for m in answer_msgs if not m.get("bot_id")]

        sheets.upsert_qa(thread_ts, question_msg, answer_msgs)
        notion.upsert_qa(thread_ts, question_msg, answer_msgs)
        logger.info(f"Captured thread {thread_ts}: {len(answer_msgs)} answers")
    except Exception as e:
        logger.error(f"Failed to capture thread {thread_ts}: {e}")


@app.event("message")
def handle_message(event, client, say):
    channel = event.get("channel")
    logger.info(f"Message event: channel={channel}, subtype={event.get('subtype')}, bot_id={event.get('bot_id')}")

    # 自分自身のメッセージと編集・削除・入退室は無視
    if event.get("bot_id") == _bot_id:
        return
    if event.get("subtype") in ("message_changed", "message_deleted", "channel_join", "channel_leave"):
        return

    # Q&Aキャプチャ
    if channel == QA_CHANNEL_ID:
        thread_ts = event.get("thread_ts")
        if thread_ts:
            capture_thread(client, channel, thread_ts)

    # AIチャンネル全自動回答
    if AI_CHANNEL_ID and channel == AI_CHANNEL_ID:
        logger.info(f"AI channel match. ts={event.get('ts')} thread_ts={event.get('thread_ts')}")
        # スレッド返信は無視（最初の投稿のみ対象）
        ts = event.get("ts")
        if event.get("thread_ts") and event.get("thread_ts") != ts:
            logger.info("Skipping thread reply")
            return

        text = event.get("text", "").strip()
        if not text:
            logger.info("Skipping empty text")
            return

        logger.info(f"Calling AI for: {text[:50]}")
        for attempt in range(2):
            try:
                qa_data = sheets.get_all_qa()
                corrections = sheets.get_corrections()
                answer = ai.answer(text, qa_data, corrections, SERVICE_MATERIALS)
                logger.info("AI answer ready, posting to Slack")
                say(text=answer, thread_ts=ts)
                logger.info("Posted to Slack")
                break
            except ssl.SSLEOFError:
                if attempt == 0:
                    _rebuild_sheets()
                else:
                    logger.error("SSL error on retry, giving up")
                    say(text="回答の生成に失敗しました。", thread_ts=ts)
            except Exception as e:
                logger.error(f"AI answer failed: {e}", exc_info=True)
                say(text="回答の生成に失敗しました。", thread_ts=ts)
                break


@app.event("app_mention")
def handle_mention(event, say, client):
    # @bot 宛てメンション → AI回答
    channel = event.get("channel")
    thread_ts = event.get("thread_ts") or event.get("ts")

    # メンション部分を除去
    text = event.get("text", "")
    user_question = " ".join(
        word for word in text.split() if not word.startswith("<@")
    ).strip()

    if not user_question:
        say(text="質問を入力してください。例：`@bot 解約の際の手順は？`", thread_ts=thread_ts)
        return

    say(text="回答を生成中...", thread_ts=thread_ts)

    try:
        qa_data = sheets.get_all_qa()
        corrections = sheets.get_corrections()
        answer = ai.answer(user_question, qa_data, corrections, SERVICE_MATERIALS)
        say(text=answer, thread_ts=thread_ts)
    except Exception as e:
        logger.error(f"AI answer failed: {e}")
        say(text="回答の生成に失敗しました。しばらくしてから再試行してください。", thread_ts=thread_ts)


if __name__ == "__main__":
    handler = SocketModeHandler(app, os.environ.get("SLACK_APP_TOKEN"))
    handler.start()
