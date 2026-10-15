"""資料種別・部分失敗・秘密情報の扱いを通信なしで確認する。"""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

spec = importlib.util.spec_from_file_location('source_sync', Path(__file__).resolve().parents[1] / 'src/sync.py')
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)


class SyncTests(unittest.IsolatedAsyncioTestCase):
    async def test_drive_pdf_included_uploads_web_and_youtube_skipped(self):
        sources = [SimpleNamespace(id=str(i), drive_document_id='drive' if i < 3 else None) for i in range(6)]
        client = SimpleNamespace(sources=SimpleNamespace(list=AsyncMock(return_value=sources), refresh=AsyncMock(return_value=None)))
        counts = await sync.refresh_sources(client, 'notebook')
        self.assertEqual(counts, dict(total=6, refreshed=3, skipped=3, failed=0))
        self.assertEqual(client.sources.refresh.await_count, 3)

    async def test_partial_failure_count_and_safe_log(self):
        source = SimpleNamespace(id='source-id', drive_document_id='secret-drive-id')
        client = SimpleNamespace(sources=SimpleNamespace(list=AsyncMock(return_value=[source]), refresh=AsyncMock(side_effect=RuntimeError('private-token'))))
        with self.assertLogs(sync.logger) as logs:
            counts = await sync.refresh_sources(client, 'notebook')
        self.assertEqual(counts['failed'], 1)
        self.assertNotIn('private-token', str(logs.output))
        self.assertNotIn('secret-drive-id', str(logs.output))

    async def test_unknown_metadata_fails_instead_of_skip(self):
        client = SimpleNamespace(sources=SimpleNamespace(list=AsyncMock(return_value=[SimpleNamespace(id='id')])))
        with self.assertRaisesRegex(RuntimeError, 'METADATA_UNSUPPORTED'):
            await sync.refresh_sources(client, 'notebook')


class ExitTests(unittest.TestCase):
    def test_failure_exit(self):
        with patch.object(sync, 'sync', AsyncMock(side_effect=RuntimeError('private-token'))):
            self.assertEqual(sync.main(), 1)

class FailureCodeTests(unittest.TestCase):
    def test_structured_codes_only(self):
        for rpc_code, expected in [(7, 'permission_denied'), ('3', 'invalid_argument'), (16, 'auth'), (99, 'unknown')]:
            error = RuntimeError('private-token')
            error.rpc_code = rpc_code
            self.assertEqual(sync.failure_code(error), expected)
        self.assertEqual(sync.failure_code(TimeoutError('private-token')), 'timeout')
        self.assertEqual(sync.failure_code(RuntimeError('permission denied private-token')), 'unknown')

    def test_partial_failure_exits_nonzero_through_main(self):
        import sys
        from unittest.mock import Mock
        source = SimpleNamespace(id='source-id', drive_document_id='drive-id')
        client = SimpleNamespace(sources=SimpleNamespace(list=AsyncMock(return_value=[source]), refresh=AsyncMock(side_effect=RuntimeError('private-token'))))
        context = AsyncMock()
        context.__aenter__.return_value = client
        factory = Mock(return_value=context)
        module = SimpleNamespace(NotebookLMClient=SimpleNamespace(from_storage=factory))
        with patch.dict(sys.modules, {'notebooklm': module}), patch.dict(sync.os.environ, {'NOTEBOOKLM_STORAGE_JSON': '{}', 'NOTEBOOKLM_NOTEBOOK_ID': 'notebook'}):
            self.assertEqual(sync.main(), 1)
        self.assertFalse(Path(factory.call_args.kwargs['path']).exists())
