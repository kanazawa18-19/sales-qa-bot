import os
import json
from datetime import datetime
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]

HEADERS = ["thread_ts", "date", "channel", "questioner", "question", "answers", "answer_count"]
CORRECTIONS_HEADERS = ["question", "correct_answer", "updated_at", "note"]


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
        self._ensure_headers()
        self._ensure_corrections_headers()
        self._ensure_state_sheet()

    def _ensure_headers(self):
        result = self.sheet.values().get(
            spreadsheetId=self.spreadsheet_id,
            range=f"{self.sheet_name}!A1:G1",
        ).execute()
        if not result.get("values"):
            self.sheet.values().update(
                spreadsheetId=self.spreadsheet_id,
                range=f"{self.sheet_name}!A1",
                valueInputOption="RAW",
                body={"values": [HEADERS]},
            ).execute()

    def _ensure_corrections_headers(self):
        result = self.sheet.values().get(
            spreadsheetId=self.spreadsheet_id,
            range=f"{self.corrections_sheet_name}!A1:D1",
        ).execute()
        if not result.get("values"):
            self.sheet.values().update(
                spreadsheetId=self.spreadsheet_id,
                range=f"{self.corrections_sheet_name}!A1",
                valueInputOption="RAW",
                body={"values": [CORRECTIONS_HEADERS]},
            ).execute()

    def _ensure_state_sheet(self):
        result = self.sheet.values().get(
            spreadsheetId=self.spreadsheet_id,
            range=f"{self.state_sheet_name}!A1:B1",
        ).execute()
        if not result.get("values"):
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
        result = self.sheet.values().get(
            spreadsheetId=self.spreadsheet_id,
            range=f"{self.sheet_name}!A:A",
        ).execute()
        rows = result.get("values", [])
        for i, row in enumerate(rows):
            if row and row[0] == thread_ts:
                return i + 1  # 1-indexed
        return None

    def upsert_qa(self, thread_ts: str, question_msg: dict, answer_msgs: list[dict]):
        question_text = question_msg.get("text", "")
        questioner = question_msg.get("user", "unknown")
        channel = question_msg.get("channel", "")
        date = datetime.fromtimestamp(float(thread_ts)).strftime("%Y-%m-%d %H:%M")

        answers_combined = "\n---\n".join(
            m.get("text", "") for m in answer_msgs if m.get("text")
        )

        row_data = [
            thread_ts,
            date,
            channel,
            questioner,
            question_text,
            answers_combined,
            str(len(answer_msgs)),
        ]

        existing_row = self._find_row_by_thread_ts(thread_ts)
        if existing_row:
            self.sheet.values().update(
                spreadsheetId=self.spreadsheet_id,
                range=f"{self.sheet_name}!A{existing_row}",
                valueInputOption="RAW",
                body={"values": [row_data]},
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
            range=f"{self.sheet_name}!A2:G",
        ).execute()
        rows = result.get("values", [])
        qa_list = []
        for row in rows:
            if len(row) >= 6 and row[4]:
                qa_list.append({
                    "question": row[4],
                    "answers": row[5] if len(row) > 5 else "",
                    "date": row[1] if len(row) > 1 else "",
                })
        return qa_list
