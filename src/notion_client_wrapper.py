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

        if existing_page_id:
            # 既存ページは回答テキスト・回答者のみ更新（手入力済みフィールドは触らない）
            self.client.pages.update(
                page_id=existing_page_id,
                properties={
                    "回答テキスト": {"rich_text": [{"text": {"content": answers_combined[:2000]}}]},
                    "回答者": {"rich_text": [{"text": {"content": answerers}}]},
                },
            )
        else:
            # 新規ページは bot が把握できるフィールドだけ書き込む
            properties = {
                "質問の内容": {"title": [{"text": {"content": parsed["question"][:200]}}]},
                "タイムスタンプ": {"rich_text": [{"text": {"content": thread_ts}}]},
                "質問者": {"rich_text": [{"text": {"content": questioner}}]},
                "回答者": {"rich_text": [{"text": {"content": answerers}}]},
                "質問日時": {"date": {"start": date_str}},
                "回答テキスト": {"rich_text": [{"text": {"content": answers_combined[:2000]}}]},
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
                    "heading_2": {"rich_text": [{"text": {"content": "回答テキスト"}}]},
                },
                {
                    "object": "block",
                    "type": "paragraph",
                    "paragraph": {"rich_text": [{"text": {"content": answers_combined[:2000] or "（未回答）"}}]},
                },
            ]
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
