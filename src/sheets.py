import os
import json
import re
from datetime import datetime
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]

# 既存シートの列レイアウト:
# A(0): サービス  B(1): 質問内容  C(2): 質問背景  D(3): URL
# E(4): 質問者   F(5): 回答者    G(6): 画像      H(7): 送信日時
# I(8): タイムスタンプ (thread_ts / unique key)
# J(9): 回答テキスト (botが追加する列)

CORRECTIONS_HEADERS = ["question", "correct_answer", "updated_at", "note"]


def parse_qa_message(text: str) -> dict:
    """
    Slack Workflow の構造化メッセージをパースして各フィールドを返す。

    フォーマット例:
    ■サービス
    リピッテホテル

    ■質問内容
    ...

    ■質問の背景や意図
    ...
    """
    def extract_section(label: str) -> str:
        pattern = rf"■{label}\s*\n(.*?)(?=\n■|\Z)"
        match = re.search(pattern, text, re.DOTALL)
        if match:
            return match.group(1).strip()
        return ""

    service = extract_section("サービス")
    question = extract_section("質問内容")
    background = extract_section("質問の背景や意図")

    # 構造化フォーマットでなければ全文を質問として扱う
    if not question:
        question = text.strip()

    return {
        "service": service,
        "question": question,
        "background": background,
    }


