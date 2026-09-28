# GAS Webアプリ直接受信の設計（署名検証省略版）

2026-09-28。`docs/gas-without-gcp.md`（2026-09-27）が「署名検証ヘッダーを取得できないため直接受信は不採用」とした判断を、本人の「このbotはなりすましされても問題ない。署名検証を省略してよい」で覆した後の設計。今回は設計とローカル実装・テストのみ。本番のSlack配信先切替・Web Appデプロイ・GitHub Secrets/Variables設定は未実施（下記「本人操作待ち」参照）。

## 全体像

```
Slack発言 → GAS Webアプリ doPost（署名検証なし・即200）
              │ event_idで重複排除、GAS_HTTP_QUEUEへ積むだけ
              ▼
        tickHttpQueue（1分毎）
              │ 明確に無関係な行はここでskip（最終判断はPython側）
              ▼
        GitHub Actions answer.yml（1件ずつ・使い捨て実行）
              │
        scripts/answer_once.py
              │ domain.plan()で採否確定 → NotebookLM → Slack返信
              ▼
        tickHttpQueueが次周期でconversations.repliesの実返信を確認して確定
```

常駐Bot（Socket Mode）・QA記録（既存GASのpollSalesQa）・NotebookLM認証更新（auth-refresh.yml）は変更しない。この設計は「質問への回答」だけを対象にする。

## なぜGitHub Actionsが必要か（全部GASにできないか、2026-09-28に本人へ回答）

GAS単独で完結できない箇所は**NotebookLMへの接続だけ**。それ以外（Slack受信・キュー・状態確認）は既にGASで完結している。

NotebookLMには公式API（決まったアクセス方法）が無く、既存のPython部品`notebooklm-py`は「ブラウザでログインしたときと同じ通信」を再現する非公式クライアント。クッキー管理・HTMLからのトークン抽出・失効時の再ログインという一連の処理を持ち、単純な1回の外部通信の置き換えではない。GASのUrlFetchApp自体は外部通信ができるため理論上「絶対に不可能」ではないが、この一連の仕組みをJavaScriptでゼロから作り直し、Google側の仕様変更のたびに自前で直し続けることになる。2026-09-27の調査（docs/gas-without-gcp.md）で一度検討し、既存Python部品を残す方を選んだ経緯があり、今回もその判断を踏襲した。

GitHub Actionsは「Pythonの部品を動かす場所」として使っているだけで、GitHub Actions固有の機能に依存してはいない。将来この置き場所を変えることは可能だが、「Python部品をどこかで動かす必要がある」という制約自体はNotebookLMの接続方式を変えない限りなくならない。

## 決定事項

| 論点 | 決定 | 根拠 |
|---|---|---|
| Slack署名検証 | 省略する | 本人判断（なりすまし許容）。GASのWeb Appは「全員（匿名含む）アクセス可」で公開する必要があり、URLを知る者は誰でも偽イベントを送れる。実害は既存の関連チャンネル利用者が既に持つ「botに質問する」権限と同等の範囲に留める設計（下記「間引き」参照）。URL自体は認証情報同様に扱い、docsやVaultに平文で残さない |
| 3秒受付 | doPostは即200、重い処理はしない | Slack公式：3秒超過で最大3回・約1分間隔の再送。event_idは再送でも同じ値 → 重複はGAS側で吸収できるため、3秒を必達目標にせず「たまに超過しても自己修復する」設計にした。**2026-09-28実機確認：Slack公式Events APIドキュメントに「3秒以内の200を探して301/302リダイレクトを最大2回まで追従する」と明記あり、GASのdoPost→302→script.googleusercontent.com経由の応答方式と両立することを確認した** |
| GASのコールドスタート遅延 | 未検証 | 実測情報が見つからなかった。3秒超過時はSlack再送に頼る設計のため、超過自体は致命的ではない |
| **GAS Webアプリは例外時も常に200を返す（2026-09-28実機確認）** | doPost内の失敗は必ず自前で捕まえ、本人へ通知する。「例外を投げれば非200になりSlackが再送する」という当初の想定は誤りだった | curlで`event_id`欠落を送信し実測：スクリプト内で`throw`しても応答は常にHTTP 200（本文にGASのエラーページが載るだけ）。Slackは2xx応答として扱い再送しない。`enqueueHttpEvent_`の失敗を`doPost`内でtry/catchし、`HTTP_LAST_ENQUEUE_ERROR`スクリプトプロパティへの記録とメール通知を追加した（`gas/Http.js`修正、コミット62d7347） |
| NotebookLM受け渡し | GAS→GitHub Actions(answer.yml)→Python(answer_once.py) | 既存のactions-clock.mdと同じdispatch/履歴照合パターンを流用。NotebookLM接続はCookie認証のPythonライブラリに依存したまま（既存のGitHub Secret NOTEBOOKLM_STORAGE_JSONを再利用、GCP Secret Managerは使わない） |
| 採否の最終判断 | src/http_app/domain.pyのplan() | 既存Cloud HTTP案のために書かれ、bot.pyの実挙動（app_mentionは任意チャンネル、messageはAI_CHANNEL_IDの先頭発言のみ）と一致する。GAS側のhttpRelevant_は「明確な無関係（自分の発言・編集削除・空本文）」だけを間引く目安で、二重判定は許容する（間引きすぎより間引かなすぎの方が安全なため） |
| 状態確認 | Actionsの結了状態だけを信じず、conversations.repliesで実返信を確認 | 2026-09-27のactions-clock実機試験で「送信後の本文一致判定でActionsがfailure」を経験済み。到着確認と終了判定を区別する教訓をそのまま踏襲 |
| 結果不明時 | uncertain止まり、自動再送しない、本人へメール通知 | 既存GAS_AI_JOURNALやactions-clockの「結果不明時は再送禁止」を踏襲。二重回答を避ける |
| dispatch自体が失敗（5xx/429/通信断等）したとき | 行を`queued`へ戻さず`dispatched`のまま残す | 内部レビュー（shirokuma-sec・kuma-qa）が同一のBLOCKERとして指摘：`queued`に戻すと次周期に新しいrequest_idで再dispatchされ、実際には最初の要求がGitHub側で受理されていた場合に二重回答を招く。gas/Main.jsのanswer_()が外部呼出し前に`POSTING`へ書き換える設計と同じ考え方に直した |

