# GCPを追加しないGAS時計

既定は停止。`gas/ActionsClock.js`を既存の準備用GASへ追加する。`HttpClock.js`は使用しない。

```text
GAS 5分時計 → auth-refresh.yml → NotebookLM認証更新（既存の1担当）
既存Bot     → 自己再起動       → Socket Modeで質問受付・NotebookLM回答
GAS単発試験 → bot.ymlの本人DM試験 → NotebookLM実回答 → 本人DM
```

時計は常駐Botを起動・取消ししない。Botの停止を検出した場合は通知し、既存の自己再起動とGitHub定期起動による復旧を維持する。API実行中は実回答成功の証明にはならない。

## 認証情報と保存先

本人がfine-grained PATを作り、対象を`kanazawa18-19/sales-qa-bot`だけに限定。Repository permissionsはActions: Read and write、Metadata: Readのみ。有効期限を設ける。Secrets書込権限は付けず、既存`GH_PAT`を流用しない。

保存先は準備用GASのScript Propertiesの`ACTIONS_CLOCK_TOKEN`。貼り付けは本人が行う。チャット、コード、Vaultには書かない。Script Propertiesは編集者から利用可能なので、GASの編集者を本人だけに限定する。PATはworkflowごとに権限を絞れないため、このリポジトリのActions全体（取消・再実行・ログ削除を含む）を操作できる。同じGASプロジェクト内の他のコードからも利用できる。通常Botはmain以外では起動しないよう制限している。

## 本人DM単発試験

1. 試験ブランチ`slack-http`に今回のbot.ymlとスクリプトをpushする。本番mainには反映しない。
2. 準備用GASへActionsClock.jsを追加。`healthActionsClock`で停止・トリガー0を確認。
3. 専用PATを本人が設定した後、`runActionsClockOwnerSmoke`を1回実行する。定期起動は不要。質問とDM宛先は既存スクリプトで固定。
4. GASログのrequestId/要求時刻、Actionsのrun名・ID・開始時刻、`DM_SENT`の回答取得/投稿時刻・Slack受理本文SHA256を記録。送信前本文のハッシュは`submitted_sha256`へ別記し、Slackの絵文字・URL変換を区別する。Slack別読取で照合ID・本文ハッシュ・件数1を照合する。回答本文は公開Gitへ保存しない。
5. 成功/失敗/結果不明にかかわらず`ACTIONS_CLOCK_SMOKE_REQUEST`は保持し、再実行を拒否する。401などの確定未受付後に再試験する場合も、状態を確認した担当者がこのプロパティだけを消す。タイムアウト時はActionsとDMを照合するまで消さない。

単発試験は固定質問から始まり、実Slackユーザー発言の受信検証ではない。通常Bot・Sheets・Notionを起動しない。

## 本番切替（明示指示後のみ）

- コードをmainへ反映後、GitHub変数`AUTH_CLOCK_OWNER=gas`を設定。旧Botは起動時の設定を保持するので、旧run終了と新runへの交代を確認する。Bot側の5分起動を止めても、認証更新の古さ確認・通知は残る。
- auth-refreshの既存30分間隔scheduleを保険として残す。更新担当とconcurrencyは既存auth-refreshだけ。GASは未完了runがある場合スキップする。旧Botからの起動と同時にならないよう交代確認後に次へ進む。
- GASの`HEALTH_EMAIL`を本人宛に設定。`ACTIONS_CLOCK_MIGRATION_ACK=true`、`ACTIONS_CLOCK_ENABLED=true`を設定後に`installActionsClock`。5分トリガー1件を確認する。
- 最終認証成功時刻（30分以内）、Bot実行状態、GASトリガー登録、GAS実行時間、毎日の成功通知を確認する。GitHub受付と実処理成功は分けて見る。
- 戻す場合は`stopActionsClock`→GitHub変数を`bot`→旧run交代を確認。QA記録の切替は別作業。

時計停止が実行中と重なった場合は`CLOCK_BUSY_RETRY_STOP`となる。実行終了後に再度停止し、停止状態を読戻す。

POST要求は送信前に永続化し、同じ照合IDのrunが見えるまで再送しない。10分過ぎても見えなければ要確認通知。解消はActionsを照合してから該当要求プロパティを手動解除。401/403/404/422/429は`rejected`として結果不明と区別する。どちらも手動照合前には再送しない。通知は日次再通知と1時間の間隔制限を持つ。APIの失敗本文・認証値はログへ出さない。

## 本番切替前に残る運用課題

既存bot.ymlの`*/35`は毎時0分・35分で、`cancel-in-progress: true`により稼働中Botを中断し得る。今回GASは通常Botを起動しないため新たな中断を増やさないが、保険起動を「停止時だけ」にする改善は本番切替前に行う。結果不明の認証起動を手動照合する間は既存30分scheduleが保険となる。自動回復より重複起動防止を優先した設計で、無人復旧を保証しない。

## 根拠

- [GitHub workflow起動APIとActions権限](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event)
- [GitHub同時実行制御](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)
- `~/agent-config/reference/stack.md`（PATのScript Properties保存・本人入力）
