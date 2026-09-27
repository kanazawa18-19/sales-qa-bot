# 定期起動によるBot中断の修正レビュー

2026-09-27 主機CX。基準はslack-http `5303240`、fetch後originと一致・変更なし。本番mainは`4beaea5`。本番への書込・通常Botの起動/取消し・DM試験は行っていない。

## 検証

| 項目 | 実測結果 |
|---|---|
| Node全体 | 69件成功（watchdog 12件含む） |
| Python既存回帰 | 独立QAが34件成功。既存`/private/tmp/sales-qa-clock-venv`を使用 |
| workflow | Ruby YAML読取2ファイル成功、取消・group・main制限等の静的確認成功 |
| 独立QA追加確認 | 追加した設定回帰・競合の2件成功 |
| 差分空白検査 | `git diff --check`成功 |
| GitHubの実状態読取 | default_branch=main / private=false。5種類のstatus絞込APIが応答 |

`in_progress`応答はtotal_count=2、per_page=100の配列内は1件（36292128029、SHA=4beaea5）。件数と配列が不一致なので、通常Botが実際に2件稼働している証拠とは扱わない。queued/pending/waiting/requestedは各0件。判定は未完了ありとして復旧要求を控える設計。稼働runの取消しや復旧POSTは実行していない。

テストはAPIを置換したもの。最後の読取後に自己再起動が見える競合では余分な復旧POSTが1件発生することを確認。実行の直列化はGitHubのconcurrency仕様・設定に依存し、新workflowによる実機交代・復旧・競合は未検証。actionlintは未導入で未実行。システムPythonはFlask不足で読込失敗したが、既存の試験環境では全34件が成功した。

## 内部3体

- shirokuma-sec：BLOCKER/WARNなし。共通group、API失敗時の起動抑止、子プロセス終了後の自己再起動を確認。
- obasan-quality：BLOCKERなし。待機継続が自動通知されない点、反映前チェックの手順順序、競合の説明文を修正。
- kuma-qa：BLOCKERなし。workflow設定回帰テストの不足を指摘し、追加後に2件を独立再確認。実機未検証は維持。

## 他社2モデル

初回資料は15,679 bytes、SHA256 `fedfc6546518e3415606ec5af5e0071ee176075d721c3e45bf8274e487169d38`。`review-input.txt`が正本。鍵形式・秘密鍵・メールアドレスの機械検査0件、本文も確認。Secretは参照名のみで値を含まない。資料送信後の変更は追加2テストと説明資料のみで、実行ロジックは変更なし。

標準のtxt添付はChromeのファイルURL権限により失敗。自動承認審査の拒否ではない。権限変更をせず、専用チャットへ確認済み資料を貼付。Claudeは貼付資料カードに変換され、プレビューの空白除外全文一致を確認。Geminiも入力欄の空白除外全文一致を確認して送信。両者とも回答完了を確認した。

### Gemini Thinking

[会話](https://gemini.google.com/app/4d66ccc812fe5736?hl=ja)、原文`gemini.txt`。

| 指摘 | 採否と根拠 |
|---|---|
| BLOCKER：相対requireはaction内部起点になりMODULE_NOT_FOUND | 不採用。v7公式READMEと`src/wrap-require.ts`で、相対パスを作業ディレクトリ基準に変換する実装を確認。[公式実装](https://github.com/actions/github-script/blob/v7/src/wrap-require.ts) |
| BLOCKER：状態別の5回読取は競合するので直近20件の1回読取へ変更 | 不採用。非不可分性は1回読取でも残り、直近20件では古い未完了runを見落とす。余分な要求はBot共通groupで直列化する設計。Gemini自身も後段で二重稼働にはならないと記載 |
| WARN：交代時の余分なdispatch | 既知の限界として採用済み。実行中runはRestartステップ中も未完了であるため、「子終了直後なら必ず未完了なし」は正確でない |
| WARN：Authorization表記変更 | 互換性がある既存処理。今回の問題とは別なので変更せず |

### Claude Opus 5.5・中

[会話](https://claude.ai/chat/c41323bf-d73b-44cd-97e4-78039be10458)、原文`claude.txt`。BLOCKERなし。

- WARN：起動準備失敗で再起動が続く。既存問題として認定。早期Bot終了には5分待機があるが、依存インストールなど起動前にはない。「成功時だけ自己再起動」にすると一時的なBot障害も次の30分時計待ちとなるため、この中断防止修正では変更せず別TODOへ。
- WARN：意図的な停止手順がない。停止確認・Botの両workflow無効化と既存run確認の手順を追加。今回操作はしない。
- WARN：公開リポジトリの60日無活動でschedule無効化。公式仕様と照合し、有効状態・最終実行の確認を追記。GAS経由watchdog起動は将来候補として切り離す。
- INFO：待機置換の表現・自然交代の待ち・遅延旧run確認を説明資料へ反映。設定回帰テストは送信と並行して追加し、QA済み。
- INFO：GASのsmokeフラグはActionsClock.jsで`ref: slack-http / owner_dm_smoke: true`を確認。既定ブランチmainもAPIで確認。pendingの実runや新設定の交代は未検証。

確定BLOCKERなし。既存の失敗再起動連鎖、待機継続の自動通知なし、schedule遅延/無効化、新設定の実機未検証を残す。
