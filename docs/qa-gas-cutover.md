# QA記録をGASへ移す

本人の2026-09-27「それも一気にいけ」で、本番QA記録の切替まで指示。

```text
Slack質問 → 既存Python → NotebookLM → Slack回答（維持）
Slack QA → GASの5分巡回 → セールスQA「シート1」＋既存Notion
PythonのQA記録 → OFF（通常Bot・認証更新・資料同期は維持）
```

本番表のURL列にあるQAチャンネルはC05LY9ZN41Zのみ。GASのinspectでjob_sales-questionを確認。表は1uZpR4M8spaNV9cEXQ4_jB_NOu6w8j2HIGwnyUNQl28Y、Notion DBは60255780-4556-4b86-b83c-9ebc579ce31a。既存認証情報は取得・表示・再設定しない。

## 切替順序

1. Core＋Main＋QaCutoverをコード.gsへ保存。一致を確認。ActionsClock.gsは保持。
2. inspectQaProductionで本番表・QA読取・Notion型を確認（書込みなし）。
3. prepareQaProductionで記録を無効のまま本番の補助タブを準備し、旧検証先の巡回位置を解除。同期IDと本番QA既存行は消さない。新着はSTATEと24時間前の早い方から10分重ねる。
4. mainへ担当ログとbackfill停止ガードを反映。GitHub変数QA_CAPTURE_ENABLED=false。旧Bot・旧backfillの未完了を確認し、旧Botの自然終了を待つ。Botを取り消さない。
5. 新BotのQA_CAPTURE_ENABLED=falseとAUTH_CLOCK_OWNER=gasログを確認してからstartQaProduction。5分pollSalesQaトリガー1件を確認。
6. 定期poll、実スレッドのSheets/Notion保存、保留・重複・人手欄保持、実行時間・一周の進捗を照合。架空投稿で本番表を汚さない。

旧runは起動時の設定を保持する。変数変更だけで記録が停止したとは扱わない。手動backfillにも同じOFFを適用。GASが停止した場合はENABLED=false→GAS実行終了確認→QA_CAPTURE_ENABLED=true→Pythonの自然交代で戻す。Actions時計は止めない。

## 遅延と利用枠

新着は5分ごと。古い親への返信はdeep巡回の一周待ちが加わる。5分は即時記録の保証ではない。既定45秒の予算、288回/日なら目安12,960秒（3.6時間）。API1回分は予算を超過し得る。日次実行制限を守り、実機の一周時間と日次使用量を証拠へ記録する。

## 証拠

実機結果・レビューはdocs/evidence/qa-gas-cutover-20260927/。モック成功と本番記録成功は区別する。
