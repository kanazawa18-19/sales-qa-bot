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
- NotebookLMの実認証・実回答と、この分担での通し動作は未検証。前回のClaude DM試験をNotebookLMの検証結果へ流用しない。
- NotebookLM接続ライブラリはPythonの非公式クライアント。GASから直接使えるものではない。[ライブラリの説明](https://github.com/teng-lin/notebooklm-py)。
