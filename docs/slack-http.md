# Slackの発言をHTTPで受ける構成

## 配置と切替の範囲

```
Slack → 公開受信口（署名検証） → Cloud Tasks → 非公開ワーカー
                                                ├ NotebookLM → Slack
GAS既存QA巡回 → Sheets / NotionへQA保存
GAS時計（5分） → Cloud Tasks → 非公開ワーカー → NotebookLM認証更新
```

受信口はタスクの保存完了後に200を返す。NotebookLM回答を待たない。受信口にはSlack署名鍵だけを渡し、Botトークン/NotebookLM認証は非公開ワーカーだけに渡す。Cloud TasksはGoogle署名付きIDトークンで呼び、Cloud Run IAMとアプリ両方で検証する。

- `src/http_app/domain.py` は外部I/Oなし。親発言、スレッド内メンション、Workflow投稿を判定する。QA保存は既存GASを利用し、HTTP側にはQA保存処理を持たせない。
- `receiver.py` はSlack署名・5分の時刻差・1MB制限を検証し、保存に失敗したら503を返す。
- 通常発言とメンションの二重通知を、team/channel/投稿時刻/処理種別のキーでまとめる。
- `worker.py` はFirestoreで処理権を確保。回答生成前の失敗は再試行できる。Slack送信直前にpostingを記録し、それ以後の通信切断はuncertainに隔離する。送れたか不明な状態を勝手に再投稿しない。
- Firestoreは30日後のTTL対象。本文は台帳に保存せず、処理ID・状態・チャンネル・スレッド時刻・返信時刻のみ。Cloud Tasksには処理に必要な質問本文を渡す。
- NotebookLMは0.8.3固定。毎回Secret Managerの最新認証を読む。更新はGAS時計→Cloud Tasks→同じ非公開ワーカーで、更新後に実接続と保存の読み戻しを行う。専用認証Secretの旧versionは最新2個を残して破棄し、version数と費用の増加を抑える。
- NotebookLMがログインを失効させた場合は再ログインが必要。HTTP化してもこの条件はなくならない。
- Cloud Runは初期min0で固定費を抑える。コールドスタートを含む受付3秒以内はクラウド検証が必要。遅延によるSlack再送には重複キーで対応する。

## 初期配置は本人DM限定

`OWNER_ONLY=true`が既定。受信は本人のuser IDかつ本人DMだけ。ワーカー側もDM以外を拒否する。QA保存はOFF。本番チャンネルやNotion/Sheetsへの書込みを伴う試験は行わない。

`owner_http_smoke` は署名付きの**模擬**SlackイベントをローカルHTTPサーバーへ送り、NotebookLMの実回答を本人DMへ返信する。2回の受信と2回のワーカー実行で返信は1件。これはCloud Run/Cloud Tasks/Firestoreや実際のSlack Events送信の確認とは区別する。

## 既存環境の確認（2026-09-27）

- 専用GCPプロジェクト`salesqaconnect`は存在するがbillingEnabled=false、Cloud Run/Cloud Tasks/Secret Managerは未有効。
- 課金有効な`fabled-electron-406310`はCRM本番用。無断で相乗りせず、営業QA専用プロジェクトを配置候補にする。
- 本番は現在GitHub Actions版（4beaea5）。このブランチのpushで受信方式は変わらない。

## クラウドに配置する前の準備

