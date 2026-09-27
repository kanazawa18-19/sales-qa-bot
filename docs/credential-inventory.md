# 露出認証情報の利用先調査（2026-09-27）

鍵交換はしていない。今回の調査は保存先・参照先の特定だけ。秘密値・ハッシュは記録せず、値の比較結果だけを残す。

## 交換対象の確定表

| 対象 | 保存・利用先 | 確認したこと |
|---|---|---|
| Slack投稿：Sales QA Bot / A0B7DFD7EKC | QA用GAS `SLACK_BOT_TOKEN`、GitHub sales-qa-bot `SLACK_BOT_TOKEN` | GASの存在・GitHub Secret名・参照workflowを確認。GitHub値は読戻せず同値比較不可。既存接続準備記録では同アプリの投稿キーをGASへ保存 |
| Slack読取：kanazawa-obsidian / A0BT719KLAH | QA用GAS `SLACK_READ_TOKEN`、主機 `~/notes-sync/.env` の `SLACK_USER_TOKEN` | 現在値の完全一致をメモリ内で確認。投稿キーとは異なる |
| Notion：kanazawa-obsidian integration | QA用GAS `NOTION_TOKEN`、obsidian-gmail-export GAS `NOTION_TOKEN`、主機 `~/notes-sync/.env` の `NOTION_TOKEN` | 3保存先すべて完全一致。取り込みGASはdailyRunトリガー1件、最終実行9/27 22:42:13を画面確認 |
| Notionの旧保存先 | GitHub sales-qa-bot `NOTION_TOKEN` | Secretは存在、最終更新6/6。GASの流用キーと同じかは読戻せないため不明。QA_CAPTURE_ENABLED=falseで記録停止中だがBot/backfillの環境変数には渡される |
| 旧Slack Verification Token | Sales QA Botの管理画面 | 現行QAリポジトリの実行コードに参照なし。旧GASも取得コードにVerification Token参照なし。別リポジトリの同名Gmail検証用キーとは別物 |

QA用GAS：[sales-qa-bot GAS移行準備](https://script.google.com/home/projects/1fsUWf8DstrkWgPj9u0UAa0819MOZtHGaUugaHkcCWTMT4CNQCLnXqm7Q/settings)

取り込みGAS：[obsidian-gmail-export](https://script.google.com/home/projects/1UQfOJlhnaseKz6DMPg3jBjTkbBag7dASd5YwvZUpmaR9km2R5tUFZqxP/settings)

## 混同しない保存先

- obsidian-gmail-export の `SLACK_TOKEN` は、現在のQA `SLACK_READ_TOKEN` と **不一致**。同じ取り込み系でも、同じ旧鍵として一括更新しない。発行元アプリ全体の再認可・失効操作が及ぼす影響は交換時に確認する。
- このMacのローカル設定で、HLS-projectとdirector-to-HLSのNotionキーは互いに一致するが、今回露出したNotionキーとは不一致。
- director-to-HLS / kstep / repitte-hotel-notifier / web-engagement-tool のローカルSlack設定は、QA側3キーとの一致なし。これはローカル値の比較であり各クラウド本番値の非共有証明ではない。
- `SLACK_APP_TOKEN`と`SLACK_SIGNING_SECRET`を露出対象と推定して交換しない。

## 1つの保存先を直したときに反映される範囲

| 保存先 | 参照先 |
|---|---|
| GitHub sales-qa-bot `SLACK_BOT_TOKEN` | bot.ymlの通常Bot・再起動失敗通知・本人DM試験、auth-refresh.ymlの通知、gas-monitor.ymlの通知、backfill.yml（記録処理は現在無効） |
| GitHub sales-qa-bot `NOTION_TOKEN` | bot.yml / backfill.yml。NotebookLM資料同期sync.ymlには参照なし |
| QA用GASの3プロパティ | Main.jsの記録/読取/通知、Operations.js監査、DuplicateViews.jsの整理・検証。トリガーごとに鍵を複製しているわけではない |
| notes-sync/.env `SLACK_USER_TOKEN` | slack_sync.py:52、weekly_post.py:76、daily_sync.py:79のKeychain失敗時フォールバック |
| notes-sync/.env `NOTION_TOKEN` | notion_common.py:8（notion_pull/push）、daily_sync.py:121のフォールバック |
| Mac Keychain `slack-user-token` | fetch.py:34、daily_sync.py:79 |
| Mac Keychain `notion-token-kanazawa-obsidian` / account `kanazawa-obsidian` | fetch.py:74,102、daily_sync.py:121。一般名`notion-token`ではない |

主機のキーチェーン3候補（上の2名と一般名notion-token）は今回の環境から取得できず、値の比較は不可。サブ機の保存状態も未検証。主機のlaunchd `com.cnctor.notes-sync` は毎時run_all.sh、環境上書きなし、コードのINGEST既定0。Notion pull/pushも実行対象外。旧取り込みを動かして確認していない。weekly_post等の手動利用先は保存先更新の対象に含める。

## 旧GASと他プロジェクト

[セールスQA-Notion 連携](https://script.google.com/home/projects/1-vBjIvK-h3WoeJHkvnt6W7oJ9FoIHPotaGN4WCIAPw9p494HLmlNZNQq/settings)は、現在のスクリプトプロパティに対象キー名がなく、本人所有トリガー0件。コードにはSLACK_BOT_TOKEN / SLACK_SIGNING_SECRET / NOTION_API_KEYの参照が残る。過去のデプロイ版や別オーナーのトリガーまで削除・失効済みとは断定しない。

ローカル26作業ルートの追跡ファイルを検索し、21ルート・402箇所で認証関連の名前を検出（設定説明・テスト外の補助資料等も含む。402個の鍵という意味ではない）。場所と行番号は `docs/evidence/credential-inventory-20260927/code-references.json`。18リポジトリのGitHub Secret名を読取確認し、結果は `github-secret-names.json`。同名Secretだけを理由に共有と判定しない。

追加の同名キー候補：CRM-SFA、HLS、director-to-HLS、lead-researcher、morning_research、notion-zoho-sync、notion-contact-audit-gas、web-engagement-tool、各Slack Bot。読み取れないGitHub Secrets、Vercel等の本番環境、アプリDB内の暗号化キー、他Mac、未調査の過去GAS版について、今回露出キーとの同値は未検証。共有が確認できた上表と、名前だけ一致する候補を分けて引き継ぐ。秘密値を取り出すためのworkflow作成・起動はしない。

## 交換時に本人と確認すること

1. 上表の発行元で対象キーを交換する。新旧併存できる方式なら新キーを用意し、上表の一致した保存先へ反映する。
2. GitHubの既存値は読戻せないので、共有先だと推定して無関係なSecretへ上書きしない。発行元・用途が一致するものだけ反映する。Notionの旧GitHub保存値は移行前の鍵との関係を確認する。
3. 主機/サブ機のKeychainと、読取不能な本番保存先は本人側の管理画面で照合する。これは今回の調査で同一と確定できなかった範囲。
4. 実疎通と正常Botの自然交代を確認してから旧鍵を失効する。交換操作が旧鍵を即失効させる仕様なら、正常Botを止めない条件との調整が必要。鍵をチャット・Git・Vaultへ貼らない。

調査中に鍵・コード・トリガー・Bot運転設定の変更、QA投稿、日次取り込み実行はしていない。
