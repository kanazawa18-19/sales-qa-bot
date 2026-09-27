"""Botの寿命管理と、単一workflowによる認証更新・本人通知。"""
import argparse
import datetime as dt
import json
import logging
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

import requests

OWNER_DM = "D0B87Q9U54G"
REPO = "kanazawa18-19/sales-qa-bot"
BASE = f"https://api.github.com/repos/{REPO}"


def github(method, path, **kwargs):
    response = requests.request(method, BASE + path, headers={
        "Authorization": "Bearer " + os.environ["GH_TOKEN"],
        "Accept": "application/vnd.github+json",
    }, timeout=25, **kwargs)
    response.raise_for_status()
    return response.json() if response.content else {}


def run_link():
    return "\nhttps://github.com/" + REPO + "/actions/runs/" + os.environ.get("GITHUB_RUN_ID", "")


def notify(text):
    # 投稿は本人専用DMへ1回だけ。結果不明時の自動再送はしない。
    response = requests.post("https://slack.com/api/chat.postMessage", headers={
        "Authorization": "Bearer " + os.environ["SLACK_BOT_TOKEN"],
    }, json={"channel": OWNER_DM, "text": text,
             "unfurl_links": False, "unfurl_media": False}, timeout=25)
    response.raise_for_status()
    result = response.json()
    if not result.get("ok") or result.get("channel") != OWNER_DM:
        raise RuntimeError("OWNER_NOTIFICATION_FAILED")


def previous_refresh_runs():
    current = os.environ.get("GITHUB_RUN_ID")
    return [run for run in github("GET", "/actions/workflows/auth-refresh.yml/runs?per_page=100")["workflow_runs"]
            if str(run["id"]) != current and run["status"] == "completed"
            and run["conclusion"] in {"success", "failure", "timed_out"}]


def refresh():
    """更新担当はこのworkflowだけ。Botからは起動要求だけを送る。"""
    stage = "CONFIGURATION"
    path = None
    started = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
    try:
        stage = "SECRET_SNAPSHOT_CHECK"
        original = github("GET", "/actions/secrets/NOTEBOOKLM_STORAGE_JSON")["updated_at"]
        run = github("GET", "/actions/runs/" + os.environ["GITHUB_RUN_ID"])
        if original > run["created_at"]:
            raise RuntimeError("QUEUED_SECRET_SNAPSHOT_IS_OLD")
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as storage:
            path = storage.name
            storage.write(os.environ["NOTEBOOKLM_STORAGE_JSON"])
        stage = "GOOGLE_AUTH_REFRESH"
        child_env = dict(os.environ)
        child_env.pop("NOTEBOOKLM_STORAGE_JSON", None)
        subprocess.run([sys.executable, "-m", "notebooklm", "--storage", path, "auth", "refresh"],
                       capture_output=True, timeout=180, check=True, env=child_env)
        stage = "NOTEBOOKLM_REACH_CHECK"
        json.loads(Path(path).read_text())
        check = subprocess.run([sys.executable, "-m", "notebooklm", "--storage", path,
                                "auth", "check", "--test", "--json"],
                               capture_output=True, text=True, timeout=90, check=True, env=child_env)
        if json.loads(check.stdout).get("status") != "ok":
            raise RuntimeError("AUTH_CHECK_FAILED")
        stage = "SECRET_CHANGED_DURING_REFRESH"
        if github("GET", "/actions/secrets/NOTEBOOKLM_STORAGE_JSON")["updated_at"] != original:
            raise RuntimeError("CONCURRENT_SECRET_CHANGE")
        stage = "SECRET_SAVE"
        with open(path) as storage:
            subprocess.run(["gh", "secret", "set", "NOTEBOOKLM_STORAGE_JSON", "--repo", REPO],
                           stdin=storage, capture_output=True, timeout=60, check=True, env=child_env)
        stage = "SECRET_VERIFY"
        metadata = github("GET", "/actions/secrets/NOTEBOOKLM_STORAGE_JSON")
        saved_at = dt.datetime.fromisoformat(metadata["updated_at"].replace("Z", "+00:00"))
        if metadata["updated_at"] <= original:
            raise RuntimeError("SECRET_TIMESTAMP_NOT_UPDATED")
    except Exception:
        print(f"AUTH_REFRESH_FAILED stage={stage}", flush=True)
        try:
            try:
                previous = previous_refresh_runs()
            except Exception:
                previous = []
            if not previous or previous[0]["conclusion"] != "failure":
                label = {"GOOGLE_AUTH_REFRESH": "Googleログインの更新", "SECRET_SAVE": "接続情報の保存", "SECRET_VERIFY": "保存結果の確認", "NOTEBOOKLM_REACH_CHECK": "NotebookLMへの接続確認", "SECRET_SNAPSHOT_CHECK": "待機中に古くなった接続情報の検出", "SECRET_CHANGED_DURING_REFRESH": "更新の競合確認"}.get(stage, "更新設定の確認")
                notify(f"Sales QA Bot：{label}で認証更新に失敗しました。回答できなくなる可能性があります。" + run_link())
        except Exception:
            print("OWNER_NOTIFICATION_FAILED", flush=True)
        return 1
    finally:
        if path:
            Path(path).unlink(missing_ok=True)
    print("AUTH_REFRESH_AND_SECRET_SAVE_OK", flush=True)
    try:
        previous = previous_refresh_runs()
        today = started.date().isoformat()
        today_success = any(run["conclusion"] == "success" and run["created_at"].startswith(today)
                            for run in previous)
        if not today_success or (previous and previous[0]["conclusion"] != "success"):
            notify("Sales QA Bot：NotebookLM認証の更新・保存が成功しました。これは認証更新の確認で、回答処理全体の保証ではありません。")
    except Exception:
        print("::warning::認証保存は成功しましたが本人への稼働通知に失敗しました", flush=True)
    return 0


