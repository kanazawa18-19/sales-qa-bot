# GAS版の導入と切替

GAS版は追加実装。既存Python・GitHub Actionsは変更していない。[移行準備プロジェクト](https://script.google.com/home/projects/1fsUWf8DstrkWgPj9u0UAa0819MOZtHGaUugaHkcCWTMT4CNQCLnXqm7Q/edit)へコード・マニフェストを保存済み（2026-09-26）。`ENABLED=false`、認証値未設定、トリガー登録・関数実行・本番切替は未実施。ローカル検証は `node --test tests/gas.test.cjs`（33件、外部APIはスタブ）で、実サービスの接続・権限・回答品質は未検証。

作成済みプロジェクトの `コード.gs` は `gas/Core.js` + 改行 + `gas/Main.js` を連結したもの。再読込後にエディタから全コピーし、ローカルと完全一致を確認済み。更新時も同じ連結で置き換えるか、既存の結合ファイルを消してから2ファイルへ分ける（二重定義しない）。コードのSHA256は `13b8901d9f12131eae741ba37a3d5ece1873873fca558510c35241dcdbaff0ba`。

```
5分トリガー → 新着巡回（先に15秒） → 過去の親も再巡回
                 ↓                        ↓
           Slackの質問/返信 → Sheets A:J → Notion
                 ↓
           CORRECTIONS → サービス資料 → 過去QA → Claude → Slack
```

5分は起動間隔であり返信保証時間ではない。履歴・返信とも15件ずつ全ページを取得し、既定45秒を目安に終了して進捗を次回へ渡す。新着巡回と過去巡回は独立した保存位置・一時シートを持つ。新着は前回到達時刻から10分重ねて読む。古い親への新しい返信は過去巡回で拾うため、全体1巡の時間だけ遅れる。履歴量・Slackのレート制限で数時間以上かかる可能性もある。検証時に `lastRecentCycle` と `lastCycle` の更新間隔を実測し、業務で許容する遅延を超える場合は本番へ切り替えない。Slackに保存されなくなった履歴は取得できない。

## 2026-09-27 の準備状況

- [検証用Sheets](https://docs.google.com/spreadsheets/d/1q6MRXp8R_pYMjaZcosCVRAh6CfpuATohUXezgh-CKfQ/edit?usp=drivesdk)を既存の「セールスQA」からブック単位でコピー。My Driveの `ChatGPT` フォルダに配置し、権限一覧は本人ownerのみ。元表は変更していない。
- 元表・コピーともタブは `シート1` / `CORRECTIONS` / `STATE`。QAは既定の `QA` ではない。A:JとCORRECTIONSの見出しを読戻し確認し、コピーの3タブを画面確認。全セルの一致検査は未実施。旧版の `STATE` はコピーに残るが、GASの巡回状態とは別物。
- GASに `GOOGLE_SPREADSHEET_ID=1q6MRXp8R_pYMjaZcosCVRAh6CfpuATohUXezgh-CKfQ`、`GOOGLE_SHEET_NAME=シート1`、`NOTEBOOKLM_MIGRATION_ACK=false` を保存。`ENABLED=false`を維持し、トリガー0件を画面確認。
- リポジトリに `.env` は存在しない。キーチェーンの対象サービス登録名にもAPI用の認証情報は見つからなかった。GitHub Secretsには既存botの設定名があるが、値の読み戻しはできない。`SLACK_READ_TOKEN` は登録名一覧にもない。
- 実GAS関数、外部API接続、AI返信、通知到達は未検証。Slack本人用テスト先とNotionテストDBも未準備。旧botはGitHub Actionsで実行中、4 workflowはactiveのまま。
- NotebookLMの移行元IDはGitHub Secretのため未特定。ホームに「ホテルサービスマスター」（64ソース表示）はあるが、旧botの参照先である根拠はない。閲覧は自動承認審査で拒否され、資料本文は取得していない。対象URLの指定・閲覧承認が必要。

2026-09-27追記：本人から[ホテルサービスマスター](https://notebook.google.com/notebook/ff4df3ed-ae9a-4684-a8d1-8b00a8833ba0)のURL提示があり、閲覧を再開。セールスQAと提案資料の存在を確認。資料一覧は [移行対象一覧](evidence/gas-migration-20260927/notebook-sources.md) に保存。旧GitHub Secretとの同一性は未照合だが、今後の移行対象は本人提示URLを使う。

次に必要なのは既存キーの保存場所の確認と、資料本文の移行。秘密値をチャットへ貼らず、GASのスクリプトプロパティへ設定する。Slack bot token・読取user token・Notion token・Anthropic API keyに加え、BOT_USER_IDとテスト先IDを設定してからdry-runへ進む。資料確認前にACKをtrueにしない。

2026-09-27追加：20資料の[検証用ファイル](https://drive.google.com/file/d/1bEd-_B9Y2LmbIKCVggApgjQlVeYSpd0J/view?usp=drivesdk)を作成し、GASのSERVICE_MATERIALS_FILE_IDに保存。実データとの文脈サイズ試算は110,813文字で上限内。停止・移行ACK=falseを維持。詳細は[資料準備記録](evidence/gas-migration-20260927/materials-preparation.md)。

## 移行する機能と差異

|機能|GAS版|
|---|---|
|QA記録|A:J、I列tsまたはD列URLで照合。H列は日本時間YYYY-MM-DD HH:mm。既存行のB/C/E/H/Iは保持、A/D/F/Jと画像がある場合のGのみ更新|
|訂正データ|既存CORRECTIONSのA質問/B正解/D補足を最優先|
|Notion|既存の日本語プロパティにupsert。人手管理項目と既存本文ブロックは保持。回答プロパティは従来同様2,000文字まで|
|AI|Claude単発、思考無効、最大1,024トークン。空回答・途中切れは失敗|
|対象|専用AIチャンネルの親、許可チャンネルの親/返信メンション。一般bot投稿は除外、Workflowは明示許可|
|画像|質問のPNG/JPEG/GIF/WebP最大3枚、1枚4.5MB以下を取得。容量超過・サイズ不明・恒久的取得失敗は未読と表示。関連QA上位3件の画像URLを回答末尾に添付。4枚目以降・非対応画像の未読枚数を明示|
|NotebookLM|Cookieログイン・資料更新・質問APIは移植しない。Claudeへ明示切替。NotebookLM独自資料は別途移す|
|障害|進捗を飛ばさず再試行。不確かなSlack投稿は重複回避のため保留し、人が照合|

## 設定

新しい単独のGASプロジェクトへ `gas/Core.js`、`gas/Main.js` を貼り付け、マニフェスト表示を有効にして `gas/appsscript.json` を反映する。Webアプリ公開は不要。トリガー作成者は業務用の継続利用アカウントとし、Sheetsへの編集権限を与える。

秘密値はGAS「プロジェクトの設定 → スクリプトプロパティ」にだけ設定する。コード・Vault・チャットへ貼らない。GAS編集者はプロパティを読めるので編集権限を絞る。

|プロパティ|値・意味|
|---|---|
|ENABLED|初期は `false`。省略でも停止|
|SLACK_READ_TOKEN|履歴/返信/画像を読むuser token。Bot投稿tokenと分離|
|SLACK_BOT_TOKEN|投稿用bot token|
|BOT_USER_ID|投稿botのUで始まるユーザーID|
|QA_CHANNEL_ID|QA記録対象の1チャンネル|
|AI_CHANNEL_ID|任意、親投稿への自動AI回答対象|
|MENTION_CHANNEL_IDS|メンションを許可するチャンネルIDをカンマ区切り。空ならメンション無効|
|TRUSTED_WORKFLOW_BOT_IDS|信頼するWorkflowのbot_idをカンマ区切り。必要なものだけ|
|GOOGLE_SPREADSHEET_ID|QA / CORRECTIONSのあるスプレッドシート|
|GOOGLE_SHEET_NAME|省略時QA|
|SLACK_WORKSPACE_URL|省略時 `https://cnctor.slack.com`|
|NOTION_TOKEN / NOTION_DATABASE_ID|既存DBへのintegrationとID|
|NOTION_DATA_SOURCE_ID|DBにsourceが1件なら省略可。複数なら必須|
|AI_START_TS|切替開始時刻のUnix秒。必須。この時刻以前の投稿にはAI回答しない|
|AI_BACKEND|明示的に `claude`|
|NOTEBOOKLM_MIGRATION_ACK|資料移行確認後だけ `true`|
|ANTHROPIC_API_KEY|Claude APIキー|
|ANTHROPIC_MODEL|省略時 `claude-sonnet-5`。使用アカウントで利用可能なモデルを確認|
|SERVICE_MATERIALS_TEXT|小さい資料の本文（任意）|
|SERVICE_MATERIALS_FILE_ID|DriveのUTF-8 text/plainファイルID（1MB以下、ダウンロード前検査）。両方設定すると連結|
|SLACK_PAGE_SIZE|既定15。制限が許す環境だけ200も選択可。変更前に停止しSCAN_STATE/RECENT_STATEをリセット（JOURNAL/SYNC_STATEは保持）|
|RUN_BUDGET_SECONDS|既定45秒、15〜210秒。新着は1/3（最大15秒）、残りは過去巡回|
|DAILY_RUNTIME_LIMIT_SECONDS|このbotの24時間累積上限。既定14,400秒（4時間）。個人アカウントなら3,600秒など90分枠未満に下げる|
|HEALTH_EMAIL|稼働・失敗報告を受け取る本人のメールアドレス。稼働時必須|

Slack読取tokenには `channels:history`、必要なら `groups:history`、画像に `files:read` を付ける。読取ユーザーとbotを対象チャンネルに参加させる。botには `chat:write`。返信取得にuser tokenを使うのはこの実装の方針であり、現行Slackの全bot tokenが利用不可という意味ではない。既存Socket Mode用app tokenはGASでは不要。

Notionは `2025-09-03` 固定、databaseのdata_sourcesを取得し、data_sourceに問い合わせる。既存スキーマは `質問の内容`（title）、`タイムスタンプ` / `サービス` / `質問者` / `回答者` / `回答テキスト`（rich_text）、`質問日時`（date）、`URL`（url）。旧SETUPにある英語のサンプル項目とは異なるので実DBで確認する。

## 本番を触らない事前検証

1. QA/CORRECTIONSのコピーとテスト用Notion DB、本人だけのSlackテストチャンネルを用意する。GASにはそのIDを設定する。
2. `ENABLED=false` で `dryRunSalesQa`。読み取りのみでbot/user tokenのworkspace一致・BOT_USER_ID一致と最新15件のIDを確認する。AI送信、Sheets/Notion/Slack書込、プロパティ変更、トリガー登録は行わない。これは全件同期の試算ではない。
3. `prepareSalesQa` でテストSheetsに `GAS_STAGE` / `GAS_STAGE_RECENT` / `GAS_AI_JOURNAL` / `GAS_SYNC_STATE` / `GAS_DELETED` を作る。この操作は書込でありdry-runではない。既存QA/CORRECTIONSは作成しない。
4. NotebookLMにしかない資料を棚卸しし、CORRECTIONSかサービス資料へ移す。PDFをそのままDriveテキストとして設定しない。NotebookLM固有の引用や会話履歴は引き継がない。資料内容・共有範囲とClaude送信可否を確認してACKを設定。
5. テスト環境でcutoffを現在時刻に設定しENABLED=true。親質問、返信メンション、古い親への新返信、Workflow、画像を投稿。`pollSalesQa` を実行する。これは実AI送信・テスト先書込を行う。
6. B/C/E/H/Iの手編集値が維持されること、SheetsとNotionの回答、Slack実返信を目視確認。重複実行でも1回答。過去の投稿に回答しないことを確認。
7. `installSalesQaTrigger` を明示実行し5分トリガーを登録。関数をアップロードしただけでは登録されない。GAS標準のトリガー失敗通知も有効化する。作成者を1人に固定（他人のトリガーは一覧に出ない）。
8. `healthSalesQa` でtriggerCount=1、lastRun、lastRecentCycle、lastCycle、syncVerified、aiAccepted、所要時間を確認。syncVerifiedはSheets/Notion読戻し済み、aiAcceptedはSlack投稿後読戻し済み。1日1回の稼働報告と障害メールの到達も確認。15分以上lastRunが古ければstale。本関数自体は通知しないため、トリガー消失時には翌日の稼働メール未着も監視する。

## 本番切替（明示指示後だけ）

1. 既存Sheets、Notion、GAS設定をバックアップ。秘密値をリポジトリへ保存しない。
2. 旧GitHub Actionsのbot定期/手動起動、自動再起動、およびNotebookLM sync・auth-refreshをすべて無効化。実行中runを停止し、再起動が残っていないことを確認。Railway等に常駐があればそれも停止。旧起動停止完了前にGASを有効化しない。
3. 本番IDへ変更。`AI_START_TS` は旧版停止後の切替境界にする。停止前の未回答を拾う場合は、重複対象を人が照合して境界を決める。自動的に過去を回答し直さない。
4. テスト時の `SCAN_STATE` / `RECENT_STATE` / `RECENT_THROUGH_TS` / `CYCLE_THROUGH_TS` / `NOTION_CREATE_PENDING` と健康時刻を削除。本番用一時シートは空で開始。テスト用のJOURNALを本番へ混ぜない。
5. ENABLED=falseでdry-runとprepare。本番QA/CORRECTIONS、Notionスキーマ、資料移行ACKを確認。
6. ENABLED=true、トリガーを1つ登録。実投稿は合意済みの対象でのみ実施し、到達を確認する。旧NotebookLM資料更新が停止している旨を利用者へ案内。

## 障害時とロールバック

- 削除済みthread（thread_not_found/message_not_found）は `GAS_DELETED` にchannel:tsを記録して先へ進む。tombstone/topic/purpose等のシステム投稿もQA・AI対象外。権限不足は削除扱いにしない。
- AI_EMPTY / AI_INCOMPLETE はJOURNALのFAILEDに保存し、次回から自動生成しない（無限課金防止）。初回に障害通知、healthSalesQaのfailedCountで残件を確認できる。原因を直して再生成する場合はENABLED=falseで該当行BをPREPARED、Cを空にし、SCAN_STATE/RECENT_STATEをリセットして再巡回する。回答本文を管理者が用意する場合はCへ入れてPREPARED。対応不要と判断したものはBをSKIPにし、行を削除しない。再巡回しないと既に通過した質問の再試行は始まらない。
- POSTINGでもDに返信tsがあれば投稿せず読戻しだけ再試行する。Slackの確定拒否（認証・権限・入力不正など明示したエラーのみ）はPREPAREDへ戻す。内部エラー・未知のエラー・timeout（HTTP408含む）・ネットワーク不明/5xx/不正JSONは保留。Notion作成の確定4xx/429は該当pendingを解除する。


- `RATE_LIMITED` はRetry-Afterまで次回へ繰越。長いsleepをしない。進捗は同じ位置。健康情報のlane/channel/thread/requestIdで対象を特定できる（本文は含まない）。権限不足・巨大本文等は修正するまでその回の巡回全体が停止（laneの障害分離は未実装）し、勝手に対象を飛ばさない。
- `SLACK_POST_RECONCILE`：ENABLED=falseにし、JOURNALのkey（channel:質問ts）と投稿先スレッドを照合。既に回答が届いていれば該当行BをSENTにしDへ返信tsを記録。未投稿を確認できた場合だけPREPAREDへ戻す。確認せず行削除・再送しない。JOURNALには回答本文が含まれるため元QA同等のアクセス制御を行う。
- `NOTION_CREATE_RECONCILE`：対象tsをNotionで検索。あれば次回upsertが見つけて復帰。ないことを確認した場合だけ `NOTION_CREATE_PENDING` を削除。検索直後の反映遅延にも注意。
- `invalid_cursor` 相当：ENABLED=falseで該当laneのSTATEを削除すると、そのlaneを最初から再巡回できる。JOURNALは残す。stageは新スレッド開始時に自動消去。
- 復旧できない場合はENABLED=false、GASトリガーを削除して実行終了を待つ。GASの状態/JOURNALを保全後、旧botだけを有効化。NotebookLM側も戻す場合はcookie期限と同期の成否を別途確認。新旧を同時起動しない。旧版のcatchupで重複回答しないか境界を先に照合する。

同期の鮮度は `GAS_SYNC_STATE` にスレッド別の巡回時刻とPENDING/COMPLETE、D列にNotion page IDを保存する。Notion作成・既存ページ発見時はIDを保存してから進み、以後は検索反映を待たずそのIDを更新する。作成保留は対象の読戻し確認完了後だけ解除する。書込前に時刻を予約し、Sheets/Notionの両方を読戻し確認してCOMPLETEにする。新しい同期が途中で失敗しても、古い巡回が回答を巻き戻さない。同じ時刻は再試行できる。稼働中にこのシートを消去しない。

## 実行時間と利用枠

既定45秒×288回なら216分/日。ただし外部呼出し中は中断できないので超過余地がある。実測した実行時間をDAILY_RUNTIMEに24時間窓で累積し、既定4時間に達したらDAILY_RUNTIME_LIMIT/deferredで繰越、窓終了後に再開する。日付が変わっただけではリセットしない。これはこのbot独自の予算であり、同じユーザーの他GASが使う共有枠までは把握できない。Workspaceのトリガー上限6時間/日、個人90分/日に余裕を持たせて設定する。healthのdailyRuntimeMsとlastCycleを合わせて監視する。予算繰越中は新たな成功通知を送らない。

## 既知の制約

外部API投稿とGAS保存は一括で確定できない。通信結果不明を自動再投稿すると重複し得るため、保留して人が照合する設計。Claude生成直後の強制終了は再生成/二重課金の可能性がある。GAS上限、日次UrlFetch・メール送信枠、Slackプラン/アプリの制限を実測する。失敗通知自体のQuota切れにもGAS標準の失敗メールを併用する。QAシートの1セルは約5万文字、stageの1投稿JSONは45,000文字以下、AI資料合計は18万文字以下。超過時は黙って欠落させず停止。編集/削除された既存質問のB/C等は人手保護のため更新しない。古い親への返信の即時検知が必須ならGAS定期巡回だけでは要件を満たさない。

参考: [GAS上限](https://developers.google.com/apps-script/guides/services/quotas)、[Slack replies](https://docs.slack.dev/reference/methods/conversations.replies/)、[Notion新版への移行](https://developers.notion.com/guides/get-started/upgrade-guide-2025-09-03)。
