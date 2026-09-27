# 本番反映と自然交代の実機確認

2026-09-27 主機CX。本人の「やりきって」により、本番反映と自然交代確認を実施。GAS・QA記録切替なし。Bot取消API・追加DM試験なし。

## 反映

- mainを4beaea5から46f10f6へfast-forward。HTTP版を含むslack-http全体は統合していない。
- 直前の未完了状態：in_progress 1件、queued/pending/waiting/requested各0件。旧schedule由来の未完了runなし。
- 反映後：旧run36304913260はin_progress、新push run36305363989はpending。旧Botは中断されず待機設定が作用。
- 停止確認workflowはactive。本人指示の確認範囲として手動実行36305396997を1回起動しsuccess、`BOT_RECOVERY_SKIPPED status=in_progress`を確認。通常Botの復旧要求なし。

## 最初の自然交代（UTC）

| 項目 | 実測 |
|---|---|
| 旧Bot処理開始 | 08:02:04 |
| 旧Bot処理終了 | 08:26:05、success |
| 終了ログ | BOT_PLANNED_ROTATION |
| 自己再起動ステップ | 08:26:05〜08:26:06、success |
| 旧run全体 | 36304913260、success |
| 新Bot | 36306181906、SHA46f10f6、workflow_dispatch |
| 新Bot処理開始 | 08:26:27 |
| 処理ステップ間の空白 | 22秒。Slack実受信可能時間の測定ではない |

push由来の待機run36305363989はcancelled。旧Botの自己再起動要求が同じ枠の待機を置換した結果で、稼働中Botの取消しではない。APIで確認した新Botは1件。

## 新設定の自己再起動

- 新run36306181906は08:50:27 UTCに`BOT_PLANNED_ROTATION`、Botステップ・run全体success。自己再起動ステップもsuccess（08:50:27〜08:50:29）。
- 後続run36307466241は08:50:28 UTC作成、SHA46f10f6、workflow_dispatch、in_progressを確認。
- 新Bot起動後の認証更新5件は全success：36306201194、36306469487、36306732657、36306996843、36307266826。
- 監視中に一覧APIが一度古い9月の履歴を返した。個別run36306181906でin_progressを確認し、再取得一覧も一致。停止や二重起動とは判断しなかった。
- watchdogはactive、手動実行でスキップ成功。08:51 UTC時点の履歴ではschedule由来の実行がまだ現れず、定期実行の到着は未確認。GitHub側の遅延・欠落の限界は従来どおり残る。

意図的な停止復旧・競合試験、長期連続運転、Slack回答の新規送信は実施していない。今回の完了範囲は限定差分の本番反映、旧Botを止めない自然交代、新Botからの後続自己再起動、停止確認のスキップである。
