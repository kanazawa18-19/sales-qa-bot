/* Slack Webアプリ直接受信（署名検証は省略・なりすまし許容は本人判断）。
   受信は即200でキュー（GAS_HTTP_QUEUE）へ積むだけ。回答生成はGitHub Actions経由でPythonへ委譲する。
   採否の最終判断はsrc/http_app/domain.pyのplan()。ここでのhttpRelevant_はGitHub起動を間引く目安に過ぎない。 */
var HTTP_QUEUE_REPO = 'kanazawa18-19/sales-qa-bot';
var HTTP_QUEUE_SHEET = 'GAS_HTTP_QUEUE';
function httpProps_() { return PropertiesService.getScriptProperties(); }
function httpBook_(id) { return SpreadsheetApp.openById(id); }
function httpQueueSheet_(book) {
  var s = book.getSheetByName(HTTP_QUEUE_SHEET);
  if (!s) throw new Error('HTTP_QUEUE_SHEET_MISSING');
  return s;
}
// 列: event_id/received_at/channel/user/ts/thread_ts/event_type/text/state/request_id/dispatched_at/run_id/resolved_at/note/team_id
// GAS_AI_JOURNAL等の既存内部シートに合わせ、ヘッダー行は置かない（1行目から実データ）。
var HTTP_QUEUE_COLUMNS = 15;
function httpRows_(s) {
  return s.getLastRow() ? s.getRange(1, 1, s.getLastRow(), HTTP_QUEUE_COLUMNS).getDisplayValues() : [];
}
function httpAppendRow_(s, values) {
  var n = s.getLastRow() + 1;
  s.getRange(n, 1, 1, values.length).setNumberFormat('@').setValues([values.map(function (v) { return String(v); })]);
  return n;
}
function httpSetCell_(s, row, col, value) {
  s.getRange(row, col).setNumberFormat('@').setValue(String(value));
}
function httpText_(event) {
  return (event.text || '').trim();
}
// 明確に無関係なものだけを間引く。チャンネル・メンションの最終判断はPython側domain.plan()に委ねる。
// 除外するsubtypeはsrc/http_app/domain.pyのplan()と同じ集合にそろえる（GAS側が過剰に間引いて
// Python側の判断機会を奪わないため）。
function httpRelevant_(botUser, event) {
  if (!event || typeof event !== 'object') return false;
  if (['message', 'app_mention'].indexOf(event.type) < 0) return false;
  if (event.user === botUser) return false;
  if (['message_changed', 'message_deleted', 'channel_join', 'channel_leave', 'message_replied'].indexOf(event.subtype || '') >= 0) return false;
  if (!httpText_(event)) return false;
  if (!event.ts || !event.channel) return false;
  return true;
}
function httpGitHub_(path, payload) {
  var token = httpProps_().getProperty('ACTIONS_CLOCK_TOKEN');
  if (!token) throw new Error('HTTP_TOKEN_REQUIRED');
  var options = {
    method: payload ? 'post' : 'get', muteHttpExceptions: true, followRedirects: false,
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
  };
  if (payload) { options.contentType = 'application/json'; options.payload = JSON.stringify(payload); }
  var response;
  try { response = UrlFetchApp.fetch('https://api.github.com/repos/' + HTTP_QUEUE_REPO + path, options); }
  catch (e) { throw new Error('HTTP_TRANSPORT_UNKNOWN'); }
  var code = response.getResponseCode();
  if (payload && code === 204) return {};
  if (code !== 200) throw new Error('HTTP_GITHUB_' + code);
  try { return JSON.parse(response.getContentText()); }
  catch (e) { throw new Error('HTTP_INVALID_RESPONSE'); }
}
function httpSlackHasReply_(token, botUser, channel, thread, sinceMs) {
  var url = 'https://slack.com/api/conversations.replies?' + ['channel=' + encodeURIComponent(channel), 'ts=' + encodeURIComponent(thread), 'limit=50'].join('&');
  var response;
  try { response = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true, followRedirects: false }); }
  catch (e) { throw new Error('HTTP_TRANSPORT_UNKNOWN'); }
  if (response.getResponseCode() !== 200) throw new Error('HTTP_SLACK_' + response.getResponseCode());
  var data;
  try { data = JSON.parse(response.getContentText()); } catch (e) { throw new Error('HTTP_INVALID_RESPONSE'); }
  if (!data.ok) throw new Error('HTTP_SLACK_' + String(data.error || 'FAILED').toUpperCase().replace(/[^A-Z0-9_]/g, ''));
  return (data.messages || []).some(function (m) {
    return m.user === botUser && Number(m.ts) * 1000 >= sinceMs;
  });
}
// Slackの署名は検証しない（本人判断：なりすまし許容）。event_idの重複だけ防ぐ。
function enqueueHttpEvent_(body) {
  var props = httpProps_(), spreadsheetId = props.getProperty('GOOGLE_SPREADSHEET_ID');
  if (!spreadsheetId) throw new Error('HTTP_CONFIG_SPREADSHEET_ID');
  var eventId = body.event_id || '';
  if (!eventId) throw new Error('HTTP_EVENT_ID_MISSING');
  var event = body.event || {};
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(2500)) throw new Error('HTTP_QUEUE_BUSY');
  try {
    var sheet = httpQueueSheet_(httpBook_(spreadsheetId)), rows = httpRows_(sheet);
    if (rows.some(function (r) { return r[0] === eventId; })) return; // Slack再送は同じevent_id
    var relevant = httpRelevant_(props.getProperty('BOT_USER_ID') || '', event);
    httpAppendRow_(sheet, [
      eventId, new Date().toISOString(), event.channel || '', event.user || '', event.ts || '',
      event.thread_ts || event.ts || '', event.type || '', httpText_(event),
      relevant ? 'queued' : 'skip', '', '', '', '', '', body.team_id || ''
    ]);
  } finally { lock.releaseLock(); }
}
// 実機確認済み（2026-09-28）：GAS Webアプリはスクリプト内で例外が起きてもHTTPステータスは常に200を返す。
// 「例外を投げれば非200になりSlackが再送する」は成立しない。したがって内部障害はここで必ず捕まえ、
// 本人へ通知したうえで200を返す（Slackへは失敗を伝える手段がなく、再送にも頼れない）。
function doPost(e) {
  var body;
  try { body = JSON.parse((e.postData || {}).contents || '{}'); }
  catch (err) { return ContentService.createTextOutput(''); }
  if (body.type === 'url_verification') {
    return ContentService.createTextOutput(JSON.stringify({ challenge: body.challenge })).setMimeType(ContentService.MimeType.JSON);
  }
  if (body.type !== 'event_callback') return ContentService.createTextOutput('');
  try { enqueueHttpEvent_(body); }
  catch (err) {
    httpProps_().setProperty('HTTP_LAST_ENQUEUE_ERROR', (err.message || 'UNKNOWN') + ' ' + new Date().toISOString());
    httpNotice_('受信エラー', '直接受信の取り込みに失敗し、この1件は保存できていません。\n' + (err.message || 'UNKNOWN') + '\nevent_id=' + (body.event_id || ''));
  }
  return ContentService.createTextOutput('');
}
function httpDispatchRow_(row, index, sheet) {
  var requestId = Utilities.getUuid();
  var payload = {
    ref: 'slack-http', inputs: {
      request_id: requestId, event_id: row[0], channel: row[2], user: row[3], ts: row[4],
      thread_ts: row[5], event_type: row[6], text: row[7], team_id: row[14]
    }
  };
  // 送信前に'dispatched'とrequestIdを確定させる。結果不明（5xx/429/transport等）でも
  // 'queued'へは戻さない。戻すと次周期に新しいrequestIdで再dispatchされ、
  // 実際には受理されていた場合に二重回答を招く（gas/Main.jsのPOSTINGパターンと同じ考え方）。
  httpSetCell_(sheet, index + 1, 10, requestId);
  httpSetCell_(sheet, index + 1, 9, 'dispatched');
  httpSetCell_(sheet, index + 1, 11, new Date().toISOString());
  try { httpGitHub_('/actions/workflows/answer.yml/dispatches', payload); }
  catch (e) {
    if (/^HTTP_GITHUB_(401|403|404|422|429)$/.test(e.message || '')) {
      httpSetCell_(sheet, index + 1, 9, 'rejected');
      httpSetCell_(sheet, index + 1, 14, e.message);
    }
    // それ以外は'dispatched'のまま残す。次周期のhttpResolveRow_が履歴照合とタイムアウトで判断する。
  }
}
function httpNotice_(subject, detail) {
  var email = httpProps_().getProperty('HEALTH_EMAIL');
  if (!email) return;
  MailApp.sendEmail(email, 'Sales QA Bot：GAS直接受信 ' + subject, detail);
}
function httpResolveRow_(row, index, sheet, props) {
  var requestId = row[9];
  if (!requestId) return;
  // GitHubの履歴取得自体が失敗し続けても黙って滞留させない。runが見つからないのと同じ扱いにして
  // 下のstale判定・通知へ進む（実返信の確認はこの取得結果に依存しないため独立して機能する）。
  var history = null;
  try { history = httpGitHub_('/actions/workflows/answer.yml/runs?per_page=50').workflow_runs; }
  catch (e) { history = null; }
  var run = Array.isArray(history) ? history.find(function (r) { return (r.display_title || '').indexOf(requestId) >= 0; }) : undefined;
  var dispatchedAt = Date.parse(row[10]);
  var botUser = props.getProperty('BOT_USER_ID') || '', token = props.getProperty('SLACK_READ_TOKEN');
  if (token && botUser) {
    var hasReply;
    try { hasReply = httpSlackHasReply_(token, botUser, row[2], row[5], dispatchedAt); }
    catch (e) { hasReply = null; }
    if (hasReply) {
      httpSetCell_(sheet, index + 1, 9, 'done');
      httpSetCell_(sheet, index + 1, 12, run ? String(run.id) : '');
      httpSetCell_(sheet, index + 1, 13, new Date().toISOString());
      return;
    }
  }
  var runDone = run && run.status === 'completed';
  // 10分＝GitHub Actions側のスケジューリング遅延・履歴反映遅延を見込んだ猶予（actions-clock運用実績を参考）。
  var runStale = !run && Date.now() - dispatchedAt > 600000;
  // 2分＝run完了後、Slack投稿とconversations.repliesへの反映が追いつくまでの猶予。
  var replyGraceOver = runDone && Date.now() - Date.parse(run.updated_at) > 120000;
  if (runStale || replyGraceOver) {
    httpSetCell_(sheet, index + 1, 9, 'uncertain');
    httpSetCell_(sheet, index + 1, 12, run ? String(run.id) : '');
    httpSetCell_(sheet, index + 1, 13, new Date().toISOString());
    httpSetCell_(sheet, index + 1, 14, run ? run.conclusion || 'no_run_found' : 'no_run_found');
    httpNotice_('要確認', '返信を確認できない処理があります。自動再送していません。\nrequest_id=' + requestId + ' channel=' + row[2] + ' thread=' + row[5]);
  }
}
function tickHttpQueue() {
  var props = httpProps_();
  if (props.getProperty('HTTP_QUEUE_ENABLED') !== 'true') return { state: 'disabled' };
  var spreadsheetId = props.getProperty('GOOGLE_SPREADSHEET_ID');
  if (!spreadsheetId) throw new Error('HTTP_CONFIG_SPREADSHEET_ID');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return { state: 'busy' };
  try {
    var sheet = httpQueueSheet_(httpBook_(spreadsheetId)), rows = httpRows_(sheet);
    var dispatched = 0, resolved = 0;
    // 1周期あたりの上限（5件dispatch・10件resolve）はGitHub APIレート制限とGAS実行時間を
    // 使い切らないための目安。低頻度利用を前提にした暫定値で、実測に応じて見直す。
    for (var i = 0; i < rows.length && dispatched < 5; i++) {
      if (rows[i][8] === 'queued') { httpDispatchRow_(rows[i], i, sheet); dispatched++; }
    }
    var afterDispatch = httpRows_(sheet);
    for (var j = 0; j < afterDispatch.length && resolved < 10; j++) {
      if (afterDispatch[j][8] === 'dispatched') { httpResolveRow_(afterDispatch[j], j, sheet, props); resolved++; }
    }
    return { state: 'ok', dispatched: dispatched, resolved: resolved };
  } finally { lock.releaseLock(); }
}
function prepareHttpQueue() {
  var props = httpProps_();
  if (props.getProperty('HTTP_QUEUE_ENABLED') === 'true') throw new Error('HTTP_DISABLE_FIRST');
  var spreadsheetId = props.getProperty('GOOGLE_SPREADSHEET_ID');
  if (!spreadsheetId) throw new Error('HTTP_CONFIG_SPREADSHEET_ID');
  var book = httpBook_(spreadsheetId);
  if (!book.getSheetByName(HTTP_QUEUE_SHEET)) book.insertSheet(HTTP_QUEUE_SHEET);
}
function installHttpQueue() {
  var props = httpProps_();
  if (props.getProperty('HTTP_QUEUE_ENABLED') !== 'true') throw new Error('HTTP_ENABLE_FIRST');
  if (!props.getProperty('ACTIONS_CLOCK_TOKEN')) throw new Error('HTTP_TOKEN_REQUIRED');
  if (!ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'tickHttpQueue'; })) {
    ScriptApp.newTrigger('tickHttpQueue').timeBased().everyMinutes(1).create();
  }
}
function stopHttpQueue() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error('HTTP_BUSY_RETRY_STOP');
  try {
    httpProps_().setProperty('HTTP_QUEUE_ENABLED', 'false');
    ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'tickHttpQueue'; })
      .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  } finally { lock.releaseLock(); }
}
function healthHttpQueue() {
  var props = httpProps_(), spreadsheetId = props.getProperty('GOOGLE_SPREADSHEET_ID');
  var rows = spreadsheetId && httpBook_(spreadsheetId).getSheetByName(HTTP_QUEUE_SHEET) ? httpRows_(httpQueueSheet_(httpBook_(spreadsheetId))) : [];
  var byState = {};
  rows.forEach(function (r) { byState[r[8]] = (byState[r[8]] || 0) + 1; });
  var result = {
    enabled: props.getProperty('HTTP_QUEUE_ENABLED') === 'true',
    tokenConfigured: !!props.getProperty('ACTIONS_CLOCK_TOKEN'),
    triggerCount: ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'tickHttpQueue'; }).length,
    total: rows.length, byState: byState
  };
  console.log(JSON.stringify(result));
  return result;
}
