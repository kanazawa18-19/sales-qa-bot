"""Slackイベントから処理対象を決める。外部I/Oは行わない。"""
from dataclasses import dataclass, asdict
import hashlib
import re


@dataclass(frozen=True)
class Policy:
    team_id: str
    bot_user_id: str
    ai_channel: str
    owner_only: bool = True
    owner_user: str = ""
    owner_dm: str = ""


@dataclass(frozen=True)
class Work:
    key: str
    kind: str
    channel: str
    thread_ts: str
    text: str

    def payload(self):
        return asdict(self)


def text_of(event):
    if event.get("text", "").strip():
        return event["text"].strip()
    chunks = []
    def visit(item):
        if isinstance(item, dict):
            if isinstance(item.get("text"), str):
                chunks.append(item["text"])
            for key in ("text", "elements", "blocks"):
                if isinstance(item.get(key), (dict, list)):
                    visit(item[key])
        elif isinstance(item, list):
            for child in item:
                visit(child)
    visit(event.get("blocks", []))
    if not chunks:
        for attachment in event.get("attachments", []):
            chunks.append(attachment.get("text") or attachment.get("pretext") or "")
    return "\n".join(chunks).strip()


def plan(envelope, policy):
    if envelope.get("team_id") != policy.team_id or envelope.get("type") != "event_callback":
        return []
    event = envelope.get("event", {})
    if not isinstance(event, dict) or event.get("type") not in {"message", "app_mention"}:
        return []
    if event.get("user") == policy.bot_user_id or event.get("subtype") in {
        "message_changed", "message_deleted", "channel_join", "channel_leave", "message_replied"
    }:
        return []
    channel, ts = event.get("channel", ""), event.get("ts", "")
    if not re.fullmatch(r"[CDG][A-Z0-9]+", channel) or not re.fullmatch(r"\d+\.\d+", ts):
        return []
    thread = event.get("thread_ts") or ts
    if not re.fullmatch(r"\d+\.\d+", thread):
        return []
    if policy.owner_only and (channel != policy.owner_dm or event.get("user") != policy.owner_user):
        return []
    out = []
    def work(kind, text=""):
        # messageとapp_mentionのevent_idが違っても、同じ投稿は1件にする。
        raw = f"{policy.team_id}:{channel}:{ts}:{kind}"
        return Work(hashlib.sha256(raw.encode()).hexdigest(), kind, channel, thread, text)
    mention = event.get("type") == "app_mention"
    if mention or (channel == policy.ai_channel and thread == ts):
        text = text_of(event).replace(f"<@{policy.bot_user_id}>", "").strip()
        if text:
            out.append(work("answer", text))
    return out
