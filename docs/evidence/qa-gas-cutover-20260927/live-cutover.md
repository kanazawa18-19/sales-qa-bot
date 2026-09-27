# QA記録のGAS切替実機記録

2026-09-27 主機CX。本人の「それも一気にいけ」でQA記録の本番切替まで指示。通常Bot停止・Slack架空試験投稿なし。

- 本番表のmetadataを読み、実タブ名シート1を確認。D3:I1685のリンクに含まれるチャンネルはC05LY9ZN41Zのみ。
- 20:27:53–57 JST inspectQaProduction成功。GAS記録無効、job_sales-question、シート687行、Notion source5423f700-83c6-4a2a-b67b-fe6765386ffa、質問日時created_time、最新親1789607490.454059/返信48件。
- 20:32:37 JST prepareQaProduction成功。記録無効のまま本番の補助タブを準備。巡回位置を解除し24時間重ね読みに設定。同期ID・人手欄・Actions時計・認証情報保持。Core/Main/QaCutover保存後、再読込・全コピーでローカル完全一致。
- GitHub変数QA_CAPTURE_ENABLED=falseを設定・読戻し。旧Bot36315194803は起動時trueを保持するため、自然終了を待つ。backfill直近2件はcompletedで旧未完了なし。

残り：新Botの記録OFFログ、GAS開始・定期poll・実Sheets/Notion保存照合と遅延・予算測定。