class SheetsClient:
    def __init__(self):
        creds_json = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
        creds_dict = json.loads(creds_json)
        creds = Credentials.from_service_account_info(creds_dict, scopes=SCOPES)
        service = build("sheets", "v4", credentials=creds)
        self.sheet = service.spreadsheets()
        self.spreadsheet_id = os.environ.get("GOOGLE_SPREADSHEET_ID")
        self.sheet_name = os.environ.get("GOOGLE_SHEET_NAME", "QA")
        self.corrections_sheet_name = "CORRECTIONS"
        self.state_sheet_name = "STATE"
        self._ensure_answer_column()
        self._ensure_corrections_headers()
        self._ensure_state_sheet()

    def _ensure_answer_column(self):
        """J1に回答テキストヘッダーがなければ追加する"""
        result = self.sheet.values().get(
            spreadsheetId=self.spreadsheet_id,
            range=f"{self.sheet_name}!J1",
        ).execute()
        if not result.get("values"):
            self.sheet.values().update(
                spreadsheetId=self.spreadsheet_id,
                range=f"{self.sheet_name}!J1",
                valueInputOption="RAW",
                body={"values": [["回答テキスト"]]},
            ).execute()

    def _create_sheet(self, title: str):
        self.sheet.batchUpdate(
            spreadsheetId=self.spreadsheet_id,
            body={"requests": [{"addSheet": {"properties": {"title": title}}}]},
        ).execute()

    def _ensure_corrections_headers(self):
        try:
            result = self.sheet.values().get(
                spreadsheetId=self.spreadsheet_id,
                range=f"{self.corrections_sheet_name}!A1:D1",
            ).execute()
            if not result.get("values"):
                raise ValueError("empty")
        except (HttpError, ValueError):
            try:
                self._create_sheet(self.corrections_sheet_name)
            except HttpError:
                pass
            self.sheet.values().update(
                spreadsheetId=self.spreadsheet_id,
                range=f"{self.corrections_sheet_name}!A1",
                valueInputOption="RAW",
                body={"values": [CORRECTIONS_HEADERS]},
            ).execute()

    def _ensure_state_sheet(self):
        try:
            result = self.sheet.values().get(
                spreadsheetId=self.spreadsheet_id,
                range=f"{self.state_sheet_name}!A1:B1",
            ).execute()
            if not result.get("values"):
                raise ValueError("empty")
        except (HttpError, ValueError):
            try:
                self._create_sheet(self.state_sheet_name)
            except HttpError:
                pass
            self.sheet.values().update(
                spreadsheetId=self.spreadsheet_id,
                range=f"{self.state_sheet_name}!A1",
                valueInputOption="RAW",
                body={"values": [["key", "value"], ["last_processed_ts", ""]]},
            ).execute()

    def get_last_processed_ts(self) -> str | None:
        result = self.sheet.values().get(
            spreadsheetId=self.spreadsheet_id,
            range=f"{self.state_sheet_name}!A:B",
        ).execute()
        for row in result.get("values", []):
            if len(row) >= 2 and row[0] == "last_processed_ts":
                return row[1] or None
        return None

    def save_last_processed_ts(self, ts: str):
        result = self.sheet.values().get(
            spreadsheetId=self.spreadsheet_id,
            range=f"{self.state_sheet_name}!A:A",
        ).execute()
        for i, row in enumerate(result.get("values", []), 1):
            if row and row[0] == "last_processed_ts":
                self.sheet.values().update(
                    spreadsheetId=self.spreadsheet_id,
                    range=f"{self.state_sheet_name}!B{i}",
                    valueInputOption="RAW",
                    body={"values": [[ts]]},
                ).execute()
                return

    def _find_row_by_thread_ts(self, thread_ts: str) -> int | None:
        """I列(thread_ts)またはD列(URL)でrow番号を検索"""
        ts_no_dot = thread_ts.replace(".", "")
        result = self.sheet.values().get(
            spreadsheetId=self.spreadsheet_id,
            range=f"{self.sheet_name}!D:I",
        ).execute()
        rows = result.get("values", [])
        for i, row in enumerate(rows):
            # I列(インデックス5)でthread_ts一致
            if len(row) > 5 and row[5] == thread_ts:
                return i + 1
            # D列(インデックス0)のURLにthread_tsが含まれる
            if len(row) > 0 and ts_no_dot in row[0]:
                return i + 1
        return None

    def upsert_qa(self, thread_ts: str, question_msg: dict, answer_msgs: list[dict]):
        raw_text = question_msg.get("text", "")
        questioner = question_msg.get("user", "unknown")
        channel = question_msg.get("channel", "")
        date = datetime.fromtimestamp(float(thread_ts)).strftime("%Y-%m-%d %H:%M")

        parsed = parse_qa_message(raw_text)
        slack_url = f"https://cnctor.slack.com/archives/{channel}/p{thread_ts.replace('.', '')}"
        answerers = ", ".join(
            m.get("user", "") for m in answer_msgs if m.get("user")
        )
        answers_text = "\n---\n".join(
            m.get("text", "") for m in answer_msgs if m.get("text")
        )

        row_data = [
            parsed["service"],      # A: サービス
            parsed["question"],     # B: 質問内容
            parsed["background"],   # C: 質問背景
            slack_url,              # D: URL
            questioner,             # E: 質問者
            answerers,              # F: 回答者
            "",                     # G: 画像
            date,                   # H: 送信日時
            thread_ts,              # I: タイムスタンプ
            answers_text,           # J: 回答テキスト
        ]

        existing_row = self._find_row_by_thread_ts(thread_ts)
        if existing_row:
            self.sheet.values().batchUpdate(
                spreadsheetId=self.spreadsheet_id,
                body={"valueInputOption": "RAW", "data": [
                    {"range": f"{self.sheet_name}!A{existing_row}", "values": [[parsed["service"]]]},
                    {"range": f"{self.sheet_name}!D{existing_row}", "values": [[slack_url]]},
                    {"range": f"{self.sheet_name}!F{existing_row}", "values": [[answerers]]},
                    {"range": f"{self.sheet_name}!J{existing_row}", "values": [[answers_text]]},
                ]},
            ).execute()
        else:
            self.sheet.values().append(
                spreadsheetId=self.spreadsheet_id,
                range=f"{self.sheet_name}!A1",
                valueInputOption="RAW",
                insertDataOption="INSERT_ROWS",
                body={"values": [row_data]},
            ).execute()

    def get_corrections(self) -> list[dict]:
        result = self.sheet.values().get(
            spreadsheetId=self.spreadsheet_id,
            range=f"{self.corrections_sheet_name}!A2:D",
        ).execute()
        rows = result.get("values", [])
        corrections = []
        for row in rows:
            if len(row) >= 2 and row[0]:
                corrections.append({
                    "question": row[0],
                    "correct_answer": row[1],
                    "note": row[3] if len(row) > 3 else "",
                })
        return corrections

    def get_all_qa(self) -> list[dict]:
        result = self.sheet.values().get(
            spreadsheetId=self.spreadsheet_id,
            range=f"{self.sheet_name}!A2:J",
        ).execute()
        rows = result.get("values", [])
        qa_list = []
        for row in rows:
            question = row[1] if len(row) > 1 else ""  # 質問内容
            if not question:
                continue
            qa_list.append({
                "service": row[0] if len(row) > 0 else "",
                "question": question,
                "answers": row[9] if len(row) > 9 else "",  # 回答テキスト
                "date": row[7] if len(row) > 7 else "",     # 送信日時
            })
        return qa_list
