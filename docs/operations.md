# 残タスクの運用確認

回答は既存Python→NotebookLM、記録と時計はGASを維持する。

## 外部監視

GASの5分時計がQAブックのGAS_HEALTHへ時刻・登録数・処理時間を保存する。秘密値とQA本文は入れない。GitHubのgas-monitor.ymlが毎時23分に既存のサービスアカウントで読取し、異常時は本人DMへ通知する。JST9時台は成功報告も送る。手動実行のnotify=falseは読取と証跡保存のみ、trueは正常でも本人へ実結果を通知する。

稼働記録20分、QA成功30分、新着巡回60分、全周24時間、時計成功20分、認証成功40分を暫定閾値とする。毎時確認なので、20分閾値の検知は約20〜80分＋GitHub遅延。全周は実測に基づく保証値ではなく、要確認の目安。GAS停止そのものの試験のために正常運転を止めない。監視の健康状態が正常でも、Slack回答全体や新着保存遅延の実証ではない。

監視実行のhealth.jsonを30日保存。停止・欠落はここから実測する。監視自身の依存導入失敗・GitHub全体停止・schedule欠落は本人DMだけでは検出できず、GitHub失敗通知と日次成功報告の未着確認に依存する。GASとGitHubのGOOGLE_SPREADSHEET_IDは同一である必要がある。トリガー数は実行ユーザー所有分。

## 再起動抑制

Botの正常な24分終了だけが自己再起動する。依存準備失敗だけでなくBot異常終了も外部復旧へ任せる。直近30分にfailureがあればwatchdogは待機する。本人DM試験の成功で失敗を打ち消さない安全側の仕様。試験の失敗も待機対象となる。timed_out等はこのfailure検索の対象外だが、即時自己再起動はしない。

GASはwatchdog要求IDの到達を照合して保留を解除し、Botが依然停止中なら次回以降に再要求する。通常5分周期＋GitHub遅延、GASも停止していれば既存4時間保険が次の復旧機会。正常Botを取消して試験しない。

## 認証情報交換

未完了。ブラウザの認証情報変更は本人操作が必要。新鍵→全利用先反映→疎通→旧鍵失効の順を守る。新鍵をこの資料・Git・Vault・チャットへ記載しない。

| 対象 | この構成での利用先 |
|---|---|
| Sales QA BotのSlack Bot token | GitHub SLACK_BOT_TOKEN（Bot、認証更新、外部監視、本人DM試験、停止中backfill）、GAS SLACK_BOT_TOKEN／同値ならSLACK_READ_TOKEN |
| Slack読取キー | GAS SLACK_READ_TOKEN、既存取り込みの共有利用先を照合 |
| Notion integration token | GitHub NOTION_TOKEN、GAS NOTION_TOKEN、共有利用先を照合 |
| 旧Slack Verification Token | Sales QA BotのBasic Information。現行コードには参照なし、旧配置の参照確認後に交換／撤去 |

事故記録connection-preparation.mdの33行で露出対象はSlack投稿/読取と確認。SLACK_APP_TOKENは交換対象と断定しない。Bot app IDはA0B7DFD7EKC。正常Botの旧キーは自然交代完了まで失効しない。ブラウザ管理画面の秘密値を含む全体スナップショットを取らない。

## 重複整理

Sheetsは2026-09-27にQA URL686行/471種類、重複215組を全件読取。全組でB/C/E/H/Iの少なくとも1列に差異がある。退避_重複整理前_20260927（gid=1039857765）へ元タブを全コピーし、対象215行の値・注釈・検証規則等を照合。消去は自動承認審査が人手欄の差異を理由に拒否したため実施していない。代わりに先頭行を残して後続215行を非表示とした。行番号・セル内容は保持。これは表示整理であり物理的な重複解消ではない。再表示で元に戻せる。

NotionはauditQaNotionDuplicatesで全件を読取り、URL別重複と固定同期先を集計する。ページ本文・コメントの退避と人手欄照合が済むまでアーカイブしない。

## 実測上の注意

2026-09-27 22:18:57 JST、関数選択の画面反映を確認せずpollSalesQaを手動で1回実行した。45.379秒、status=ok、日次累計2,933,909ms。22:22:58のqaRecordingProgressではlastDeepCycle=22:03:08.532、lastRecentCycle=22:18:58.592。この区間は定期だけの一周測定に使わない。210秒helperは今回使っていない。24時間と実新着遅延は未実測。
