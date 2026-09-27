# 追加GCPなしのGAS優先構成の検討

2026-09-27。対象コード c90d57b（slack-http）、本番 origin/main 4beaea5。
今回の完了範囲は、公式仕様・実装・既存運転の照合と構成の絞り込み。新構成の配置・実配送試験は行っていない。

## 結論

追加GCPは必須ではない。第一候補は、既存PythonのSlack常時接続とNotebookLMを維持し、QA記録と起動の時計をGASへ寄せる構成。GAS WebアプリへSlackイベントを直接送る案は、標準の受信イベントから署名ヘッダーを取得できず、そのまま採用できない。

```text
Slack発言 → 既存Python常時接続 → NotebookLM → Slack返信
QA履歴    → GAS巡回           → Sheets / Notion
GAS時計   → 既存GitHub Actions → 認証更新・停止時の復旧
```

最後の2行は移行候補で、現在の稼働設定ではない。現在のGASコードはQA記録専用。GASのWeb画面を質問入口にすることも可能性はあるが、Slack内で発言する現行の操作から変わり、Pythonへの受渡しも別途必要。

## 3つの論点

| 論点 | 確認した事実 | 判断・未検証 |
|---|---|---|
| Slack署名 | GAS doPostの公式イベント項目にHTTPヘッダーなし。Slack署名にはX-Slack-SignatureとX-Slack-Request-Timestampが必要 | 標準GASへの直接配送だけでは要件を満たせない。本文の旧Verification Tokenや秘密URLで代用しない |
| 3秒受付 | HTTP Eventsは3秒以内の2xxが必要。Socket Modeは認証済み接続で個別HTTP署名不要、イベント受付確認は必要 | 既存Socket Modeなら公開HTTP受信口は不要。GAS直接受信の3秒性能は実測していない |
| NotebookLM | src/ai_assistant.pyはNotebookLMClient.from_storage→chat.ask。既存更新処理はPython CLIで更新→実接続→GitHub Secret保存 | GASのGoogle OAuthがNotebookLMのCookie認証を代替する実証はない。既存Pythonを残せば移植は不要 |

GASのUrlFetchAppは外向きHTTPのヘッダー・本文を指定できる。したがって「PythonライブラリだからGAS移植は原理的に不可能」とは判断しない。ただし、導入済みnotebooklm-py 0.8.3の認証実装にはCookie管理、HTMLからのトークン抽出、更新と競合処理があり、単純な1回のfetchへの置換ではない。GAS実機からのNotebookLM回答、Cookie更新、失効からの復旧は未検証。今回Cookieの新規移送・更新担当の追加はしていない。

## 選択肢と待ち時間

| 構成 | 追加GCP | 発言検出・待ち時間 | 残る仕事 |
|---|---|---|---|
| 既存Socket Mode＋GAS記録・時計（第一候補） | 不要 | 接続中はイベント配送。実測の上限保証なし | GAS時計と記録の実試験、Bot再起動時の空白測定 |
| GAS巡回→GitHub単発Python→NotebookLM | 不要 | 5分周期なら理想条件で検出待ち0〜5分、平均2.5分。その後Actions起動待ち＋回答時間 | 質問台帳、受渡し、重複防止、古いスレッドの検出、実遅延測定 |
| GAS Web画面→GitHub単発Python | 不要 | 画面への登録後、Actions起動待ち＋回答時間 | Slack発言から画面入力へ操作変更。利用者認証と受渡しが必要 |
| GAS直接HTTP受信→NotebookLMまでGAS | 未確定 | 3秒受付と非同期回答の両方が未実証 | 署名ヘッダー問題、NotebookLM接続・認証保守 |
| 既存Cloud HTTP案 | 必要 | 3秒以内を実配置で要検証 | 課金・配置を保留。今回の採用前提にしない |

巡回の平均2.5分は発言時刻が周期内に一様、遅延・滞留なしという計算値。実測ではない。1分周期なら同条件で0〜1分・平均30秒だが、GAS利用枠・Slack API制限・Actions起動待ちが増える。古い親への新しい返信は新着親だけの取得では漏れるため、全履歴巡回の一周時間が加わり得る。現行gas/Core.jsは継続カーソルを持つが、回答への受渡しは実装されていない。gas/Main.jsはnotebooklm_external時の回答を明示拒否するため、時計をONにするだけでは巡回回答Botにならない。

