# HTTP受信版の検証記録（2026-09-27）

## 実施範囲

- 検証コミット ca02be5、ブランチ slack-http。mainは4beaea5のまま。
- 本人DM試験 run [36273951397](https://github.com/kanazawa18-19/sales-qa-bot/actions/runs/36273951397) 成功。通常run-bot/旧owner-dm-smokeはskip。
- ローカルHTTPへ署名付き模擬イベント2回、キュー1件、Worker2回、Slack返信1件。NotebookLM実回答1313文字、Claude代替なし。
- 別のSlack読取経路で親1件・返信1件、Bot ID/ts一致を確認。[対象DM](https://cnctor.slack.com/archives/D0B87Q9U54G/p1790459074878739)。親1790459074.878739、返信1790459114.726759。
- 受付2回合計0.005秒はローカルMemoryQueueの値。実Slackイベント受信、Cloud Run/Tasks/Firestore、クラウド3秒応答、GAS実トリガーは未検証。
- Python27件、GAS既存38件+時計4件成功。内部3体レビュー実施。外部レビュー後の時間制限などはローカル回帰で確認し、DM再投稿は行わない。
- 現行mainの認証更新は21:17、21:22、21:27、21:32、21:37、21:41 UTCに成功（6件）。次Bot run36273788900起動確認。長期無停止/認証永久有効の保証ではない。

## 他モデルレビュー

資料24539 bytes、SHA256 f18124cbbc49f72ed83389008a7ec1396d7278195d1870cb7ed08df4f1dea246。秘密値・顧客情報を含まないコード8ファイル。API未使用。

- Claude Opus5.5中：[会話](https://claude.ai/chat/17d9c6a4-1b54-4baf-aa55-d7c89c8b12c0)。txt添付、読込完了と短文27字/hash31=839204582照合後送信。回答完了確認、原文claude.txt。
- Gemini Thinking：[会話](https://gemini.google.com/app/c6648af54bd7f886?hl=ja)。添付UIが反応しないため本文挿入へ切替。送信前に空白除外全文一致確認、回答完了確認、原文gemini.txt。

| 指摘 | 判断 |
|---|---|
| 両モデル：本人DMで応答しない | 今回はAI_CHANNEL_ID=OWNER_DM_IDを配置コード/実試験で明示。実回答成功。条件の読み落としで確定BLOCKERではない。スレッド内の通常返信は仕様上対象外。 |
| Gemini：dispatchDeadlineがhttpRequest内 | 実コードはtask直下。Nodeテストでもtask.dispatchDeadline=300s確認。誤検知。 |
| Gemini：state:(ENABLED OR DISABLED)が無効 | [公式filter例](https://docs.cloud.google.com/secret-manager/docs/filtering)に同一構文掲載。誤検知。 |
| Claude：回答時間上限/lease残時間 | 採用。180秒上限、送信前残り60秒を確認、送信期間lease更新。 |
| Claude：認証失敗タスク蓄積 | 採用。失敗通知後200、次GAS周期で再試行。 |
| Claude：キュー上限/同時数未定義 | 提示資料にdeployファイル未添付だった。既存max-attempts8、worker concurrency1、receiver threads/concurrency10。再試行期間1800秒も明示追加。 |
| Claude：署名非ASCII | 採用。bytesで比較し500を防止。 |
| Gemini：成功state=retry | 採用。idleに変更。 |
| OAuth scope、IAM、TTL、バージョン固定 | 既存手順/配置案/requirementsにあり。実配置時に確認。 |
| 質問者向け受付・最終失敗案内 | 共同利用前の必須項目として残す。本人DM準備版と区別。 |
| 他Bot投稿を全除外 | Workflow投稿の回答という既存要件に反するため不採用。自Botは除外済み。 |

確定BLOCKERなし。配置時はCloud Tasks OIDC→Cloud Run IAM→アプリ検証の実配送と、署名不正拒否・重複配送・応答時間を検証する。
