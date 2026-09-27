# GASから本人DMへの単発実試験

2026-09-27。実行コードb163f4f。本人が専用PATを設定後、GASから1回だけ起動した。

## 到着確認と試験判定を分けた結果

GAS→GitHub Actions→NotebookLM実回答→本人DMへの投稿1件を確認。Actionsの終了判定はfailure。回答取得後・Slack投稿結果確認の段階で失敗扱いになったが、別のSlack連携による読取りで到着を確認した。再送・再実行は行っていない。

| 観測 | 日本時間 | 根拠 |
|---|---|---|
| GAS要求 | 12:35:36.321 | requestedAt=2026-09-27T03:35:36.321Z |
| Actions受付・run開始 | 12:35:37 | run 36291860184、同じ照合ID |
| 単発job開始 | 12:35:40 | GitHub jobs API |
| NotebookLM回答取得ログ | 12:36:36.816 | `NotebookLMの実回答を取得。本人DMへ1回送信します。` |
| Slack投稿 | 12:36:36.920109 | Slack ts=1790480196.920109 |
| 送信結果確認で失敗扱い | 12:36:36.998 | `TEST_FAILED stage=slack_post_unknown_on_failure` |
| job終了 | 12:36:38 | conclusion=failure |

GAS要求からSlack投稿まで約60.6秒。回答取得時刻はログ出力時刻で、モデル内部の完了時刻そのものではない。

- 照合ID：`0a7c959b-d615-4857-a995-18f1d8a7ce1c`
- [Actions実行](https://github.com/kanazawa18-19/sales-qa-bot/actions/runs/36291860184)
- [本人DMの回答](https://cnctor.slack.com/archives/D0B87Q9U54G/p1790480196920109)
- 質問は既定の「ホテルラボはどのようなサービスですか？資料に基づいて簡潔に教えてください。」。Slackユーザー発言を検知した試験ではない。
- read_channelで試験開始後の投稿が1件、対象IDが1回、ページ続きなし。read_threadでも同じ本文を取得、返信0件。
- 両読取の本文1,428文字が一致。取得本文のSHA256は`c5183004eee0fb47e47f2d9f176ba76cd2aa4f1211717204a554951025076e07`。本文は公開Gitへ保存しない。
- 当初スクリプトは比較失敗後にDM_SENTログを出さないため、送信前本文ハッシュとの照合は未実施。上記ハッシュはSlack読戻し本文の値であり、送信前の値ではない。
- run-bot / owner-http-smokeはskipped。試験前からの本番Bot run36290950803は照合後もin_progress、main=4beaea5。試験による二重常駐・取消しなし。

## 判定処理の小修正

Slackは絵文字・URLを保存時に変換する公式仕様がある。読戻し本文に`:bulb:`が含まれており、その変換が送信前本文の完全一致を壊した可能性が高い。ただし元の送信前本文は記録されていないため、この個別差分は未確定。

`owner_dm_smoke.py`を、本人DMの宛先・投稿ts・空でない本文・照合IDを確認したうえで、Slack受理本文と送信前本文のハッシュを別々に記録するよう修正。Slack受理本文のハッシュを今後の別読取との照合対象とする。受理確認だけで本文全体の一致を保証するわけではない。送信後のエラーを理由とした再送は引き続き行わない。

Python34件成功（本文変換、誤宛先、照合ID欠落を追加）。実装者と別のQA担当も34件を再実行し、確定BLOCKERなしを確認。修正版での新規DM送信は実施していない。実配送の証拠は上記1回のみ。

[Slackの本文・絵文字変換の公式仕様](https://docs.slack.dev/messaging/formatting-message-text/#emoji)

## 終了状態

12:36:43 JSTのGAS health：enabled=false / migrationAck=false / tokenConfigured=true / triggerCount=0。smoke要求はacceptedで保持し再送防止。定期時計・本番変数・QA記録・GCP課金は変更なし。

PATの設定有無とGitHub受付は確認したが、PATの対象範囲・期限・編集者一覧の画面を実地検証したわけではない。秘密値は取得・表示していない。
