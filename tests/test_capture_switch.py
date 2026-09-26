"""本番接続のあるmodule初期化を避け、実際の関数本体で記録停止を検証する。"""
import ast
import logging
import os
from pathlib import Path
import time
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]


def functions(file, names, scope):
    tree = ast.parse((ROOT / "src" / file).read_text())
    nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names]
    for node in nodes:
        node.decorator_list = []
    exec(compile(ast.Module(body=nodes, type_ignores=[]), file, "exec"), scope)
    return scope


class CaptureSwitchTests(unittest.TestCase):
    def test_poll_recording_is_off_before_any_read_or_write(self):
        read = Mock(return_value=[{"ts": "1"}])
        thread = Mock(return_value=[{"ts": "1", "text": "質問"}])
        scope = functions("poll.py", ["capture_qa_threads"], {
            "os": os, "get_history": read, "get_thread": thread,
            "extract_image_urls": lambda m: [], "logger": logging.getLogger("test")})
        sheets, notion = Mock(), Mock()
        with patch.dict(os.environ, {"QA_CAPTURE_ENABLED": "false"}):
            scope["capture_qa_threads"](None, sheets, notion, "CQ", "0")
        read.assert_not_called()
        sheets.upsert_qa.assert_not_called()
        notion.upsert_qa.assert_not_called()
        with patch.dict(os.environ, {}, clear=True):
            scope["capture_qa_threads"](None, sheets, notion, "CQ", "0")
        sheets.upsert_qa.assert_called_once()
        notion.upsert_qa.assert_called_once()

    def bot_scope(self, enabled):
        ai = Mock()
        ai.answer.return_value = ("NotebookLM回答", [])
        return functions("bot.py", ["capture_thread", "handle_message", "run_catchup"], {
            "QA_CAPTURE_ENABLED": enabled, "QA_CHANNEL_ID": "CQ", "AI_CHANNEL_ID": "CQ",
            "_bot_id": "BOT", "logger": logging.getLogger("test"),
            "sheets": Mock(), "notion": Mock(), "ai": ai,
            "SERVICE_MATERIALS": "", "_extract_image_info": lambda e: ([], []),
            "WebClient": Mock(), "os": os, "time": time,
            "capture_qa_threads": Mock(), "handle_ai_channel": Mock(), "handle_ai_mentions": Mock()})

    def test_socket_recording_off_but_ai_answer_continues(self):
        scope = self.bot_scope(False)
        client, say = Mock(), Mock()
        scope["capture_thread"](client, "CQ", "1")
        client.conversations_replies.assert_not_called()
        scope["handle_message"]({"channel": "CQ", "ts": "1", "thread_ts": "1", "text": "質問"}, client, say)
        scope["sheets"].upsert_qa.assert_not_called()
        scope["notion"].upsert_qa.assert_not_called()
        scope["ai"].answer.assert_called_once()
        say.assert_called_once_with(text="NotebookLM回答", thread_ts="1")

    def test_socket_recording_on_preserves_capture(self):
        scope = self.bot_scope(True)
        client = Mock()
        client.conversations_replies.return_value = {"messages": [{"ts": "1"}]}
        scope["capture_thread"](client, "CQ", "1")
        scope["sheets"].upsert_qa.assert_called_once()
        scope["notion"].upsert_qa.assert_called_once()

    def test_catchup_recording_off_keeps_both_ai_paths(self):
        scope = self.bot_scope(False)
        scope["sheets"].get_last_processed_ts.return_value = "1"
        scope["WebClient"].return_value.auth_test.return_value = {"user_id": "UB"}
        with patch.dict(os.environ, {"SLACK_BOT_TOKEN": "test-only"}):
            scope["run_catchup"]()
        scope["capture_qa_threads"].assert_not_called()
        scope["handle_ai_channel"].assert_called_once()
        scope["handle_ai_mentions"].assert_called_once()


if __name__ == "__main__":
    unittest.main()
