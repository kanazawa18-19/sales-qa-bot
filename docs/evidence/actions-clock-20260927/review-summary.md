# GAS Actions時計の検証（2026-09-27）

## 実機で確認した範囲

- 準備用GASへ`ActionsClock.gs`を追加。保存後に再読込し、エディター全文をコピーしてローカル`gas/ActionsClock.js`と完全一致を確認。
- 12:21:49–12:21:50 JST、`healthActionsClock`成功。`enabled=false / migrationAck=false / tokenConfigured=false / triggerCount=0 / health=null / pendingAuthRequest=null / smoke=null`。
- 専用PAT未設定。GAS→Actions→NotebookLM→本人DMの通し試験は未実施。今回DM送信なし。過去の本人DM試験を今回の結果に転用していない。
- 本番mainは4beaea5。既存Bot run36289775187は調査時in_progress、直近認証更新5件はsuccess。状態取得だけで実回答成功とは判断しない。本番設定・GCP課金変更なし。

## ローカルと内部レビュー

- Python31件 / Node57件成功。新規テストは停止既定、POST結果不明時の再送禁止、固定DM、ID/本文ハッシュ、更新担当切替後の監視継続、保留要求通知を含む。
- QA担当がPython31/Node54を独立再実行。最終追加3テストをsecurity担当が含めて再確認し、新時計15件成功。親が最終全体Python31/Node57を再実行、失敗・スキップなし。先に標準Pythonで発生したFlask不足は一時環境で解消。
- security / quality / QAの3体で並列レビュー。BLOCKERなし。待機中Botの誤判定、保留ID/理由の欠落、継続異常の通知停止、Pythonテスト不足を修正。
- 本人DM単発試験は常駐Bot・記録処理を起動しない。通常Botのconcurrencyと別グループ。

## 他モデルレビュー

資料：`/private/tmp/sales-qa-clock-review/review.txt`、34,859 bytes、SHA256 `469822c4b2bbeefe3b9fcb7042f975b8aade530bae2c3184a5ddf03e5f115a4f`。認証値パターン0件、コード・手順のみ、顧客本文・回答本文なし。

- 最初にtxt添付を試したがChrome拡張のfile URLアクセス設定で失敗。browser-useでのタブ取得は自動承認審査が「Chrome操作は指定node_repl連携に限定」として拒否。繰り返さず、許可されたChrome連携で資料を貼付し、画面から空白除外の全文一致を確認して送信した。
- Gemini 3.6 Thinking：対応辞退。`gemini.txt`参照。レビュー完了には数えない。
- Claude Opus 5.5（中）：レビュー実施、原文`claude.txt`。B1は採用し、通常Botをmain限定・非mainのconcurrencyを分離。B2は結果不明の手動照合を求める可用性トレードオフとして記録し、自動再送は不採用。時間経過だけで未受付と断定できず、重複要求・古い認証snapshotの発生を避けるため。既存auth-refreshの30分schedule保険と通知を維持する。
- W3（拒否と不明の区別）、W5（通知連発）、I2（停止時の競合）、I7（保留照合テスト）は修正。W4のboolean問題は未検証の推測として保留、GitHub公式仕様のboolean入力に従う。W1のqueued snapshot検査は既存の古いSecret上書き防止として維持。W2は移行ACKと旧run交代確認を明示する。W6は既存cronが実行中Botを取消し得る問題で、今回GASが通常Botを起動しないこととは別。現行mainに同挙動があり、本番切替前の課題として引き継ぐ。
- 外部へ渡した資料は内部レビュー修正前。修正後をsecurity担当が再レビューし、B1修正済み・B2手動照合判断は妥当・確定BLOCKERなしを確認。通知の1時間制限により新しい障害通知も最大約1時間遅れる制約を残す。

## 残り

本人による対象リポジトリ限定・Actions読み書きのPAT設定後、停止中GASから単発試験を1回実行する。GAS要求ID・Actions開始・NotebookLM回答・DM投稿時刻を記録し、別のSlack読取で照合ID・本文ハッシュ・件数1を照合する。認証情報の貼付先・手順は`docs/actions-clock.md`。本番切替、定期起動の長期観測、露出認証情報の交換は未実施。
