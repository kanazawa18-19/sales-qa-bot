"""
過去のSlack QAチャンネルの全履歴をスプレッドシートとNotionに同期する。
一度だけ実行するスクリプト。
"""
import os
import time
import logging
from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError

from sheets import SheetsClient
from notion_client_wrapper import NotionClient

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def get_all_history(slack: WebClient, channel: str) -> list[dict]:
    messages = []
    cursor = None
    while True:
        try:
            kwargs = {"channel": channel, "limit": 200}
            if cursor:
                kwargs["cursor"] = cursor
            res = slack.conversations_history(**kwargs)
            messages.extend(res.get("messages", []))
            meta = res.get("response_metadata", {})
            cursor = meta.get("next_cursor")
            if not cursor:
                break
            logger.info(f"Fetched {len(messages)} messages so far...")
            time.sleep(1)
        except SlackApiError as e:
            logger.error(f"history error: {e}")
            break
    return messages


def get_thread(slack: WebClient, channel: str, thread_ts: str) -> list[dict]:
    messages = []
    cursor = None
    while True:
        try:
            kwargs = {"channel": channel, "ts": thread_ts, "limit": 200}
            if cursor:
                kwargs["cursor"] = cursor
            res = slack.conversations_replies(**kwargs)
            messages.extend(res.get("messages", []))
            meta = res.get("response_metadata", {})
            cursor = meta.get("next_cursor")
            if not cursor:
                break
        except SlackApiError as e:
            logger.error(f"thread error {thread_ts}: {e}")
            break
    return messages


def main():
    slack = WebClient(token=os.environ["SLACK_BOT_TOKEN"], timeout=60)
    sheets = SheetsClient()
    notion = NotionClient()
    qa_channel = os.environ["QA_CHANNEL_ID"]

    logger.info(f"Fetching all history from channel {qa_channel}...")
    messages = get_all_history(slack, qa_channel)
    logger.info(f"Total messages: {len(messages)}")

    seen = set()
    success = 0
    for msg in messages:
        if msg.get("subtype") in ("channel_join", "channel_leave"):
            continue
        thread_ts = msg.get("thread_ts") or msg.get("ts")
        if not thread_ts or thread_ts in seen:
            continue
        seen.add(thread_ts)

        thread_msgs = get_thread(slack, qa_channel, thread_ts)
        if not thread_msgs:
            continue

        question_msg = {**thread_msgs[0], "channel": qa_channel}
        answer_msgs = [m for m in thread_msgs[1:] if not m.get("bot_id")]

        try:
            sheets.upsert_qa(thread_ts, question_msg, answer_msgs)
            notion.upsert_qa(thread_ts, question_msg, answer_msgs)
            success += 1
            logger.info(f"Saved thread {thread_ts} ({len(answer_msgs)} answers)")
        except Exception as e:
            logger.error(f"Failed thread {thread_ts}: {e}")
        time.sleep(0.5)

    logger.info(f"Backfill complete. {success}/{len(seen)} threads saved.")


if __name__ == "__main__":
    main()
