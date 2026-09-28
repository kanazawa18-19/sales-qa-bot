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

## 決定事項

| 論点 | 決定 | 根拠 |
|---|---|---|
| Slack署名検証 | 省略する | 本人判断（なりすまし許容）。GASのWeb Appは「全員（匿名含む）アクセス可」で公開する必要があり、URLを知る者は誰でも偽イベントを送れる。実害は既存の関連チャンネル利用者が既に持つ「botに質問する」権限と同等の範囲に留める設計（下記「間引き」参照）。URL自体は認証情報同様に扱い、docsやVaultに平文で残さない |
| 3秒受付 | doPostは即200、重い処理はしない | Slack公式：3秒超過で最大3回・約1分間隔の再送。event_idは再送でも同じ値 → 重複はGAS側で吸収できるため、3秒を必達目標にせず「たまに超過しても自己修復する」設計にした |
| GASのコールドスタート遅延 | 未検証 | 実測情報が見つからなかった。3秒超過時はSlack再送に頼る設計のため、超過自体は致命的ではない |
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
- **未修正のまま残した指摘（判断理由）**：
  - shirokuma-secの「GAS Webアプリは例外時も常に200を返すのでは」という懸念：ウェブ検索では確証も反証も得られなかった（未検証）。この設計全体が「doPost内の例外→非200→Slack再送」に部分的に依存しているため、**本番投入前に実機で必ず確認する項目として下記に追加**した。
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

## 未着手・本人操作待ち

1. **GitHub設定**：`vars.HTTP_ANSWER_OWNER_ONLY`（既定true）・`vars.OWNER_USER_ID`・`vars.OWNER_DM_ID`（repository variables、非シークレットのSlack ID）。既存`secrets.AI_CHANNEL_ID`・`secrets.SLACK_BOT_TOKEN`・`secrets.NOTEBOOKLM_STORAGE_JSON`は追加設定不要。GASの`ACTIONS_CLOCK_TOKEN`・`BOT_USER_ID`・`SLACK_READ_TOKEN`スクリプトプロパティも既存流用で新規設定不要（新しく要るのは`GOOGLE_SPREADSHEET_ID`のみ、これも既存pollSalesQaと同じ値）。
2. **GAS設定**：`prepareHttpQueue()`実行→シート作成確認→Web Appとしてデプロイ（アクセス権限「全員（匿名を含む）」が必須、これも本人判断が要る変更）→`HTTP_QUEUE_ENABLED=true`→`installHttpQueue()`。
3. **実機で必ず確認する項目（本番投入前）**：
   - **doPost内で例外を投げたとき、Slackから見て実際に非200が届くか。** ウェブ検索では「常に200」「未捕捉例外は500になる」の両方の情報があり確証を得られなかった。ここが崩れていると「曖昧な内部障害はSlack再送に任せる」という設計全体の前提が崩れ、イベントが静かに失われる。
   - 3秒受付の実測、GASコールドスタート遅延の実測。
4. **試験**：本人DM限定（OWNER_ONLY=true）で、別Slackアプリ経由の実配信 or 模擬event_callbackペイロードの直接POSTで通しを確認。
5. **なりすまし許容の実害範囲を再確認**：本人が明示判断した「Slackへの誤投稿」以外に、署名なし公開URLは知る者が誰でもGitHub Actionsを起動できてしまう（1周期5件/分の上限はあるが「歯止め」ではなく「上限まで確実に消費されうる」）。Actions実行回数・GAS_HTTP_QUEUEシートの行数増加という副次コストも許容範囲か、本番投入前に一度本人に確認する。
6. **本番切替**：試験が済むまでSocket Modeは変更しない。切替する場合も本人の明示指示後、docs/slack-http.mdの「本番の受信先を変えるとき」に準じた手順（旧Bot停止確認→Request URL変更→検証）を新設計向けに書き直す。

## 根拠

- [Slack Events APIの受付期限・再送](https://docs.slack.dev/apis/events-api/)
- [Slack署名検証](https://docs.slack.dev/authentication/verifying-requests-from-slack/)
- [Socket Modeの使用（HTTP配信との排他）](https://docs.slack.dev/apis/events-api/using-socket-mode/)
- ローカル：gas/Http.js、gas/ActionsClock.js（dispatch/履歴照合パターンの流用元）、src/http_app/domain.py、src/ai_assistant.py、scripts/owner_dm_smoke.py（answer_once.pyの雛形）、.github/workflows/auth-refresh.yml・bot.yml（answer.ymlの雛形）。
- 前回調査：docs/gas-without-gcp.md、docs/slack-http.md（Cloud HTTP案、今回は不採用のまま）。
