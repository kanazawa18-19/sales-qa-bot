# GAS時計の切替準備・確認結果

2026-09-27 主機CX。本人の「完了させろよ」でGAS時計切替まで指示あり。現行main=c7310c8を基準に専用gas-clock-mainへ準備。HTTP版・QA記録変更なし。当初準備後、本人承認に基づき本番GASと時計担当を切替完了。最終実機結果はlive-cutover.md。

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

## Chrome復旧後の追加確認

本人が専用ウィンドウ起動を承認。公式スクリプトの通常実行はOS起動エラー、承認されたsandbox外実行でProfile18専用ウィンドウを開きChrome接続復旧。GAS ActionsClockを保存、再読込して全コピー一致を確認。

Gemini Thinking（https://gemini.google.com/app/42a918a466e1b388?hl=ja）とClaude Opus5.5中（https://claude.ai/chat/67ef233b-7e71-4a4d-b3f4-575584fd29fd）へ新差分を送信・回答取得完了。資料27271 bytes、SHA256 cd0093a59deb6e353b652268612f44007edb498c57e8948ebdbf7275f10ed46a、鍵パターン0件。txt添付は拡張ファイルURL権限で失敗、権限変更なしで同じ資料を専用入力へ挿入。Gemini入力とClaude貼付資料プレビューの空白除外全文一致を確認。原文gemini.txt/claude.txt。

- Gemini：試験のclock_request_id未定義BLOCKERはslack-http版の定義で誤検知と判定。待機中の稼働判定と通知の限界は既知として残す。
- Claude：本人試験が本番枠を共有する条件付きBLOCKERはslack-httpの本人試験別group・通常Bot起動除外で解消。今回本人DM試験を実行しない。認証保険4時間化の条件付きBLOCKERを採用し、auth-refreshの30分保険は維持、watchdogだけGAS実機確認後4時間化とした。結果不明や確定拒否の自動解除は不採用（GAS安全側の保留を維持）。旧Botが起動時設定を保持する点は自然交代確認で対応。GAS停止時の外側監視、起動準備失敗連鎖は別改善として残す。
- 小追加：設定済み鍵/通知先を保持して有効化するstartActionsClock、runtimeの時計担当起動ログを追加。独立sec/QAでBLOCKERなし、Node36/Python6成功。GAS実機有効化・定期到達は次の確認。

設定確認の再実行をauto-reviewが拒否。実行履歴を読んで、最初の実行が停止中tickActionsClockでありhealth未実行だったことを確認。healthActionsClockがgetProperty/getProjectTriggers/console.logだけで書込や通信が無いことをコードで検証し、正しい選択状態からの初回health実行は通常審査で許可・成功。enabled=false、migrationAck=false、tokenConfigured=true、triggerCount=0、保留認証/復旧null、既存smoke記録保持を確認。

## 実機での照合不具合への対応

19:45のtickで成功履歴を見失い旧保留が残ったため、時計担当をbotへ戻して通常Botを維持。原因は未確定。成功1件と時刻限定dispatch履歴へ問い合わせを分離しno-cacheを追加。独立sec確定BLOCKERなし。QA指摘の回帰テスト不足を追加で解消し、独立QAと実装者がNode全75件成功。保存一致後19:50・19:55の定期tickが両方ok=true、旧保留解除・新要求のGitHub refresh job成功を確認。詳細はlive-cutover.md。
