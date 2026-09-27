"""GAS外側から稼働記録を読み、判定と実測資料を保存する。"""
import argparse
import datetime as dt
import json
import os
from pathlib import Path


def age(value, now):
    try:
        parsed = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
        seconds = (now - parsed).total_seconds()
        return seconds if seconds >= -60 else float('inf')
    except (TypeError, ValueError, AttributeError):
        return float('inf')


def assess(state, now):
    """判定は通信から分離。全周の暫定閾値は実測後に見直す。"""
    errors = []
    if state.get('schema') != 1:
        return ['監視データの形式が不明']
    for key, label, seconds in [('observedAt', 'GAS稼働記録', 20*60),
                                 ('lastRun', 'QA巡回成功', 30*60),
                                 ('lastRecentCycle', '新着巡回', 60*60),
                                 ('lastDeepCycle', '全履歴巡回', 24*60*60)]:
        if age(state.get(key), now) > seconds:
            errors.append(label + 'が停滞または未確認')
    if not state.get('enabled') or not state.get('clockEnabled'):
        errors.append('記録または時計が無効')
    if state.get('pollTriggers') != 1 or state.get('clockTriggers') != 1:
        errors.append('定期実行の登録数が1件ではない')
    clock = state.get('clock') or {}
    if age(clock.get('checkedAt'), now) > 20*60 or clock.get('ok') is not True:
        errors.append('GAS時計の成功が停滞または未確認')
    if age(clock.get('lastAuthSuccess'), now) > 40*60:
        errors.append('NotebookLM認証更新が停滞または未確認')
    health = state.get('health') or {}
    if health.get('status') == 'error':
        errors.append('QA巡回でエラー')
    if health.get('durationMs', 0) > 120000:
        errors.append('通常巡回の処理時間が120秒超')
    daily = state.get('daily') or {}
    if (now.timestamp()*1000 - 86400000 < daily.get('startedAt', 0) <= now.timestamp()*1000
            and daily.get('ms', 0) >= state.get('dailyLimitSeconds', 14400)*1000):
        errors.append('QA巡回の日次予算を消費（再開待ち）')
    return errors


def read_heartbeat():
    from google.oauth2.service_account import Credentials
    from googleapiclient.discovery import build
    credentials = Credentials.from_service_account_info(
        json.loads(os.environ['GOOGLE_SERVICE_ACCOUNT_JSON']),
        scopes=['https://www.googleapis.com/auth/spreadsheets.readonly'])
    service = build('sheets', 'v4', credentials=credentials, cache_discovery=False)
    rows = service.spreadsheets().values().get(
        spreadsheetId=os.environ['GOOGLE_SPREADSHEET_ID'],
        range="'GAS_HEALTH'!A1:B1").execute(num_retries=0).get('values', [])
    if len(rows) != 1 or len(rows[0]) != 2 or rows[0][0] != 'heartbeat':
        raise ValueError('HEARTBEAT_MISSING')
    return json.loads(rows[0][1])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--notify', action='store_true')
    args = parser.parse_args()
    now = dt.datetime.now(dt.timezone.utc)
    state = None
    try:
        state = read_heartbeat()
        errors = assess(state, now)
    except Exception:
        # 外部ライブラリの例外には接続情報が含まれ得るため本文を表示しない。
        errors = ['外部監視からGAS稼働記録を読み取れない']
    result = {'checkedAt': now.isoformat(), 'errors': errors, 'state': state}
    Path('monitor-evidence').mkdir(exist_ok=True)
    Path('monitor-evidence/health.json').write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print(json.dumps({'checkedAt':result['checkedAt'], 'errors':errors}, ensure_ascii=False))
    if args.notify and (errors or now.hour == 0 or os.environ.get('GITHUB_EVENT_NAME') == 'workflow_dispatch'):
        from runtime_ops import notify, run_link
        label = '要確認：' + '、'.join(errors) if errors else '稼働確認：GAS記録・時計・認証更新の時刻は正常です。'
        notify('Sales QA Bot 外部監視：' + label + '\nSlack回答や新着保存の実成功を保証する確認ではありません。' + run_link())
    return 1 if errors else 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception:
        print('EXTERNAL_MONITOR_FAILED')
        raise SystemExit(1)
