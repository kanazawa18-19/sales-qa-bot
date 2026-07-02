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
    """oldestより新しいメッセージを全件返す（Slack APIのoldestパラメータは使わずPython側でフィルタ）"""
    cutoff = float(oldest)
    collected = []
    cursor = None
    try:
        while True:
            kwargs = {"channel": channel, "limit": 200}
            if cursor:
                kwargs["cursor"] = cursor
            result = slack.conversations_history(**kwargs)
            for msg in result.get("messages", []):
                if float(msg.get("ts", "0")) >= cutoff:
                    collected.append(msg)
                else:
                    return collected  # メッセージは降順なのでcutoff以前になったら終了
            if not result.get("has_more"):
                break
            cursor = result.get("response_metadata", {}).get("next_cursor")
            if not cursor:
                break
    except SlackApiError as e:
        logger.error(f"history error {channel}: {e}")
    return collected


def extract_image_urls(msg: dict) -> list[str]:
    """メッセージから画像ファイルのpermalinkを抽出する"""
    return [
        f["permalink"]
        for f in msg.get("files", [])
        if f.get("mimetype", "").startswith("image/") and f.get("permalink")
    ]


def extract_text(msg: dict) -> str:
    """textフィールドが空のワークフロー投稿もblocksから本文を抽出する"""
    text = msg.get("text", "").strip()
    if text:
        return text
    for block in msg.get("blocks", []):
        btype = block.get("type")
        if btype == "section" and block.get("text"):
            text += block["text"].get("text", "") + "\n"
        elif btype == "rich_text":
            for section in block.get("elements", []):
                for elem in section.get("elements", []):
                    if elem.get("type") == "text":
                        text += elem.get("text", "")
    if text:
        return text.strip()
    for att in msg.get("attachments", []):
        if att.get("text"):
            text += att["text"] + "\n"
        elif att.get("pretext"):
            text += att["pretext"] + "\n"
    return text.strip()


def get_thread(slack: WebClient, channel: str, thread_ts: str) -> list[dict]:
    try:
        return slack.conversations_replies(channel=channel, ts=thread_ts, limit=200).get("messages", [])
    except SlackApiError as e:
        logger.error(f"thread error {thread_ts}: {e}")
        return []


def capture_qa_threads(slack, sheets, notion, channel, oldest):
    messages = get_history(slack, channel, oldest)
    logger.info(f"QA catch-up: {len(messages)} messages found (oldest={oldest})")
    seen = set()

    for msg in messages:
        if msg.get("subtype") in ("channel_join", "channel_leave"):
            continue
        thread_ts = msg.get("thread_ts") or msg.get("ts")
        if not thread_ts or thread_ts in seen:
            continue
        seen.add(thread_ts)

        thread_msgs = get_thread(slack, channel, thread_ts)
        if not thread_msgs:
            continue

        question_msg = {**thread_msgs[0], "channel": channel}
        answer_msgs = [m for m in thread_msgs[1:] if not m.get("bot_id")]
        image_urls = extract_image_urls(thread_msgs[0])
        for ans in answer_msgs:
            image_urls.extend(extract_image_urls(ans))

        sheets.upsert_qa(thread_ts, question_msg, answer_msgs, image_urls=image_urls)
        notion.upsert_qa(thread_ts, question_msg, answer_msgs)
        logger.info(f"Saved thread {thread_ts} ({len(answer_msgs)} answers, {len(image_urls)} images)")


def handle_ai_channel(slack, sheets, ai, bot_user_id, oldest, own_bot_id=None):
    ai_channel = os.environ.get("AI_CHANNEL_ID")
    if not ai_channel:
        return

    msgs = get_history(slack, ai_channel, oldest)
    logger.info(f"AI channel catch-up: {len(msgs)} messages found (oldest={oldest}, own_bot_id={own_bot_id})")

    for msg in msgs:
        ts = msg.get("ts")
        subtype = msg.get("subtype")
        bot_id = msg.get("bot_id")
        user = msg.get("user")
        text_raw = msg.get("text", "")
        thread_ts = msg.get("thread_ts")

        if subtype in ("channel_join", "channel_leave"):
            logger.debug(f"Skip {ts}: subtype={subtype}")
            continue
        if thread_ts and thread_ts != ts:
            logger.debug(f"Skip {ts}: thread reply")
            continue
        if own_bot_id is not None:
            if bot_id == own_bot_id or user == bot_user_id:
                logger.debug(f"Skip {ts}: own bot (bot_id={bot_id}, user={user})")
                continue
        else:
            if bot_id or user == bot_user_id:
                logger.debug(f"Skip {ts}: any bot")
                continue

        text = extract_text(msg)
        if not text:
            logger.info(f"Skip {ts}: empty text (bot_id={bot_id}, user={user}, blocks={bool(msg.get('blocks'))})")
            continue

        thread_msgs = get_thread(slack, ai_channel, ts)
        if any(m.get("user") == bot_user_id for m in thread_msgs[1:]):
            logger.debug(f"Skip {ts}: already replied")
            continue

        image_urls = extract_image_urls(msg)
        try:
            answer, ref_images = ai.answer(
                text,
                sheets.get_all_qa(),
                sheets.get_corrections(),
                os.environ.get("SERVICE_MATERIALS_TEXT", ""),
                image_urls=image_urls,
            )
            if ref_images:
                answer += "\n\n参考画像:\n" + "\n".join(ref_images)
            slack.chat_postMessage(channel=ai_channel, thread_ts=ts, text=answer)
            logger.info(f"AI replied in AI channel: {ts}")
        except Exception as e:
            logger.error(f"AI failed for AI channel message {ts}: {e}")


def handle_ai_mentions(slack, sheets, ai, bot_user_id, oldest, own_bot_id=None):
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
            if own_bot_id is not None:
                if msg.get("bot_id") == own_bot_id or msg.get("user") == bot_user_id:
                    continue
            elif msg.get("bot_id"):
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

            image_urls = extract_image_urls(msg)
            try:
                answer, ref_images = ai.answer(
                    user_question,
                    sheets.get_all_qa(),
                    sheets.get_corrections(),
                    os.environ.get("SERVICE_MATERIALS_TEXT", ""),
                    image_urls=image_urls,
                )
                if ref_images:
                    answer += "\n\n参考画像:\n" + "\n".join(ref_images)
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
