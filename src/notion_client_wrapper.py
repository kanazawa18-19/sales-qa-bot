import os
from datetime import datetime
from notion_client import Client

from sheets import parse_qa_message


class NotionClient:
    def __init__(self):
        self.client = Client(auth=os.environ.get("NOTION_TOKEN"))
        self.database_id = os.environ.get("NOTION_DATABASE_ID")

    def upsert_qa(self, thread_ts: str, question_msg: dict, answer_msgs: list[dict]):
        raw_text = question_msg.get("text", "")
        questioner = question_msg.get("user", "unknown")
        date_str = datetime.fromtimestamp(float(thread_ts)).strftime("%Y-%m-%dT%H:%M:%S+09:00")

        parsed = parse_qa_message(raw_text)
        answers_combined = "\n\n---\n\n".join(
            m.get("text", "") for m in answer_msgs if m.get("text")
        )
        answerers = ", ".join(
            m.get("user", "") for m in answer_msgs if m.get("user")
        )

        existing_page_id = self._find_page_by_thread_ts(thread_ts)

        properties = {
            "質問の内容": {"title": [{"text": {"content": parsed["question"][:200]}}]},
            "タイムスタンプ": {"rich_text": [{"text": {"content": thread_ts}}]},
            "質問者": {"rich_text": [{"text": {"content": questioner}}]},
            "回答者": {"rich_text": [{"text": {"content": answerers}}]},
            "送信日時": {"date": {"start": date_str}},
            "回答": {"rich_text": [{"text": {"content": answers_combined[:2000]}}]},
            "サービス": {"rich_text": [{"text": {"content": parsed["service"]}}]},
            "質問の背景": {"rich_text": [{"text": {"content": parsed["background"][:2000]}}]},
        }

        children = [
            {
                "object": "block",
                "type": "heading_2",
                "heading_2": {"rich_text": [{"text": {"content": "質問"}}]},
            },
            {
                "object": "block",
                "type": "paragraph",
                "paragraph": {"rich_text": [{"text": {"content": parsed["question"][:2000]}}]},
            },
            {
                "object": "block",
                "type": "heading_2",
                "heading_2": {"rich_text": [{"text": {"content": "回答"}}]},
            },
            {
                "object": "block",
                "type": "paragraph",
                "paragraph": {"rich_text": [{"text": {"content": answers_combined[:2000] or "（未回答）"}}]},
            },
        ]

        if existing_page_id:
            self.client.pages.update(page_id=existing_page_id, properties=properties)
            existing_blocks = self.client.blocks.children.list(block_id=existing_page_id)
            for block in existing_blocks.get("results", []):
                self.client.blocks.delete(block_id=block["id"])
            self.client.blocks.children.append(block_id=existing_page_id, children=children)
        else:
            self.client.pages.create(
                parent={"database_id": self.database_id},
                properties=properties,
                children=children,
            )

    def _find_page_by_thread_ts(self, thread_ts: str) -> str | None:
        result = self.client.databases.query(
            database_id=self.database_id,
            filter={
                "property": "タイムスタンプ",
                "rich_text": {"equals": thread_ts},
            },
        )
        results = result.get("results", [])
        if results:
            return results[0]["id"]
        return None
