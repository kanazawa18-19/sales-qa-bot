# GASの5分時計への切替

コード準備中。本番GASはまだ停止、時計担当は既存Botのまま。Chrome接続不良のため、GAS保存・トリガー登録・実機照合は未実施。

```text
GAS 5分時計 → 認証更新の未完了なし → auth-refresh（既存の更新担当）
            → Botの未完了なし     → watchdog → 再確認して復旧要求
稼働・待機Botあり                 → Botへ何もしない
Botの24分自己再起動               → 維持
GitHub 認証30分・復旧4時間時計    → GAS停止時の保険
```

GASは通常Botを取り消さない。復旧直前の再確認と共通実行枠による直列化は既存watchdogが担当する。停止や待機が長い場合は本人宛メールで通知する。GitHub受付と実処理成功、Slack実回答成功はそれぞれ別に確認する。

## 保存と切替

1. 既存準備用GASのActionsClock.jsを更新する。既存Core/Main・QA記録設定・本人DM試験の記録は保持する。既存ACTIONS_CLOCK_TOKENとHEALTH_EMAILの値を取得・表示・再入力しない。設定有無だけ確認する。停止状態・トリガー0、ローカルコードと保存コードの一致を確認。
2. この専用ブランチだけmainへ反映する。AUTH_CLOCK_OWNERはまだbotを維持する。auth-refreshとwatchdogに照合IDの入力定義が必要。HTTP版・QA記録切替は含めない。
3. GASでstartActionsClockを実行（設定済みの鍵・通知先を保持し、移行ACKと時計有効化・トリガー登録を行う）。5分トリガー1件を確認し、最初のtickとGAS照合IDによるauth-refresh到達・実成功を確認する。この短い移行期間は旧Botからの要求もあり得るが、更新担当は既存auth-refreshの共通枠1つだけ。未完了状態を見てGASは要求を控える。
4. GASの実成功確認後、GitHub変数AUTH_CLOCK_OWNER=gasを設定。旧Botを取り消さず、自然交代を待つ。新Botでは5分認証要求が止まり、認証の鮮度確認・異常通知は残る。GASトリガー由来のtickが2回動き、最終認証成功30分以内・Bot稼働・要求照合・所要時間を確認する。
5. GASの定期到達確認後に、GitHubの復旧保険時計だけを4時間にする。準備コードも既存30分設定を保持する。確認後にwatchdogだけ`47 */4 * * *`へ別差分で緩める。認証更新のauth-refreshは30分保険を維持する。

切替前にGAS保存・PAT設定有無・通知先・初回承認を確認できなければ時計担当は変更しない。GASに問題が出たらstopActionsClock→AUTH_CLOCK_OWNER=bot→自然交代確認で戻す。既存Botは停止しない。

## 重複と結果不明の扱い

POST送信前に認証要求・復旧要求を別のScript Propertiesへ保存。照合IDの実行名が見えるまで同じ要求を再送しない。10分経って見えなければ本人メール通知。401/403/404/422/429は確定拒否、通信失敗は結果不明として区別し、どちらも自動再送しない。解除はActions履歴と照合してから行う。未完了一覧の件数不一致・100件超・不明応答は停止とみなさず、復旧を要求しない。

通知は日次成功報告、日次異常再通知、1時間の間隔制限を持つ。復旧や認証の要求が保留のままの場合、無人で必ず回復する保証はない。4時間の保険もGitHubの遅延・欠落があり得る。

## 本人DM試験

runActionsClockOwnerSmokeは既存slack-http branchの本人専用試験を呼ぶ。そのbranchにはclock_request_id入力定義がある。main版bot.ymlへ試験用入力を増やす必要はない。以前の到着確認は完了しており、今回は再送しない。ACTIONS_CLOCK_SMOKE_REQUESTを保持する。

## 認証と検証

PATは本人が準備用GASのScript Propertiesへ設定済み。今回新規作成・取得・移動・権限拡大はしない。対象リポジトリ限定Actions Read/writeの既存権限を利用する。秘密値をコード・Git・Vaultへ保存しない。

ローカルテストはAPI置換で、実GASトリガーやGitHub配送の証拠ではない。3体レビュー・実機結果・未実施項目は今回のevidenceへ記録する。