Slackのhistory/repliesは社内向けアプリと社外商用配布で制限が異なる。全アプリ一律1分1回・15件とは扱わない。実トークンの取得権限、ページ数、429応答は本人用試験で確認する。GASの実行上限は1回6分、トリガー合計は一般アカウント90分/日・Workspace6時間/日。毎分巡回の採用前に実行時間を測る。

## 今回読み取った運転状態

- git fetch成功、slack-http=c90d57b、origin/main=4beaea5、開始時に変更・未pushコミットなし。
- GitHub APIのrepository.private=false。公開リポジトリでubuntu-latestの標準runnerを使用。非公開GitHub Freeの月2,000分枠を今回の費用根拠には使わない。標準runnerの公開リポジトリ利用は無料だが、保存容量等の料金や運用安定性まで無料保証する意味ではない。公開範囲の変更は行っていない。
- 取得した直近12 run中、認証更新9件はすべてsuccess。作成時刻は2026-09-26 21:17:17〜21:56:44 UTC（日本時間9/27 06:17:17〜06:56:44）。run ID：36272409665, 36272698927, 36272993755, 36273287423, 36273576536, 36273804832, 36274081206, 36274362364, 36274634489。
- Bot run36273788900は取得時in_progress。常時受信・回答成功をその状態だけでは保証しない。
- 前回の模擬HTTP→実NotebookLM→本人DM1件成功は既存証拠。今回はDMを再送していない。
- アプリコードを変更していないため、前回Python27/GAS42成功を今回の再実行結果としては扱わない。

## 次の実装・検証の完了条件

2026-09-27追記：停止既定のActions時計と本人DM単発試験経路を実装。手順は[actions-clock.md](actions-clock.md)。時計は認証更新だけを起動し、常駐Botの復旧は既存自己再起動とGitHubの保険を維持する。GAS実機への保存・停止確認まで実施。専用PATは未設定のため、GASからの起動・実回答の通し試験は未実施。下記は元の検討時点の完了条件。

1. 既存GitHub Actionsを起動するGAS時計を、停止既定で準備。実行中の正常Botを毎周期再起動しない。認証更新のwriterは既存auth-refreshだけに維持し、Bot側5分時計との移行時重複を抑止する。
2. GASからGitHubへの権限はActions起動に限定。既存Cloud用HttpClock.jsは転用不可。GASにPATを保存するなら新しい保存先になるため、既存承認の範囲を確認し、本人による設定が必要。
3. 本人DM用の一回限りの検証をGASから起動し、受付・開始・回答・Slack読戻し時刻を照合。通常Botの二重起動は禁止。実Slack発言の検出は、模擬入力やBot自身の投稿と区別する。
4. QA記録は既存の本人用検証先で新着と古いスレッド更新を確認し、一周時間と日次予算を測る。本番切替時だけPython記録停止→旧処理終了確認→GAS記録ON。
5. 本番の時計・記録切替は具体的な変更を揃えて本人指示後。長期運転・再起動空白・認証失効時通知の観測を残す。

巡回回答方式は直接イベント受信より遅延と実装が増えるため、今回の第一候補にはしない。GASだけの完全移植も未実証であり、追加GCP不要と完全GAS化を同義にしない。

## 根拠

- [GAS Webアプリの受信項目](https://developers.google.com/apps-script/guides/web)
- [Slack署名検証](https://docs.slack.dev/authentication/verifying-requests-from-slack/)
- [Slack Eventsの受付期限](https://docs.slack.dev/apis/events-api/)
- [Socket Modeの認証と受付確認](https://docs.slack.dev/apis/events-api/using-socket-mode/)
- [GAS外向きHTTP](https://developers.google.com/apps-script/reference/url-fetch/url-fetch-app)
- [GAS利用枠](https://developers.google.com/apps-script/guides/services/quotas)
- [Slack履歴取得](https://docs.slack.dev/reference/methods/conversations.history/) / [スレッド取得](https://docs.slack.dev/reference/methods/conversations.replies/)
- [GitHub Actions料金区分](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- ローカル：src/ai_assistant.py、scripts/runtime_ops.py、.github/workflows/bot.yml、.github/workflows/auth-refresh.yml、gas/Main.js、gas/Core.js。
- 前回実測：docs/evidence/slack-http-20260927/review-summary.md。