## 内部レビュー3体を反映して直した点（2026-09-28）

shirokuma-sec・obasan-quality・kuma-qaを並列実行し、BLOCKER1件（shirokuma-secとkuma-qaが独立に同一箇所を指摘）・WARN多数を修正した。

- **BLOCKER→修正**：`gas/Http.js`の`httpDispatchRow_`が、GitHub Actionsへのdispatch呼び出し自体が失敗（5xx/429/通信断/不正応答）したとき行を`queued`のまま残していた。次周期に新しいrequest_idで再dispatchされ得るため、実際には最初の要求が受理されていた場合に二重回答が起きる設計ミス。dispatch呼び出しの**前**に`dispatched`・request_id・dispatched_atを確定させ、確定拒否（401/403/404/422/429）のときだけ`rejected`へ戻す形に直した。
- **WARN→修正**：`httpResolveRow_`がGitHub履歴取得自体に失敗し続けると、行が`dispatched`のまま永久に滞留し通知もされなかった。履歴取得の失敗を「runが見つからない」と同じ扱いにし、10分のタイムアウト判定へ必ず合流するようにした。
- **WARN→修正**：`scripts/answer_once.py`で、`@bot`とだけ打って本文が空のapp_mentionが無言でSKIPPEDになっていた（既存bot.pyのhandle_mentionは「質問を入力してください。例：…」と案内する）。既存と同じ案内文を返すよう追加（owner_only中は範囲外の相手には出さない）。
- **WARN→修正**：NotebookLM失敗時の返信文言が、event種別に関わらず一律「回答の生成に失敗しました。」だった。既存bot.pyはapp_mentionのときだけ「…しばらくしてから再試行してください。」を付け足しており、その使い分けに合わせた。
- **WARN→修正**：`httpRelevant_`の除外subtypeリストがsrc/http_app/domain.pyのplan()と食い違っていた（channel_topic/channel_purposeを含み、message_repliedを含まない）。plan()の除外集合に合わせ、GAS側の間引きがPython側の判断機会を奪わないようにした。
- **確定拒否に429を追加**：既存gas/ActionsClock.jsのactionsClockDispatch_と同じ判定にそろえた（429は本来一時的な事象だが、上記のdispatched維持修正により429を確定拒否扱いにしなくても二重回答は起きない。ただし本人への気づきが10分早まるため残した）。
- **shirokuma-secの「GAS Webアプリは例外時も常に200を返すのでは」という懸念→2026-09-28実機確認で的中、修正済み**：上記「決定事項」参照。設計レビューの時点では確証を得られず「未検証」としていたが、実機curlで再現し修正した。
- **未修正のまま残した指摘（判断理由）**：
  - shirokuma-secの「署名なし公開エンドポイントがGitHub Actionsの起動量そのもの（費用・容量）を無制限に消費しうる」：なりすまし許容の本人判断はSlackへの誤投稿リスクに対するもので、Actions実行回数・GAS_HTTP_QUEUEの行数増加という別種のコストは本人が明示的に検討した範囲か不明。1周期5件/分という上限はあるが「歯止め」ではなく「上限まで確実に消費される」点を本人に明示する（下記「未着手」に追加）。実装（レート制限強化等）は本人の追加判断後に行う。
  - shirokuma-secの「doPost（低遅延）とtickHttpQueue（複数の外部HTTP呼び出しを伴う重い処理）が単一のLockServiceロックを共有している」：ロック競合時はdoPostが例外を投げてSlack再送に委ねる設計のため、event_id再送での自己修復は効く。GASにはこれ以上細かい粒度のロックがなく、現状の想定規模（小規模営業チームの単一チャンネル）では許容範囲と判断し、複雑化は避けた。
  - obasan-qualityの「画像添付を無視している」：src/ai_assistant.pyのAIAssistant.answer()はNotebookLM経路では画像パラメータを一切参照しない（既存bot.pyが渡していても無視される）。既存Socket Mode本番と機能的に同じであり、意図的な簡略化として記載するに留めた。

