import os
import asyncio
import logging
import tempfile

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

NOTEBOOK_ID = os.environ["NOTEBOOKLM_NOTEBOOK_ID"]
STORAGE_JSON = os.environ["NOTEBOOKLM_STORAGE_JSON"]


def _write_storage(json_str: str) -> str:
    tmp = tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False)
    tmp.write(json_str)
    tmp.close()
    return tmp.name


async def sync():
    from notebooklm import NotebookLMClient

    storage_path = _write_storage(STORAGE_JSON)

    async with NotebookLMClient.from_storage(path=storage_path) as client:
        sources = await client.sources.list(NOTEBOOK_ID)
        logger.info(f"Found {len(sources)} sources in notebook")

        for source in sources:
            try:
                await client.sources.refresh(NOTEBOOK_ID, source.id)
                logger.info(f"Refreshed source: {source.id}")
            except Exception as e:
                logger.warning(f"Failed to refresh source {source.id}: {e}")

    logger.info("Sync complete")


if __name__ == "__main__":
    asyncio.run(sync())
