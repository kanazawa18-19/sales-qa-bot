# GAS時計の切替準備・確認結果

2026-09-27 主機CX。本人の「完了させろよ」でGAS時計切替まで指示あり。現行main=c7310c8を基準に専用gas-clock-mainへ準備。HTTP版・QA記録変更なし。本番GASと時計担当は未変更。

## 準備内容

GAS5分時計が既存auth-refreshを起動し、Botの未完了5状態が全て0件なら既存watchdogへ停止確認を要求する。watchdogが直前の状態を再確認してBot復旧を要求する。通常Bot取消しなし。認証・復旧それぞれの要求を照合IDで保持し、結果不明の再送を抑止。不完全な状態一覧では復旧要求なし。通知の理由とActionsへの案内を日本語にした。

AUTH_CLOCK_OWNER=gasでBotの認証起動だけを止め、鮮度確認を維持。GAS実到達確認後に時計担当を切り替える。GitHubの30分保険は維持し、GAS定期到達確認後だけ4時間へ緩める。

## 独立レビュー・テスト

- shirokuma-sec：確定BLOCKER/WARNなし。本人DM試験の入力定義不足指摘は送信先branch取り違えで撤回。slack-httpの入力定義は既存。
- obasan-quality：確定BLOCKERなし。手順順序・仕様説明・通知文のWARNを修正。
- kuma-qa：Node34件・Python6件成功、YAML5件構文成功。30分保険保持も確認。実物操作なし。
- 他社2モデル：今回の新差分レビューは未実施。Chrome接続不良のため。既存GAS時計とwatchdogの過去レビューは新差分のレビュー完了とは扱わない。

## 実機作業を妨げていること

Chrome連携の軽い操作が2回とも`Unable to load browser request-header policy`で失敗。公式診断4本でChrome起動中、Profile18の拡張installed/enabled、native host設定correctを確認。設定の手修正、他方式のブラウザ操作、Chrome/ChatGPT再起動はしていない。公式chrome-troubleshooting手順は、全診断正常で通信失敗の場合に本人承認後の専用profileウィンドウ起動を案内している。

GAS保存・トリガー登録・定期到達・GitHubでの認証実成功・時計担当切替は未実施。現行Botは既存時計を維持。次はChrome接続復旧→他社レビュー→GAS保存・保存一致照合→限定main反映→GAS時計有効化と定期実到達→AUTH_CLOCK_OWNER切替→自然交代確認。
