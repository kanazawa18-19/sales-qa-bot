# Botを中断しない停止確認と復旧

本番未反映。追加GCP・GAS設定・認証更新担当の変更は不要。

```text
Bot → 24分で子プロセス終了 → 自己再起動要求 → 次Bot
                                      ↑
GitHub毎時17・47分 → 未完了runあり ──→ 何もしない
                  → 未完了runなし ──→ 復旧要求
同時に要求された場合 → Botの共通実行枠で順番待ち
```

## 変更と限界

- 旧bot.ymlの`*/35`は毎時0分・35分。実行中を取り消す設定と組み合わさり、正常Botが中断され得た。
- bot.ymlから直接scheduleを除去。共通group `sales-qa-bot`を維持し、`cancel-in-progress: false`へ変更。push・手動・自己再起動・復旧要求の全てが同じ枠で直列になる。本人DM試験の別枠は維持する。専用反映ブランチは本番mainを基準とし、HTTP版・GAS時計・非main制限の追加は含めない。
- bot-watchdog.ymlを毎時17・47分に実行。Botとは異なるgroupを使うため、停止確認自身はBotの実行枠を占めない。
- bot.yml/mainの`in_progress / queued / pending / waiting / requested`をAPIで確認し、一つでもあれば要求しない。各状態を絞り込んで件数を見るため、直近履歴100件の外にある長い待機も対象になる。main上の本人試験も保守的に未完了と扱い、その間は復旧が遅れる。
- 読取失敗・不正応答はworkflow失敗にして起動しない。起動POSTの結果不明も同じ実行内で再送しない。次の時計で再確認する。通知はGitHub Actionsの失敗通知設定に依存し、新しいSlack通知は追加しない。通知の受信設定・実配送は未検証。
- 状態確認とPOSTは不可分ではない。確認直後の自己再起動・pushとの競合では余分な要求が発生し得るが、Bot側の共通groupが実行中1件に制限する。既定では待機は1件で、同じgroupに新しい待機要求が入ると既存の待機は置換される。稼働中は取り消さず、要求数に比例して自己再起動の系列が増殖することもない。待機の実行順は保証しない。
- 24分の寿命、27分の実行ステップ上限、35分のjob上限を維持。停止・取消し・job上限で自己再起動まで進めなくても次の停止確認が復旧候補となる。queued/waitingが止まり続ける場合は自動取消しせず、人が[Bot実行一覧](https://github.com/kanazawa18-19/sales-qa-bot/actions/workflows/bot.yml)を確認する。待機継続はwatchdogが成功扱いのため自動通知されない。
- GitHub scheduleの遅延・欠落があるため「30分以内に必ず復旧」とは言えない。runの存在はNotebookLMの回答成功の保証ではない。GASの時計は従来どおり通常Botを起動・取消ししない。
- 公開リポジトリでは60日間活動がないとscheduleが自動無効化される。運用時はwatchdogの有効状態と最終実行日時も確認する。GASからこのwatchdogを起動する案は将来候補で、今回GASは変更しない。
- 既存の残課題：依存インストールなどBot起動前の失敗でも自己再起動するため、短い間隔の失敗連鎖が続き得る。子プロセスの早期終了には既存の5分待ちがあるが、準備段階にはない。今回その復旧方針は変更せず、別の改善課題として残す。

## 本番反映は本人の明示指示後

1. この変更だけを本番の内容に重ねる。slack-http全体を無条件にmainへ統合しない。対象はbot.ymlのschedule削除と取消設定変更、新watchdog workflowとスクリプト。GAS時計・QA記録切替は別作業。
2. 反映直前に旧schedule由来のqueued/pending runが残っていないか確認する。旧定義を保持するrunや手動再実行は旧取消設定を使う可能性があるため、残る場合は切替を進めず評価する。
3. 旧runの実行枠と同じgroupを維持する。反映pushは新設定で待機し、旧runの自然終了を待つ。旧runの取消し・再実行は行わない。
4. GitHubの読み取りで旧run→新SHAのrunへの自然交代、通常Botの同時実行1件、watchdogのスキップ、自己再起動後の後続runを確認する。停止復旧のために本番Botを止めない。

反映直後にも旧SHA・schedule由来の遅延runがないか確認する。事前確認だけで旧定義のrunが今後現れないと保証はできない。自然交代では後処理・依存インストールの待ちがあり、無応答時間も実測する。

## 意図的に停止するとき（本人の明示指示後のみ）

停止確認workflowとBot workflowの両方を無効化し、新しい起動要求を止める。既に実行・待機している停止確認run、Bot runを確認し、待機run→実行中runの順に取消し、未完了runがなくなったことを読み戻す。無効化だけで既存runが止まるとは扱わない。再開時は両workflowを有効化し、停止確認を1回起動して状態を読む。今回この停止・再開操作は実施しない。

## 検証の範囲

ローカルではAPIを置換した判断テストとworkflow設定を検証する。本番Botを起動・取消しする試験や、追加DM送信は行わない。GitHub上で新設定による復旧・競合を実行した証明とは区別する。

## 公式仕様

- [同時実行制御と待機runの置換](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)
- [状態を絞り込んだworkflow実行一覧](https://docs.github.com/en/rest/actions/workflow-runs#list-workflow-runs-for-a-workflow)
- [scheduleの遅延と既定ブランチ](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

## main向けの反映準備（2026-09-27）

- ローカル専用ブランチ `bot-watchdog-main`、基準 `4beaea5`。作業場所は `~/sales-qa-bot-watchdog`。
- `ae406ac`からwatchdog・既存レビュー記録を移し、bot.ymlはmainの既存実行枠を保持したままschedule削除と取消し無効化だけを適用。HTTP版・GAS時計・QA記録の変更は含めない。
- mainの実行枠に合わせて設定回帰テストの期待値のみ変更。APIを置換したNodeテスト12件成功。新設定のGitHub実機交代・復旧は未検証。既存外部レビューはae406ac対象で、この専用ブランチの再レビューではない。
- 明示指示後、最新mainとの差分を再確認してこのブランチだけを反映する。旧runを取り消さず自然終了を待ち、新SHA・自己再起動・watchdogスキップを読む。
