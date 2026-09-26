# GAS実接続試験（2026-09-27）

## 結果

|確認|結果|
|---|---|
|本人承認|Anthropic既存キーの利用、Google初回権限付与を承認済み|
|Anthropic|モデル一覧200、claude-sonnet-5を確認。単独の接続質問200・「接続OK」|
|Google承認|Sheets・Drive読取・外部要求・トリガー・メールの5権限を承認|
|dryRunSalesQa|02:04:47–02:04:51 JSTに成功。Slack本人DM履歴0、認証同一性・Sheets・Notionスキーマ確認|
|prepareSalesQa|02:05:29–02:05:33 JSTに成功。補助5タブの存在を別途確認|
|GAS内AI生成|02:12:52–02:13:12 JSTの架空試験で「テストプラン青の月額料金は1,234円です」と実回答|
|Sheets/Notion|架空1件を作成・再同期。両方1件で重複なし。Sheetsの人手補足を保持。Notionはcreated_time型のまま成功|
|メール到達|本人宛「sales-qa-bot GAS接続テスト（架空データ）」が02:13:12にINBOXへ到着。通常の定期稼働通知そのものの試験ではない|
|Slack投稿|本人とbotのDMへの質問はrestricted_action_read_only_channelで拒否。送信成功0件|
|ローカル|既存36テスト成功。検証補助の構文確認成功|

## 検証先と方法

- Sheets: `1q6MRXp8R_pYMjaZcosCVRAh6CfpuATohUXezgh-CKfQ` の `GAS_TEST_QA`（sheetId 9272601）。見出し10列を元表から読み、新規タブへ設定。架空行のA:Jをコネクターで読み戻した。
- Notion: `e2889f13-33c2-40b1-8a17-8cad8cf25cb6` / data source `5b37bb5e-c9b9-4968-aede-1b42af7d57d4`。Kanazawa配下の新しい検証DB。親の54名共有を継承する。本人専用ではなく、架空データだけを保存した。画面で質問・回答・日時を確認。
- 先の私用DB作成試行はアクセスできず。今回は既存Integrationが利用できる親ページの下に別DBを作成。本番DBには書き込んでいない。
- `tests/gas-live-smoke.js` を通常コード末尾に一時追加し、全文一致確認後に実行。通常の `aiText_` / `sync_` を実サービスへ接続。固定の検証先、停止状態、トリガー0、架空資料だけであることを入口で検査する。
- Slackメッセージ入力だけは架空のオブジェクトで代用。保存する回答は「架空の人間回答」と明記。URLの `GAS_SYNTHETIC_TEST` は実在チャンネルではなく、実Slack投稿の証拠として使わない。
- 資料は一時的に架空文へ変更。QAは新規の架空タブ、CORRECTIONSは空で、顧客情報をAI/検証Notionへ送っていない。
- Gmail到達ID: `1a0deb4e72fc2205`。メール内にもSlack返信・本番切替未実施を明記。

## 終了状態と残作業

- 一時検証コードをGASから除去。再読込後の全コピーがCore+Mainと完全一致。
- ENABLED=false / NOTEBOOKLM_MIGRATION_ACK=false。資料ファイル参照を復元し、GOOGLE_SHEET_NAMEはGAS_TEST_QAを維持。定期トリガーは追加していない。
- 旧bot/Actions・本番DBは変更なし。
- 残り: Slack質問→巡回→返信、画像/Workflow、実資料の回答品質、実データ量の巡回遅延・日次予算、前回露出キーの交換、本番切替。
- 見送った案: 読み取り専用拒否を受けて他APIで送信を繰り返す、本番チャンネルで試す、既存Slackアプリの設定を無断変更する、架空データ試験だけで本番稼働済みと扱う。

## Slack拒否の原因と追加事故

- App Homeで `Display Messages tab` はON、`Allow users to send Slash commands and messages from the messages tab` はOFFと画面確認。後者をONにすればDMからの質問入力を許可する設定になる。既存アプリ全利用者に適用されるため、今回は変更していない。公開チャンネルの購読設定・投稿先には触れない。
- 02:16:55 JSTのhealthSalesQaで enabled=false / triggerCount=0 / lastRun=null / aiAccepted=null。同期時刻だけ更新済みで、自動巡回・返信を確認した状態ではない。
- Basic Information画面の旧式Verification Tokenがツール出力へ含まれた。本人へ即報告。従来のSlack2キー・Notion1キーに加えて交換対象へ追加。キー接頭辞だけを伏せる処理ではこの旧式値を捕捉できなかった。以後この画面の全体出力をせず、非秘密の設定ラベルだけ抽出した。秘密値は文書に記載しない。