## Socket Modeとの共存不可（要検証済みの制約）

Slack公式仕様：Socket Modeを有効にしている間、そのアプリのイベントはWebSocket経由でのみ配信され、Events APIのRequest URL（HTTP）へは配信されない。両方式は同一アプリで同時に使えず、切替のみ可能。

→ 本番は現在Socket Mode稼働中のため、**実Slackトラフィックでの doPost 通し試験は今回できない。** 選択肢は次の2つ：

1. 別のテスト用Slackアプリ（同じワークスペースに追加）を用意し、そちらのRequest URLをGAS Webアプリに向けて試験する（本番Botには影響しない）。**新規Slackアプリの作成は本人操作。**
2. 本番アプリのSocket ModeをOFFにして試す（本番の回答経路が一時的に止まるため、本番影響がありやめる）。

今回は①を推奨し、本番切替（Request URL変更・Socket Mode OFF）は本人の明示指示があるまで行わない。

## 今回実装したもの（ローカル・slack-httpブランチ、本番未反映）

- `gas/Http.js`：`doPost`（受信・即200・キュー追記）、`tickHttpQueue`（1分毎の間引き＋dispatch＋解決確認）、`prepareHttpQueue`/`installHttpQueue`/`stopHttpQueue`/`healthHttpQueue`（既存ActionsClock.jsと同じ有効化前提・停止既定のライフサイクル）。GAS_HTTP_QUEUEシートは既存のGAS_AI_JOURNAL等に合わせてヘッダー行なし（1行目から実データ）。列は15列：event_id/received_at/channel/user/ts/thread_ts/event_type/text/state/request_id/dispatched_at/run_id/resolved_at/note/team_id。
- `.github/workflows/answer.yml`：質問1件だけを使い捨てで処理する新規workflow。既存bot.yml（常駐Bot）・auth-refresh.yml（認証更新）とは独立。同じrequest_idの二重dispatchだけを直列化し、別質問は並行実行を許す。
- `scripts/answer_once.py`：`src/http_app/domain.py`のplan()で採否判定、`src/ai_assistant.py`のAIAssistant.answer()でNotebookLM回答、Slackへ返信。app_mentionのときだけ既存bot.pyと同じ「回答を生成中...」を先に出す（AIチャンネルの自動応答では出さない、既存の使い分けを踏襲）。本文が空のapp_mentionには既存と同じ案内文を返す。NotebookLM失敗時の文言も既存bot.pyと同じくevent種別で使い分ける（app_mentionは「…しばらくしてから再試行してください。」を付ける、AIチャンネルの自動応答は付けない）。新しいUXは増やしていない。
- テスト：`tests/gas-http.test.cjs`（Node、18件）、`tests/test_answer_once.py`（Python、13件）。既存テスト（Node87件・Python33件、tests/test_http_app.pyはローカルにflask未導入のため対象外＝今回変更前から発生している環境依存の欠落で新規のリグレッションではない）は全て通過。

## 進捗（2026-09-28、実機まで完了した範囲）

