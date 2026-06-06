import os
import time
import logging
from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError

from sheets import SheetsClient
from notion_client_wrapper import NotionClient
from ai_assistant import AIAssistant

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

RUN_DURATION = 50 * 60  # 50分ループしてから終了（GitHub Actionsが再起動）
POLL_INTERVAL = 30       # 30秒ごとにSlackを確認


def get_history(slack: WebClient, channel: str, oldest: str) -> list[dict]:
    try:
        return slack.conversations_history(channel=channel, oldest=oldest, limit=100).get("messages", [])
    except SlackApiError as e:
        logger.error(f"history error {channel}: {e}")
        return []


def get_thread(slack: WebClient, channel: str, thread_ts: str) -> list[dict]:
    try:
        return slack.conversations_replies(channel=channel, ts=thread_ts, limit=200).get("messages", [])
    except SlackApiError as e:
        logger.error(f"thread error {thread_ts}: {e}")
        return []


def capture_qa_threads(slack, sheets, notion, channel, oldest):
    messages = get_history(slack, channel, oldest)
    seen = set()

    for msg in messages:
        thread_ts = msg.get("thread_ts") or msg.get("ts")
        if not thread_ts or thread_ts in seen:
            continue
        seen.add(thread_ts)

        thread_msgs = get_thread(slack, channel, thread_ts)
        if not thread_msgs:
            continue

        question_msg = {**thread_msgs[0], "channel": channel}
        answer_msgs = [m for m in thread_msgs[1:] if not m.get("bot_id")]

        sheets.upsert_qa(thread_ts, question_msg, answer_msgs)
        notion.upsert_qa(thread_ts, question_msg, answer_msgs)
        logger.info(f"Saved thread {thread_ts} ({len(answer_msgs)} answers)")


def handle_ai_channel(slack, sheets, ai, bot_user_id, oldest):
    ai_channel = os.environ.get("AI_CHANNEL_ID")
    if not ai_channel:
        return

    for msg in get_history(slack, ai_channel, oldest):
        # スレッド返信は無視（最初の投稿のみ対象）
        if msg.get("thread_ts") and msg.get("thread_ts") != msg.get("ts"):
            continue
        if msg.get("bot_id") or msg.get("user") == bot_user_id:
            continue

        ts = msg.get("ts")
        text = msg.get("text", "").strip()
        if not text:
            continue

        # すでにbotが返信済みならスキップ
        thread_msgs = get_thread(slack, ai_channel, ts)
        if any(m.get("user") == bot_user_id for m in thread_msgs[1:]):
            continue

        try:
            answer = ai.answer(
                text,
                sheets.get_all_qa(),
                sheets.get_corrections(),
                os.environ.get("SERVICE_MATERIALS_TEXT", ""),
            )
            slack.chat_postMessage(channel=ai_channel, thread_ts=ts, text=answer)
            logger.info(f"AI replied in AI channel: {ts}")
        except Exception as e:
            logger.error(f"AI failed for AI channel message {ts}: {e}")


def handle_ai_mentions(slack, sheets, ai, bot_user_id, oldest):
    try:
        channels = [
            c for c in slack.conversations_list(types="public_channel,private_channel", limit=100).get("channels", [])
            if c.get("is_member")
        ]
    except SlackApiError as e:
        logger.error(f"channels_list error: {e}")
        return

    for ch in channels:
        channel_id = ch["id"]
        for msg in get_history(slack, channel_id, oldest):
            if f"<@{bot_user_id}>" not in msg.get("text", ""):
                continue
            if msg.get("bot_id"):
                continue

            thread_ts = msg.get("thread_ts") or msg.get("ts")

            # すでにbotが返信済みならスキップ
            thread_msgs = get_thread(slack, channel_id, thread_ts)
            if any(m.get("user") == bot_user_id for m in thread_msgs[1:]):
                continue

            user_question = " ".join(
                w for w in msg.get("text", "").split() if not w.startswith("<@")
            ).strip()
            if not user_question:
                continue

            try:
                answer = ai.answer(
                    user_question,
                    sheets.get_all_qa(),
                    sheets.get_corrections(),
                    os.environ.get("SERVICE_MATERIALS_TEXT", ""),
                )
                slack.chat_postMessage(channel=channel_id, thread_ts=thread_ts, text=answer)
                logger.info(f"AI replied in {channel_id}")
            except Exception as e:
                logger.error(f"AI failed: {e}")
                slack.chat_postMessage(
                    channel=channel_id,
                    thread_ts=thread_ts,
                    text="回答の生成に失敗しました。しばらく後に再試行してください。",
                )


def main():
    slack = WebClient(token=os.environ["SLACK_BOT_TOKEN"])
    sheets = SheetsClient()
    notion = NotionClient()
    ai = AIAssistant()

    qa_channel = os.environ["QA_CHANNEL_ID"]
    bot_user_id = slack.auth_test()["user_id"]
    logger.info(f"Bot started. user_id={bot_user_id}")

    last_ts = sheets.get_last_processed_ts() or str(time.time() - 86400)
    start = time.time()

    while time.time() - start < RUN_DURATION:
        current_ts = str(time.time())
        logger.info(f"Polling since ts={last_ts}")

        capture_qa_threads(slack, sheets, notion, qa_channel, last_ts)
        handle_ai_channel(slack, sheets, ai, bot_user_id, last_ts)
        handle_ai_mentions(slack, sheets, ai, bot_user_id, last_ts)

        last_ts = current_ts
        sheets.save_last_processed_ts(current_ts)

        time.sleep(POLL_INTERVAL)

    logger.info("50min done. GitHub Actions will restart.")


if __name__ == "__main__":
    main()
