# NotebookLM回答を維持する構成

2026-09-27本人指示。回答元は本人指定のNotebookLM「ホテルサービスマスター」へ戻す。
GASだけで完結したとは扱わない。既存のPython接続を利用し、回答側のGitHub Actionsは残す。

```
Slackの質問 ──→ Python ──→ NotebookLM ──→ Slackの回答
SlackのQA   ──→ GAS    ──→ Sheets / Notionへ記録
```

## 変更内容

- Pythonの `AIAssistant.answer` はNotebookLMの回答をそのまま返す。認証不足・失敗・空回答は停止し、Claudeへ代替しない。APIキーが残っていてもClaudeを初期化しない。
- 回答・資料更新の両workflowは、指定済みノートブック `ff4df3ed-ae9a-4684-a8d1-8b00a8833ba0` を参照する。
- GASは `AI_BACKEND=notebooklm_external` のみ許可し、QA_CHANNEL_IDだけを巡回する。AIチャンネル・メンション設定が残っていても回答候補を作らず、旧送信台帳からのClaude回答再送も拒否する。
- Pythonの記録機能は既定で継続。記録をGASへ移すときだけ、GitHub変数 `QA_CAPTURE_ENABLED=false` にする。Socket Modeのイベント記録と起動時の追いかけ記録、poll.py直接実行の記録を止める。
- 旧Claude補助処理とテストは履歴・退行確認用に残るが、通常の回答経路では呼ばない。過去のClaude用smoke関数を新構成へ貼って実行しない。
- NotebookLMは元と同じく質問文字列を渡す。Claude用の20資料・直近100QAを回答資料として渡す構成は使わない。画像の新規対応など、元にない機能も追加していない。

## 本番へ反映する前の確認

1. この変更は専用ブランチへ保存する。mainへのpushはbot.ymlを起動して本番を更新するため、本人の切替指示まで行わない。
2. 既存NOTEBOOKLM_STORAGE_JSONの認証で指定ノートブックに質問できることを検証する。ローカル単体テストだけでは認証・実回答を確認したことにならない。
3. 切替指示後、PythonをNotebookLM固定版へ更新。GASを停止したまま回答の実動作を確認する。
4. 記録も移す場合はQA_CAPTURE_ENABLED=falseへ変更し、旧設定の実行が終了して新設定で起動したことを確認してからGAS記録を有効化する。同じ表への二重記録を避ける。
5. GASのチャンネル構成を変更する前に、停止状態でSCAN_STATE/RECENT_STATEとGAS_STAGE/GAS_STAGE_RECENTをリセットする。旧チャンネル番号・旧stageを新構成へ混ぜない。同期先を変えない場合、GAS_SYNC_STATEのNotion page IDは保持する。
6. bot.yml、sync.yml、auth-refresh.ymlはNotebookLM運用に必要なため停止しない。元の「全旧workflow停止→GASのみ」の手順は撤回する。

## 検証の限界

- GAS単体テストは設定から回答候補が作られないこと、旧送信台帳の再送を拒否することを確認する。
- Python単体テストは回答の透過返却・代替禁止・空回答/認証なしの停止を確認する。
- 2026-09-27、復元Python経路から指定NotebookLMの実回答を本人DMへ送信し、別読取で照合済み（run 36270379483）。GAS記録への本番切替と長期連続稼働は未検証。
- NotebookLM接続ライブラリはPythonの非公式クライアント。GASから直接使えるものではない。[ライブラリの説明](https://github.com/teng-lin/notebooklm-py)。

## 回答Botと認証更新の継続運転

- 回答Botは24分で子プロセスを終了し、ジョブ35分の上限より前に次の実行を要求する。キャンセルされた旧実行から再起動しない。
- 稼働中Botが起動直後・以後5分ごとにauth-refreshを要求。GitHub scheduleの遅延に依存しない通常経路とし、30分ごとの認証cronは保険として残す。GitHub全体の障害や実行枠不足は回避できない。
- 認証を書き込むのはauth-refreshのみ。同一workflowの並列実行を禁止し、待機中にSecretが更新された実行・処理中にSecretが変更された実行は保存せず失敗扱いにする。次の起動で新しい値を読む。
- 更新・Secret保存・更新時刻の読み戻しが揃って成功。Bot自身が読む認証は次のBot起動時に更新される（最大約24分）。Googleが認証を失効させた場合は本人の再ログインが必要。
- 本人DMに初回障害・復旧・UTC日付で1日1回の認証成功を通知。連続する同種の認証失敗通知は抑制。成功通知だけの失敗は認証失敗と混同しない。
- QA記録は今回Pythonに残す。GASにはテスト用の保存先しか設定していないため、有効化しても本番記録の移行にはならない。回答復元の反映とGAS記録の切替は別作業。
