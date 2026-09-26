"""NotebookLM接続とSlack返信をHTTPワーカーから利用する。"""
import asyncio
import logging
import os
from pathlib import Path
import subprocess
import sys
import tempfile


class Secrets:
    def __init__(self, project):
        from google.cloud import secretmanager
        self.client = secretmanager.SecretManagerServiceClient()
        self.project = project

    def read(self, name):
        resource = f"projects/{self.project}/secrets/{name}/versions/latest"
        return self.client.access_secret_version(request={"name": resource}, timeout=15).payload.data.decode()

    def write(self, name, value):
        resource = f"projects/{self.project}/secrets/{name}"
        return self.client.add_secret_version(request={"parent": resource, "payload": {"data": value.encode()}}, timeout=15).name

    def prune(self, name, keep=2):
        # このBot専用の認証履歴だけを扱う。更新のたびに課金対象versionを増やさない。
        if name != "sales-qa-notebooklm":
            raise ValueError("AUTH_SECRET_ONLY")
        resource = f"projects/{self.project}/secrets/{name}"
        versions = list(self.client.list_secret_versions(request={"parent": resource, "filter": "state:(ENABLED OR DISABLED)"}, timeout=15))
        live = [v for v in versions if v.state.name != "DESTROYED"]
        live.sort(key=lambda v: int(v.name.rsplit("/", 1)[1]), reverse=True)
        for version in live[keep:]:
            self.client.destroy_secret_version(request={"name": version.name}, timeout=15)


class NotebookAnswers:
    def __init__(self, secrets, notebook_id):
        self.secrets, self.notebook_id = secrets, notebook_id

    def __call__(self, question):
        from notebooklm import NotebookLMClient
        async def ask(path):
            async with NotebookLMClient.from_storage(path=path) as client:
                result = await client.chat.ask(self.notebook_id, question)
                return result.answer
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "storage.json"
            path.write_text(self.secrets.read("sales-qa-notebooklm"))
            path.chmod(0o600)
            # 接続方式は既存と同じ。Claudeへの切替は行わない。
            return asyncio.run(ask(str(path)))

    def refresh(self):
        import json
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "storage.json"
            path.write_text(self.secrets.read("sales-qa-notebooklm"))
            path.chmod(0o600)
            env = dict(os.environ)
            env.pop("NOTEBOOKLM_STORAGE_JSON", None)
            subprocess.run([sys.executable, "-m", "notebooklm", "--storage", str(path), "auth", "refresh"],
                           capture_output=True, timeout=150, check=True, env=env)
            result = subprocess.run([sys.executable, "-m", "notebooklm", "--storage", str(path),
                                     "auth", "check", "--test", "--json"], capture_output=True,
                                    text=True, timeout=90, check=True, env=env)
            if json.loads(result.stdout).get("status") != "ok":
                raise RuntimeError("NOTEBOOKLM_AUTH_CHECK_FAILED")
            version = self.secrets.write("sales-qa-notebooklm", path.read_text())
            # 新versionを読み直し、保存先へ到達したことを確認する。
            if self.secrets.read("sales-qa-notebooklm") != path.read_text():
                raise RuntimeError("NOTEBOOKLM_SAVE_VERIFY_FAILED")
            self.secrets.prune("sales-qa-notebooklm")
            return version


class SlackIO:
    def __init__(self, token, bot_user, team):
        from slack_sdk import WebClient
        self.client = WebClient(token=token, retry_handlers=[], timeout=25)
        identity = self.client.auth_test()
        if identity.get("user_id") != bot_user or identity.get("team_id") != team:
            raise RuntimeError("SLACK_IDENTITY_MISMATCH")

    def send(self, work, answer):
        result = self.client.chat_postMessage(channel=work.channel, thread_ts=work.thread_ts,
                                            text=answer, unfurl_links=False, unfurl_media=False)
        if not result.get("ok") or not result.get("ts"):
            raise RuntimeError("SLACK_POST_FAILED")
        return result["ts"]