def dispatch_refresh():
    github("POST", "/actions/workflows/auth-refresh.yml/dispatches", json={"ref": "main"})
    print("AUTH_REFRESH_DISPATCHED", flush=True)


def supervise(duration=24 * 60, interval=5 * 60):
    root = Path(__file__).resolve().parents[1]
    child = subprocess.Popen([sys.executable, "bot.py"], cwd=root / "src")
    launched = time.monotonic()
    deadline = launched + duration
    next_refresh = 0
    warned = False
    try:
        while time.monotonic() < deadline:
            if child.poll() is not None:
                print("BOT_EXITED_EARLY", flush=True)
                try:
                    prior = github("GET", "/actions/workflows/bot.yml/runs?per_page=30")["workflow_runs"]
                    prior = [r for r in prior if str(r["id"]) != os.environ.get("GITHUB_RUN_ID")
                             and r["head_branch"] == "main" and r["status"] == "completed"]
                    if not prior or prior[0]["conclusion"] != "failure":
                        notify("Sales QA Bot：Botが予定より早く停止しました。再起動を試みます。" + run_link())
                except Exception:
                    print("OWNER_NOTIFICATION_FAILED", flush=True)
                time.sleep(max(0, 300 - (time.monotonic() - launched)))
                return 1
            if time.monotonic() >= next_refresh:
                try:
                    if os.environ.get("AUTH_CLOCK_OWNER", "bot") != "gas":
                        dispatch_refresh()
                    recent = previous_refresh_runs()
                    last_success = next((r for r in recent if r["conclusion"] == "success"), None)
                    if time.monotonic() - launched >= 600 and (not last_success or time.time() - dt.datetime.fromisoformat(
                            last_success["updated_at"].replace("Z", "+00:00")).timestamp() > 30 * 60):
                        raise RuntimeError("AUTH_REFRESH_STALE")
                except Exception:
                    print("AUTH_SCHEDULER_UNHEALTHY", flush=True)
                    if not warned:
                        try:
                            notify("Sales QA Bot：認証更新の定期起動または最終成功時刻に異常があります。自動更新の確認が必要です。")
                        except Exception:
                            print("OWNER_NOTIFICATION_FAILED", flush=True)
                        warned = True
                next_refresh = time.monotonic() + interval
            time.sleep(2)
        print("BOT_PLANNED_ROTATION", flush=True)
        return 0
    finally:
        if child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=30)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=10)


def main():
    logging.disable(logging.CRITICAL)
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["supervise", "refresh", "restart-failed"])
    command = parser.parse_args().command
    if command == "refresh":
        return refresh()
    if command == "supervise":
        return supervise()
    notify("Sales QA Bot：次の実行への引継ぎに失敗しました。定期起動による復帰待ちです。")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        print("RUNTIME_OPERATION_FAILED", flush=True)
        sys.exit(1)
