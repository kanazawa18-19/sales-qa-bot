"""外部通信せずNotebookLM固定・代替禁止を検証する。"""
import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import AsyncMock, patch


class NotebookBackendTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = Path(__file__).resolve().parents[1] / "src" / "ai_assistant.py"
        spec = importlib.util.spec_from_file_location("qa_ai_test", path)
        cls.module = importlib.util.module_from_spec(spec)
        # 旧Claude補助処理の依存をstubにし、初期化されれば失敗させる。
        stub = types.SimpleNamespace(Anthropic=lambda **kw: (_ for _ in ()).throw(AssertionError("Claude禁止")))
        with patch.dict(sys.modules, {"anthropic": stub}):
            spec.loader.exec_module(cls.module)

    def assistant(self):
        ai = self.module.AIAssistant.__new__(self.module.AIAssistant)
        ai._use_notebooklm = True
        ai._ask_claude = lambda *a, **k: self.fail("Claudeへ切り替わった")
        return ai

    def test_notebook_answer_is_returned_unchanged(self):
        ai = self.assistant()
        ai._ask_notebooklm = AsyncMock(return_value="NotebookLMの回答 [1]")
        self.assertEqual(ai.answer("質問", [], service_materials="別資料"), ("NotebookLMの回答 [1]", []))
        ai._ask_notebooklm.assert_awaited_once_with("質問")

    def test_notebook_failure_never_falls_back_or_leaks_details(self):
        ai = self.assistant()
        ai._ask_notebooklm = AsyncMock(side_effect=Exception("秘密の認証詳細"))
        with self.assertRaisesRegex(RuntimeError, "^NOTEBOOKLM_UNAVAILABLE$"):
            ai.answer("質問", [])

    def test_missing_auth_and_empty_answers_fail_closed(self):
        ai = self.assistant()
        ai._use_notebooklm = False
        with self.assertRaisesRegex(RuntimeError, "NOTEBOOKLM_NOT_CONFIGURED"):
            ai.answer("質問", [])
        ai._use_notebooklm = True
        for value in ["", "   ", None]:
            ai._ask_notebooklm = AsyncMock(return_value=value)
            with self.assertRaisesRegex(RuntimeError, "NOTEBOOKLM_EMPTY_ANSWER"):
                ai.answer("質問", [])

    def test_existing_anthropic_key_does_not_initialize_claude(self):
        with patch.dict("os.environ", {"ANTHROPIC_API_KEY": "test-only"}, clear=True):
            ai = self.module.AIAssistant()
            self.assertIsNone(ai._claude)


if __name__ == "__main__":
    unittest.main()
