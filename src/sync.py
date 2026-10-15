"""Driveに接続した資料だけを更新し、部分失敗を失敗として返す。"""
import asyncio
import logging
import os
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)


def failure_code(error):
    """例外本文を出さず、構造化コードと例外型だけで分類する。"""
    code = str(getattr(error, 'rpc_code', ''))
    if code == '7':
        return 'permission_denied'
    if code == '3':
        return 'invalid_argument'
    names = {cls.__name__ for cls in type(error).__mro__}
    if code == '16' or names & {'AuthError', 'AuthenticationError', 'HeadlessReauthError'}:
        return 'auth'
    if isinstance(error, TimeoutError) or names & {'TimeoutException', 'TimeoutError'}:
        return 'timeout'
    return 'unknown'


async def refresh_sources(client, notebook_id):
    sources = await client.sources.list(notebook_id)
    counts = dict(total=len(sources), refreshed=0, skipped=0, failed=0)
    for source in sources:
        if not hasattr(source, 'drive_document_id'):
            raise RuntimeError('SOURCE_METADATA_UNSUPPORTED')
        if not source.drive_document_id:
            counts['skipped'] += 1
            continue
        try:
            await client.sources.refresh(notebook_id, source.id)
            counts['refreshed'] += 1
        except Exception as error:
            counts['failed'] += 1
            # 例外本文・タイトル・Drive IDには機密情報が含まれ得る。
            logger.error('SOURCE_REFRESH_FAILED source_id=%s code=%s', source.id, failure_code(error))
    logger.info('SOURCE_SYNC_COUNTS %s', counts)
    return counts


async def sync():
    from notebooklm import NotebookLMClient
    # SDKはimport時に独自handlerとWARNINGを再設定するため、import後に抑制する。
    # 子loggerからの伝播とrootへの二重出力も止め、安全な自前の結果だけを残す。
    for name in ('notebooklm', 'httpx', 'httpcore'):
        sdk_logger = logging.getLogger(name)
        sdk_logger.setLevel(logging.CRITICAL + 1)
        sdk_logger.handlers[:] = [logging.NullHandler()]
        sdk_logger.propagate = False
    with tempfile.TemporaryDirectory() as directory:
        storage = Path(directory) / 'storage.json'
        storage.write_text(os.environ['NOTEBOOKLM_STORAGE_JSON'])
        storage.chmod(0o600)
        async with NotebookLMClient.from_storage(path=str(storage)) as client:
            counts = await refresh_sources(client, os.environ['NOTEBOOKLM_NOTEBOOK_ID'])
    if counts['failed']:
        raise RuntimeError('SOURCE_SYNC_PARTIAL_FAILURE')
    return counts


def main():
    logging.basicConfig(level=logging.WARNING, format='%(levelname)s %(message)s')
    logger.setLevel(logging.INFO)
    try:
        asyncio.run(sync())
        return 0
    except Exception:
        logger.error('SOURCE_SYNC_FAILED')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
