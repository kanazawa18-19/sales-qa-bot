# セットアップ手順

## 1. Slack App の作成

1. https://api.slack.com/apps → 「Create New App」→「From scratch」
2. 「Socket Mode」を有効化 → App-Level Token を生成（`xapp-` で始まる）→ `SLACK_APP_TOKEN`
3. 「OAuth & Permissions」→ Bot Token Scopes に以下を追加:
   - `channels:history`
   - `channels:read`
   - `chat:write`
   - `app_mentions:read`
   - `groups:history`（プライベートチャンネルを使う場合）
4. 「Event Subscriptions」→ 有効化 → Subscribe to bot events:
   - `message.channels`
   - `app_mention`
5. 「Install to Workspace」→ Bot Token (`xoxb-`) → `SLACK_BOT_TOKEN`
6. Botをチャンネルに招待: `/invite @ボット名`
7. Q&AチャンネルのIDをコピー（チャンネル名右クリック→「チャンネル詳細」→一番下）→ `QA_CHANNEL_ID`

## 2. Google Sheets の設定

1. https://console.cloud.google.com → プロジェクト作成
2. 「APIとサービス」→「Google Sheets API」を有効化
3. 「サービスアカウント」作成 → 「キー」タブ → JSONをダウンロード
4. JSONファイルの中身を全部コピー → `GOOGLE_SERVICE_ACCOUNT_JSON` にそのまま貼る
5. Google Spreadsheet を作成 → URLの `/d/` と `/edit` の間のIDが `GOOGLE_SPREADSHEET_ID`
6. Spreadsheetの共有 → サービスアカウントのメールアドレスを「編集者」で追加

## 3. Notion の設定

1. https://www.notion.so/my-integrations → 「新しいインテグレーション」
2. Token をコピー → `NOTION_TOKEN`
3. Notion でデータベースを作成。必要なプロパティ:
   - `Thread TS`（テキスト）
   - `Questioner`（テキスト）
   - `Date`（日付）
   - `Answer Count`（数値）
4. データベースページを開いてURLの中のUUID（`notion.so/xxxx-xxxx-xxxx`の部分）→ `NOTION_DATABASE_ID`
5. データベース右上「…」→「コネクトを追加」→ 作ったインテグレーションを接続

## 4. Anthropic API Key の取得

1. https://console.anthropic.com → アカウント作成
2. 「API Keys」→「Create Key」→ `ANTHROPIC_API_KEY`

## 5. デプロイ（Railway）

1. https://railway.app → GitHubリポジトリを接続
2. 「Variables」タブで `.env.example` の全変数を設定
3. 自動でデプロイされる（`Procfile` の `worker` として実行）

## 6. 動作確認

- Q&AチャンネルでSlack Workflowから質問を投稿
- スレッドに誰かが返信 → Sheets と Notion に自動保存される
- 別のチャンネルで `@ボット名 解約の手順は？` → AI回答が返ってくる

## サービス資料の追加（オプション）

`SERVICE_MATERIALS_TEXT` 環境変数に、営業資料のテキストをそのまま貼り付けると、
AI回答時に参照されます（改行は `\n` で）。
