# QA記録のGAS切替実機記録

2026-09-27 主機CX。本人の「それも一気にいけ」でQA記録の本番切替まで指示。通常Bot停止・Slack架空試験投稿なし。

- 本番表のmetadataを読み、実タブ名シート1を確認。D3:I1685のリンクに含まれるチャンネルはC05LY9ZN41Zのみ。
- 20:27:53–57 JST inspectQaProduction成功。GAS記録無効、job_sales-question、シート687行、Notion source5423f700-83c6-4a2a-b67b-fe6765386ffa、質問日時created_time、最新親1789607490.454059/返信48件。
- 20:32:37 JST prepareQaProduction成功。記録無効のまま本番の補助タブを準備。巡回位置を解除し24時間重ね読みに設定。同期ID・人手欄・Actions時計・認証情報保持。Core/Main/QaCutover保存後、再読込・全コピーでローカル完全一致。
- GitHub変数QA_CAPTURE_ENABLED=falseを設定・読戻し。旧Bot36315194803は起動時trueを保持するため、自然終了を待つ。backfill直近2件はcompletedで旧未完了なし。

- 20:37:06 inspectの最終ガードも成功。本番A:J列名、Notion書込7列の型が一致。
- 旧Bot36315194803は11:40:37.463 UTCにBOT_PLANNED_ROTATIONで自然終了success。次の36316504331（43616a5）は11:40:57 UTCに処理開始。job108612099011のライブログでQA_CAPTURE_ENABLED=falseとAUTH_CLOCK_OWNER=gasを確認。旧backfill in_progress/queuedは共に0。通常Bot取消しなし（待機pushのcancelledは自然再起動による待機置換）。

- 20:43:47 startQaProduction成功。時間トリガーpollSalesQa/tickActionsClockが各1件、合計2件を確認。
- 初回定期poll20:44:02は24.95秒で失敗。deep最新親1789607490.454059のNOTION_DUPLICATE。Sheets更新は完了しB/C/E/H/Iの人手欄が切替前と一致。GASはNotion作成前に停止したため新規重複を作っていない。
- 既存Notion検索は先頭100件に同じ質問時刻の旧ページが返り、URL一致とnull URLの両方を確認。先頭100は取得件数で、重複総数ではない。20:49:11にQA記録だけ一時停止。回答BotとActions時計は維持。
- 同じSlack URL一致の既存ページだけを選び、IDをGAS_SYNC_STATEへ固定する修正を追加。URL矛盾または一致なしは停止。旧ページを削除・新規作成して重複を解消する案は見送り。独立sec BLOCKERなし、Node85/Python15成功。先頭100件外の矛盾検査は未実施、固定ページの読戻しで保存結果を確認する。

残り：修正版GAS再開・定期poll・実Sheets/Notion保存照合と遅延・予算測定。
