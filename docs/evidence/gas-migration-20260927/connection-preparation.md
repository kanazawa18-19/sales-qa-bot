# 接続準備と実スキーマ確認（2026-09-27）

## 実施したこと

- Slack管理画面でSales QA Bot（app ID `A0B7DFD7EKC`）を確認。既存投稿キーを秘密値非表示でGASへ保存。Slackユーザー一覧からbot ID `U0B87Q9P99N`を照合。
- 既存の取り込み設定にあるSlack読取キーとNotionキーの認証APIが成功。Slackは本人 `U03JFKXG6C8` / `T1CSJ782K`、history/groups/filesの必要権限あり。Notionはkanazawa-obsidian integration。GASへ保存後に値の一致だけを確認し、秘密値をログ・Git・Vaultへ出していない。
- Slackで本人とbotのDM `D0B87Q9U54G` を開き、conversations.info/historyが成功。履歴0件。QA_CHANNEL_IDへ設定。AI_CHANNEL_IDとメンション許可は未設定で、AIを呼ぶテスト前に設定する。
- BOT_USER_ID / QA_CHANNEL_ID / AI_START_TS / AI_BACKEND=claude / HEALTH_EMAILを保存。ENABLED=false、NOTEBOOKLM_MIGRATION_ACK=falseを維持。AI_START_TSは実テスト直前に更新する。
- Notion元DBのメタデータと8列の型をGETで確認。7列は想定一致、質問日時だけdateではなくcreated_time。

## 修正と検証

- Main.jsは実データソースの質問日時型を取得し、dateのみ質問時刻を書き、created_timeは自動入力に任せる。不明型は作成前に停止。dryRunも型を検査する。
- [Notion公式仕様](https://developers.notion.com/reference/page-property-values#created-time)でもcreated_timeは読取専用。元の質問時刻はタイムスタンプ列に保持する。
- 36件のローカルテスト成功。独立したshirokuma-secレビューでBLOCKER/WARNなし、レビュアーも36件成功を確認。今回の小修正では他社モデルレビューを追加せず、元実装のレビュー記録は前回分を参照。
- 修正したCore+Mainを停止中GASへ保存し、再読込・全コピーでローカルと完全一致。SHA256 `1cd9c120af254ca15f2a1fb3f0e3752f4ddcd613d18666d613f7fde4fb6525fb`。
- 実Notionへの作成・更新、Slack投稿、AI生成は未実施。GAS dryRun実行操作は初回の「承認が必要です」で止まり、権限は付与していない。

## 残っている障害

1. Anthropicキー：別プロジェクトの設定にキー名の存在は確認。ただし別プロジェクトのキーをこのbot用に検証する操作は自動承認審査が明示承認不足で拒否。値の取得・利用確認・GAS保存は未実施。本人承認後に進める。
2. Google初回権限：Sheets読書き、Drive読取、外部通信、トリガー管理、メール送信を要求するマニフェスト。本人の許可が必要。
3. Notion検証DB：新規作成の追加先「プライベート」で空DB作成を操作したが、遷移先 `3e7d8ea8d4f380608c0fe11985437409` は「ページが見つからない」。再読込でも利用可能性を確認できない。ゲスト表示あり。作成の成否・所有/共有範囲は未確認なのでGAS接続先にしていない。追加作成を繰り返していない。本人の利用可能な私用ページ配下に作る必要がある。
4. Slackの非公開チャンネル作成はrestricted_actionで拒否されたため作成せず、本人とbotのDMを使用。DMの親質問試験は可能だが、チャンネル固有機能やWorkflowの試験は別途必要。

## 安全な終了状態

- GAS無効・資料ACK=false。NOTION_DATABASE_IDとANTHROPIC_API_KEYは未設定。トリガーを追加せず、本番IDをGASへ保存していない。
- 旧Python/Actionsや本番DBは変更していない。DMには投稿していない。
- 見送った案：GitHub Secrets持ち出しのため本番workflowを変更、別用途AIキーの無承認転用、Google権限の無承認付与、テスト先の代わりに共有本番DBへ書くこと。
