# GAS検証用資料の準備（2026-09-27）

実APIテスト・本番切替は未実施。アプリコードは変更していない。

## 取得・保全

- NotebookLMのソース表示56件を保存。うち55件の本文を整理し、本文あり39件・本文なし7件・NotionのJavaScript案内のみ9件を確認。表示保存と本文取得成功は同義ではない。
- Google Slides原本6件から文字を取得：メイリーマスター38ページ、メイリー活用事例38ページ、ILCA24ページ、レセプション24ページ、レビュー20ページ、個別ホテルラボ提案24ページ。画像内文字は未検証。
- 原文・抽出本文は `~/.local/share/sales-qa-gas-migration/` に本人のみの権限で保存。資料本文はGitへ入れていない。
- NotebookLMで「【最新版】ホテルラボご提案書」と表示される原本は個別施設宛だったため、汎用回答用には投入していない。

## 検証用ファイル

[Google Driveの検証用資料](https://drive.google.com/file/d/1bEd-_B9Y2LmbIKCVggApgjQlVeYSpd0J/view?usp=drivesdk)

主要サービスの本文15件とSlides原本5件、計20資料を収録。一般営業教材・旧LPの重複候補・個別施設宛提案・本文のない資料は原文保全のみ。全65資料の完全移行ではない。採用したNotebookLM IDはローカルの selected-source-ids.json に記録。

|検証|結果|
|---|---|
|MIME|text/plain|
|UTF-8サイズ|226,951 bytes（上限1,000,000）|
|本文文字数|92,705 Unicode文字 / JavaScript長92,711|
|Drive権限|本人ownerのみ|
|読戻し|全文取得。ローカルとJavaScript文字列長・FNV-1a 32bit値が一致（39ffb9bf）。暗号学的な同一性検査ではない|
|ローカルSHA256|a6951af9e240c76e87767fac39387b440b4c0aa8f52473afe3be5548325943e8|
|認証情報の機械検査|Slack/Anthropic/Notion/GitHubトークン・秘密鍵・パスワード指定のパターン検出0件。完全性保証ではない|
|実データとの文脈サイズ試算|検証SheetsのQA687行の直近100行、訂正0件と資料を現行コードと同じ文字列構成で合成：110,813 / 180,000文字。余裕69,187文字|

NotebookLM取込時点の本文と現時点のSlides原本が混在する。現行価格・仕様を保証せず、日付や条件が食い違う場合は断定しない旨を冒頭に記載。導入事例は成果保証ではない。

## GAS側と残作業

SERVICE_MATERIALS_FILE_ID=1bEd-_B9Y2LmbIKCVggApgjQlVeYSpd0J を保存して画面で読戻し確認。ENABLED=false / NOTEBOOKLM_MIGRATION_ACK=false を維持。キーは設定していない。

次は、テスト用認証情報を設定して実接続と回答品質を検証し、未収録資料の必要性を確認する。既存キーの別の控えは未発見。GitHub Secretsの値は読み戻せない。GAS初回OAuth権限付与も未実施。バックグラウンドで移行作業を継続する仕組みは起動していない。
