# Claude Opus 5.5（中）レビュー原文

会話: https://claude.ai/chat/026a9830-edd7-4c6d-adc8-6bdb554053ef

Claudeが返答しました: 前提として、実API・本番は未検証とのことなので、コードと架空テストから読み取れる範囲で、本体実装の不具合を優先して挙げます。
ウェブを検索しました

ウェブを検索しました

前提として、実API・本番は未検証とのことなので、コードと架空テストから読み取れる範囲で、本体実装の不具合を優先して挙げます。

BLOCKER（3件）

ID	箇所	問題と再現条件	最小修正案
B1	Core.step / io.replies	保存済みの s.parents にある親が、replies取得前に削除されると復旧しません。返信なしで削除された場合、Slackは thread_not_found を返すため SLACK_THREAD_NOT_FOUND が毎回発生し、同じ位置で再試行が続きます。過去laneでは親一覧が数時間保持されるので、起きやすい条件です。新着laneで起きた場合は、forEach内でthrowするため過去laneも実行されず、全体が停止します。削除済みの親が返信付きで残る tombstone は除外リストに入っておらず、AIチャンネルでは「削除済み」本文が回答対象になり得ます。	io.repliesで thread_not_found / message_not_found を捕捉し、{skip:true} を返します。stepでは s.thread=null; s.index++ として次へ進めます。あわせて、historyフィルタとcandidateの除外subtypeに tombstone を追加します。
B2	pollSalesQa（deep, oldest='0'）→ sync_	過去laneは全履歴を毎周走査し、QAチャンネルの全スレッドを無条件に sync_ します。周回ごとにsnapshotが新しくなるため、鮮度チェックでもスキップされません。本番切替後の初回周で次のことが起きます。(1) AI_START_TS以前の既存行でもA/D/F/Jが現在のSlack内容で上書きされ、削除済みの回答やPython版の整形は巻き戻ります。(2) Notionの タイムスタンプ 表記が旧版と一致しない場合、全件が新規作成され重複します。(3) 以後も毎周、全ページをPATCHするため、Notionで手修正したサービス名や回答者も上書きされます。	親を段階的に絞り込みます。条件は max(ts, latest_reply) >= floor（historyの応答に latest_reply が含まれます）。floorは、初回が AI_START_TS、以降は max(AI_START_TS, 前回CYCLE_THROUGH_TS − 600) とします。これでreplies呼出と同期の量も大幅に減ります。
B3	aiText_ / answer_	利用者の通常の投稿で、恒久的に停止します。(a) 4.5MBを超えるPNGスクリーンショット、size欠落、削除済みファイルでは IMAGE_UNSUPPORTED / IMAGE_FETCH_FAILED が毎回発生します。(b) 回答が1,024トークンを超えると AI_INCOMPLETE になります。PREPAREDを保存する前にthrowするため、5分ごとに再生成して課金が続きます。(c) AI_EMPTY も同じ扱いです。どれも該当スレッドより先へ進めず、QAチャンネルがchannels[0]にあるため、以降の全チャンネルが止まります。手動でスキップする手順もありません。	画像は、条件外のものを未読枚数に加えるだけにして、throwしません。AI失敗時はJOURNALに FAILED を記録します。answer_は FAILED / SKIP をSENTと同様に扱ってreturnし、通知メールを送ります。手順書には、人が SKIP を入れる操作を追記します。

WARN（8件）

