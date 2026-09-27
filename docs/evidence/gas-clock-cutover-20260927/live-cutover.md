# GAS時計切替の実機記録

2026-09-27 主機CX。本人の切替完了指示に基づく。通常Bot取消し・本人DM試験・QA記録切替なし。

- GAS ActionsClock最終コードを保存し、再読込・全コピーで完全一致。既存PAT・通知先・smoke記録は保持。
- startActionsClockを19:39:04 JSTに実行、1.597秒・成功、CLOCK_STARTED triggerCount=1。トリガー画面で時間主導型1件、編集画面の選択状態で5分おきを確認（保存せず閉じた）。
- 初回定期tick 19:40:36 JST、時間主導型、8.241秒、成功。healthはok=true / botActive=true / pendingRecoveryRequest=null / elapsedMs=6971。
- requestId=0a806592-0c67-4c0d-8c20-002235e125baをGitHub run36313299929の実行名と照合。runはsuccess、10:41:03.769 UTCにAUTH_REFRESH_AND_SECRET_SAVE_OKを確認。
- 初回成功後、GitHub変数AUTH_CLOCK_OWNER=gasを保存・読戻し。旧Botは起動時のbot設定を保持するため、自然交代を監視中。

- 19:45定期tickで成功履歴がnull・旧要求が残りCLOCK_AUTH_STALEを検知。GitHubでは実成功を確認できたが一覧応答の不整合の原因は未確定。AUTH_CLOCK_OWNERをbotへ戻し、通常Botは取消さなかった。
- 成功確認はstatus=successの1件、保留照合はworkflow_dispatch＋要求時刻で絞った別問い合わせへ変更し、no-cacheを追加。GASへ保存後、再読込・全コピーでローカル修正版と完全一致。
- 19:50:36定期tick、10.154秒・完了。ok=true、lastAuthRunId=36313750252、authRequestHistoryCount=3、旧要求解除後requestId=e013dc9f-f7bc-40cd-950d-a65462432019を新規受付。対応run36313834822のrefresh jobは10:51:04 UTCにsuccess（workflow一覧自体はin_progressの応答を保持していた）。
- Node全75件成功。独立QAも同じ75件を成功し、回帰テスト不足BLOCKERを解消。securityは確定BLOCKERなし、実機照合を条件とした。
- AUTH_CLOCK_OWNERをgasへ再設定・読戻し。旧Bot36312608087は自然終了success、新d74c535の36313905691が10:52:19 UTCに処理開始。この起動は変数再設定より前のため、次の自然交代を待つ。

- 19:55:36定期tickも8.527秒・完了。ok=true、lastAuthRunId=36313921666、authRequestHistoryCount=2、pendingAuthRequest=null、pendingRecoveryRequest=null、botActive=true。修正後2回連続の正常判定と保留解除を確認。
- 定期到達確認後、watchdog保険だけ47 */4 * * *へ変更。auth-refreshは17,47 * * * *の30分保険を維持。

残り：時計担当gasの自然交代確認。