1. salesqaconnectへ課金先を紐付ける。使用量課金が発生する。既存の課金設定を勝手に変更しない。
2. 専用Secretを作る：`sales-qa-signing-secret`、`sales-qa-slack-token`、`sales-qa-notebooklm`。値はローカルの安全なファイルからgcloudへ渡し、出力やGitへ残さない。Google Cloudへの認証情報保存は具体的な宛先を示して承認を得る。
3. Artifact Registryに専用リポジトリを作り、`deploy/cloudbuild-http.yaml`でDockerfile.httpをビルドする。`.dockerignore`はコードとrequirementsだけを送る許可リスト。
4. `python deploy/cloudrun-plan.py --image <イメージURL> --worker-url <固定のCloud RunサービスURL>`で構築コマンドを出力して確認する。このスクリプトは表示専用。既存リソースがあればcreateではなく確認してupdateする。
5. Worker URLはCloud Runの決定的URLか初回配置で得られるURLを使う。受信URL/worker URL/IDトークンaudienceを一致させる。非公開ワーカーにallUsers権限を付けない。
6. 署名付き架空イベントで受付時間、Tasks配送、Firestore排他、HTTPタイムアウト時の隔離を確認。本人DMで実回答を照合する。
7. 既存GASへHttpClock.jsを追加し、manifestにcloud-platform OAuthスコープを追加して本人が承認する。GAS実行者に専用queueへのenqueuer権限、callerサービスアカウントへのactAs、Firestoreの監視読取権限を限定付与。HTTP_CLOCK_ENABLED=trueで時計を登録し、手動tick後にFirestoreのlast_successと通知到達を照合する。PATをGASへ移す必要はない。

## 本番の受信先を変えるとき

- 現行message/app_mention購読を保持。Signing Secretを使用し、旧Verification Tokenへ戻さない。
- 旧GitHub Botを停止し、実行中/待機中がゼロであることを確認後、Socket ModeをOFF、Events Request URLを`<受信URL>/slack/events`へ変更し検証する。旧Botを並行起動しない。
- QA記録はGASへ移す。既存GASに本番チャンネル・本番Sheets/Notionを設定し、旧Python記録停止確認後にGASの記録トリガーを有効化。HTTPワーカーにはQA保存処理を持たせない。テスト用DBを本番に流用しない。
- OWNER_ONLY=falseは本人DM検証後。AI_CHANNEL_IDを既存本番と照合する。QA_CHANNEL_IDはGAS側に設定する。
- 初回の未受信分は旧STATE時刻とSlack履歴を照合し、HTTPキューへ重複しないよう回収する。受信変更だけで過去分が届くとは扱わない。
- HTTPへ切替完了後にGitHubのBot再起動・認証更新を停止。NotebookLM資料同期は、新しい認証保存先を読む方式へ合わせてから再開する。GAS記録とGAS時計を継続する。
- ロールバックはHTTP受信の受付を止め、Tasks待機/実行を処理または隔離してからSlackをSocket Modeへ戻す。旧BotとHTTPワーカーの同時返信を防ぐ。

## 根拠

- https://docs.slack.dev/apis/events-api/ （受付応答と再送）
- https://docs.slack.dev/authentication/verifying-requests-from-slack/ （署名検証）
- https://docs.cloud.google.com/run/docs/triggering/using-tasks （非同期実行）
- https://docs.cloud.google.com/run/docs/authenticating/service-to-service （IDトークン）

## GASを中心に置く判断

2026-09-27の共通ルールに従い、業務記録と時計はGASへ置く。外側に残す具体的理由は、(1) GASのdoPostイベントにSlack署名検証用ヘッダーがない、(2) 回答生成を待たず3秒以内に受付を返すため永続キューが要る、(3) 利用中のNotebookLM接続がPythonライブラリと認証更新に依存する、の3点。Cloud Schedulerの追加案は撤回した。Cloud Run全体へ業務記録を移す案は採用しない。

## 送信結果が不明な処理の確認

管理者DMの対象スレッドリンクと処理IDで照合する。回答がすでにある場合は、その返信時刻を台帳のreply_tsへ記録しstateをdoneへする。未送信を確認できた場合だけ、台帳をretryへ戻して対象質問を再登録する。確認できない場合はuncertainのまま残す。処理IDから元の質問本文は復元できないため、Slackスレッドを正本として使う。

初期DM試験では質問元への「生成中」等の追加投稿を省く。障害は管理者DMで対象リンクとともに通知する。共同利用への公開前に、質問者への受付・最終失敗案内を実装・確認する。本人DM試験の成功だけで共同利用可能とは判定しない。