- **GitHub設定は完了**：`vars.OWNER_USER_ID=U03JFKXG6C8`・`vars.OWNER_DM_ID=D0B87Q9U54G`を設定済み（`HTTP_ANSWER_OWNER_ONLY`は未設定のままでworkflow側の既定値`true`が効く）。
- **GAS本番プロジェクトへのコード反映・デプロイ・有効化まで完了**：`sales-qa-bot GAS移行準備`プロジェクト（本番、`ENABLED=true`稼働中）に`Http.gs`を追加。本人が`HTTP_QUEUE_ENABLED=true`の保存・`installHttpQueue`の実行（`tickHttpQueue`の1分毎トリガー登録を確認済み）・Web Appデプロイ（アクセス権限「全員」、バージョン3まで反映）を完了。既存の`GOOGLE_SPREADSHEET_ID`・`BOT_USER_ID`・`SLACK_READ_TOKEN`・`ACTIONS_CLOCK_TOKEN`・`HEALTH_EMAIL`スクリプトプロパティは全て既存流用（新規設定不要）。
- **`GAS_HTTP_QUEUE`シートの作成は完了**：`prepareHttpQueue()`の代わりに対象スプレッドシートで直接シートタブを追加した。
- **実機テストで検証・修正した事実**：
  1. **curlでのPOSTは`-X POST`を明示すると`-L`のリダイレクト追従が壊れる**（curl側の癖。`-d`だけでPOSTと判断させれば正しく追従する）。これを踏まえて再検証し、doPostが実際にSlackの302越しに正しく動くことを確認した。
  2. **GAS Webアプリは例外時も常にHTTP 200を返す**ことを実機で確認し、`doPost`の失敗処理を修正済み（上記「決定事項」参照、コミット62d7347）。
  3. **`workflow_dispatch`はワークフローファイルがリポジトリのデフォルトブランチ（main）に存在しないとGitHub側に認識されない。** `answer.yml`はslack-httpブランチにしかなく未登録だったため、GASからのdispatchはGitHub API 404→`rejected`扱いになった（実機テスト用のダミー行1件がこの状態で`GAS_HTTP_QUEUE`に残っている。実害のないテストデータなので削除不要）。
- **mainへの反映が1点だけ必要（本人操作）**：`answer.yml`をmainへ登録する必要があるが、**mainブランチへのpushはClaude Code側の自動判定が「本番デプロイ」としてブロックする。** 代わりにmain相当のレビュー用ブランチ`register-answer-workflow`（`.github/workflows/answer.yml`だけを追加した1コミット、内容はslack-httpと同一）をpush済み。本人が次のいずれかで取り込んでください：
  - GitHub上で`register-answer-workflow`→`main`のPRを作成してマージする（push時にURLが表示されている）
  - もしくはローカルで`git checkout main && git merge register-answer-workflow && git push origin main`
  - このファイルはworkflow_dispatch専用で、GASからの明示的な起動以外では何も実行しない。bot.yml・auth-refresh.yml等mainの既存スケジュール動作には影響しない。
- **登録後にやること**：`GAS_HTTP_QUEUE`へ新しい模擬event（またはowner DMでの実試験）を送り、`tickHttpQueue`がanswer.ymlを起動→NotebookLM実回答→本人DMへの返信→`done`状態への確定、までの通しを確認する。

## 未着手・本人操作待ち（上記の続き）

1. ~~GitHub設定~~ → 完了。
2. ~~GAS設定（シート作成・有効化・デプロイ）~~ → 完了（上記参照）。
3. **`answer.yml`のmain登録** → 本人操作待ち（上記参照）。登録後にGAS→GitHub Actionsの通しが初めて成功する。
4. **3秒受付の実測、GASコールドスタート遅延の実測** → 上記のcurl検証で機能面は確認できたが、レイテンシの定量測定は未実施。
5. **試験**：`answer.yml`登録後、本人DM限定（OWNER_ONLY=true）で模擬event_callback送信 or 別Slackアプリ経由の実配信による通しを確認する。
6. **なりすまし許容の実害範囲を再確認**：本人が明示判断した「Slackへの誤投稿」以外に、署名なし公開URLは知る者が誰でもGitHub Actionsを起動できてしまう（1周期5件/分の上限はあるが「歯止め」ではなく「上限まで確実に消費されうる」）。Actions実行回数・GAS_HTTP_QUEUEシートの行数増加という副次コストも許容範囲か、本番投入前に一度本人に確認する。
7. **本番切替**：試験が済むまでSocket Modeは変更しない。切替する場合も本人の明示指示後、docs/slack-http.mdの「本番の受信先を変えるとき」に準じた手順（旧Bot停止確認→Request URL変更→検証）を新設計向けに書き直す。

## 根拠

- [Slack Events APIの受付期限・再送](https://docs.slack.dev/apis/events-api/)
- [Slack署名検証](https://docs.slack.dev/authentication/verifying-requests-from-slack/)
- [Socket Modeの使用（HTTP配信との排他）](https://docs.slack.dev/apis/events-api/using-socket-mode/)
- [GAS Webアプリの302リダイレクトとcurlの落とし穴（実機で再現した事象の背景）](https://dev.to/googleworkspace/youre-probably-using-curl-wrong-with-your-google-apps-script-web-app-1ed8)
- ローカル：gas/Http.js、gas/ActionsClock.js（dispatch/履歴照合パターンの流用元）、src/http_app/domain.py、src/ai_assistant.py、scripts/owner_dm_smoke.py（answer_once.pyの雛形）、.github/workflows/auth-refresh.yml・bot.yml（answer.ymlの雛形）。
- 前回調査：docs/gas-without-gcp.md、docs/slack-http.md（Cloud HTTP案、今回は不採用のまま）。