ID	箇所	問題と再現条件	最小修正案
W1	answer_ catch	postMessageが ok:false（not_in_channel、invalid_auth、channel_not_found など）やHTTP 4xxを返した場合、未投稿が確定しているのにPOSTINGのまま残り、手動照合が必要になります。bot tokenの設定ミスでも全停止します。	NETWORK_UNCERTAIN、HTTP_5xx、INVALID_JSON の場合だけPOSTINGを残します。それ以外はPREPAREDに戻してthrowします。
W2	answer_ 読戻し	postMessageが ok:true とtsを返した後に、replies読戻しが429や反映遅延で失敗すると、POSTING→SLACK_POST_RECONCILE となり手動照合になります。投稿は確定しているので不要な保留です。	D列にtsを保存できた時点でSENTにします。検証を残す場合は、「POSTINGかつD列あり」なら次回は読戻しだけ再試行するようにします。
W3	sync_ Notion作成	NOTION_CREATE_PENDING を、POST前に無条件で設定しています。Notionの429や400（未処理が確定している）でも保留になります。キーが全体で1つなので、以後の新規作成はすべて NOTION_CREATE_RECONCILE で止まり、B3と同じ理由でAI回答も全停止します。	Notion POSTの失敗が RATE_LIMITED やHTTP 4xxなら、pendingを削除してからthrowします。可能なら、pendingを全体キーではなくGAS_SYNC_STATEのE列にスレッド単位で持たせます。
W4	pollSalesQa catch	RATE_LIMITED をfatal扱いにしているため、エラーメールとGAS失敗通知が出ます。また RETRY_AT がAPI・lane共通なので、過去laneのNotion 429でも新着laneのSlack回答まで最大5分以上遅れます。	RATE_LIMITED は status='deferred' とし、fatalにしません。余力があれば、RETRY_ATをホスト別（slack/notion/anthropic）に分けます。
W5	io.history / io.replies limit:15	Slackの1分1回・15件制限は、Marketplace外で商用配布されるアプリだけが対象です。社内で作ったアプリは影響を受けず、Tier 3（毎分50回以上）・1リクエスト最大1,000件のままです（Slack公式FAQ、https://api.slack.com/changelog/2025-05-terms-rate-limit-update-and-faq）。社内アプリで15件に固定すると、呼出回数と周回時間、UrlFetch枠の消費が不必要に増えます。逆に配布アプリ扱いなら、この設計自体が成り立ちません。	アプリ種別を確認し、社内アプリならhistory/repliesを limit:200 にします。
W6	Core.step historyフィルタ	親の除外が channel_join / channel_leave だけです。QAチャンネルの channel_topic、channel_purpose、pinned_item、一般botの投稿なども、parseのフォールバックで質問扱いになり、Sheets/Notionの行になります。	QA同期の対象判定にも、candidateと同等のsubtype・bot除外（Workflowのallowlistは維持）を適用します。
W7	dryRunSalesQa	巡回ロジックを一切通らないため、切替前に「何件同期され、どのtsに回答するか」が分かりません（B2の事前検知ができません）。bot tokenとBOT_USER_IDも未検証で、誤りはW1経由の全停止として初回に表面化します。	bot tokenで auth.test を呼び、user_id === BOT_USER_ID を確認します。あわせて、sync/answerを記録するだけのioでstepを時間枠内だけ回し（STATEは保存しない）、予定件数とtsを出力します。
W8	pollSalesQa lane構成	新着laneで恒常エラーが出ると、同じ実行内の過去laneは毎回実行されません。新着と過去の相互干渉です。	lane単位でtry/catchし、RATE_LIMITED 以外は次のlaneへ進みます。エラーは最後にまとめてthrowします。

INFO

ID	内容	対応
I1	新着laneの読込範囲は「前回到達時刻−10分」です。そのため、親投稿から10分を超えたスレッド内のメンションはすべて全周待ちになります。「古い親」の実際の閾値は10分です。	既知制約の説明に、この閾値を明記します。
I2	answer_で existing を検出し、既存行があるときにD列（返信ts）を記録していません。	rawCell_(journal, i+1, 4, existing.ts) を追加します。
I3	client_msg_id を毎回新しく生成しているため、重複防止には効きません。	誤解を避けるためのコメントを入れるか、削除します。
I4	slice(0, 2000) がサロゲートペアを分断すると、Notionの読戻しが不一致になり、恒久的に NOTION_VERIFY_FAILED となる可能性があります。	Array.from(s).slice(0, 2000).join('') で切り詰めます。
I5	Sheetsの行照合 indexOf('/p' + ts) は部分一致です。	末尾を境界にした正規表現で一致判定します。
I6	返信メンションで、親の質問本文がAIに渡りません。	Python版と同じ挙動か確認します。
I7	チャンネル構成を変えると s.channel のインデックスがずれます。	手順書に「構成変更時はSTATEを削除」と追記します。
I8	テストの不足：B1〜B3、W1〜W3の再現ケースがありません。	上記の修正と一緒に追加します。

優先順位としては、B1〜B3を修正し、W7の拡張dry-runで同期予定件数を確認してから、テスト環境の手順5に進むのが安全です。
