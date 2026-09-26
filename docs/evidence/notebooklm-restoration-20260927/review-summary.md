# NotebookLM復元レビュー（2026-09-27）

- 内部3体：shirokuma-sec / obasan-quality / kuma-qa。旧全workflow停止手順、回答・資料更新先の不一致、Python記録停止テスト不足を指摘。修正後、quality/QAはBLOCKER解消を確認。同期先変更前の旧巡回状態リセットも手順へ追加。
- ローカル：GAS38件、Python8件成功。通常configからQAだけを巡回し、同期が進みAI呼出し0であることも検証。Pythonの認証不足・エラー・空回答・キー残存でClaude代替なしを確認。
- [Gemini Thinking](https://gemini.google.com/app/61986b6dd7fedf77?hl=ja)：txt添付を確認して依頼、回答は対応辞退。レビュー完了とは扱わず再送なし。原文gemini.txt。
- [Claude Opus 5.5 中](https://claude.ai/chat/cb79e691-46f3-4dfc-9941-fcb827256069)：確定BLOCKERなし。原文claude.txt。
- 添付13314 bytes、SHA256 `0dbee41faf870fc0ebeb6fd104bd6ef208b6c8f4ed68eedeaaff1a94a7d23488`。差分と構成説明のみ。認証情報形式チェック・内容確認後に送信。添付時だけ明示許可済みbrowser-use、通常操作は公式Chrome連携。

## Claude指摘の採否

- answer_例外で巡回停止する懸念：通常configでは候補を作らない。旧台帳だけを再処理する独立ループもない。QA同期を継続しAI呼出し0のテストを追加。直接呼出しは再送防止のため例外を維持。
- QA_CAPTURE_ENABLED=falseで新しいAI経路へ流れる懸念：元のQA分岐にreturnはなく、AI分岐は元から独立。挙動を変更するreturnは追加しない。記録停止時AI継続をテスト済み。
- 旧failedCountの誤認：legacyAiFailedCountへ変更。現在の役割qa_recording_only・回答元notebooklm_pythonを表示し、過去aiAcceptedは現行稼働報告から除去。
- 例外の詳細ログ：秘密値を含む例外本文は出さず固定コードを返す方針を維持。上流認証の調査を別途行う。利用者には既存ハンドラーの失敗メッセージが返る。コード上各回答経路にcatchあり。
- _claude参照：既存の未使用Claude補助関数だけに残る。通常answerはNotebookLMだけ。補助処理削除の大きな整理は今回行わない。
- config必須値：停止中GASへAI_BACKEND=notebooklm_externalを保存し読戻し確認。AnthropicキーをGASから削除。設定後dryRun成功。
- Notebook ID：bot.yml/sync.ymlは同じ本人指定ID。auth-refresh.ymlはNotebook IDを参照せず認証情報の更新のみ。
- QA_CAPTURE_ENABLED：手順はfalseを明記。0/noで止まるとは扱わない。

## 実物で確認した範囲

- 停止中GASへCore+Mainを保存し全コピー一致確認。
- 新設定dryRunSalesQa：03:35:43開始、03:35:46完了。本人DMのテスト親投稿1件を読み、Sheets/Notionの参照が成功。AI/実投稿/本番書込なし。
- NotebookLMの実認証・実回答は未検証。旧ClaudeのDM試験を復元後の実回答証拠にしない。
- mainへpushすると本番botが更新されるため専用restore-notebooklmブランチに保存。本番反映・workflow停止は行っていない。
