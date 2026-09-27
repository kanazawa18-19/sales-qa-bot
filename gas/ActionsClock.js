// 追加GCPを使わない時計。認証情報の更新は既存auth-refreshだけが担当する。
var ACTIONS_CLOCK_REPO = 'kanazawa18-19/sales-qa-bot';
function actionsClockProps_() { return PropertiesService.getScriptProperties(); }
function actionsClockGitHub_(path, payload) {
  var token = actionsClockProps_().getProperty('ACTIONS_CLOCK_TOKEN');
  if (!token) throw new Error('CLOCK_TOKEN_REQUIRED');
  var options = {method: payload ? 'post' : 'get', muteHttpExceptions: true,
    followRedirects: false, headers: {Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'}};
  if (payload) { options.contentType = 'application/json'; options.payload = JSON.stringify(payload); }
  var response;
  try { response = UrlFetchApp.fetch('https://api.github.com/repos/' + ACTIONS_CLOCK_REPO + path, options); }
  catch (e) { throw new Error('CLOCK_TRANSPORT_UNKNOWN'); }
  var code = response.getResponseCode();
  if (payload && code === 204) return {};
  if (code !== 200) throw new Error('CLOCK_GITHUB_' + code);
  try { return JSON.parse(response.getContentText()); }
  catch (e) { throw new Error('CLOCK_INVALID_RESPONSE'); }
}
function actionsClockRuns_(workflow) {
  // 未完了を独立に取得。履歴の先頭100件から消えた長時間実行も見逃さない。
  var result = [];
  ['queued', 'in_progress', 'waiting', 'pending', 'requested'].forEach(function(status) {
    var data = actionsClockGitHub_('/actions/workflows/' + workflow + '/runs?per_page=100&status=' + status);
    if (!Array.isArray(data.workflow_runs) || data.total_count > 100) throw new Error('CLOCK_RUN_LIST_UNCERTAIN');
    result = result.concat(data.workflow_runs);
  });
  return result;
}
function actionsClockDispatch_(workflow, payload, key) {
  var props = actionsClockProps_();
  // 応答が失われても再送しない。読戻しで成否が確定するまで要求を保持する。
  var record = {requestedAt: new Date().toISOString(), state: 'unknown', workflow: workflow, requestId: Utilities.getUuid()};
  payload.inputs = payload.inputs || {};
  payload.inputs.clock_request_id = record.requestId;
  props.setProperty(key, JSON.stringify(record));
  var response;
  try { response = actionsClockGitHub_('/actions/workflows/' + workflow + '/dispatches', payload); }
  catch (e) {
    if (/^CLOCK_GITHUB_(401|403|404|422|429)$/.test(e.message || '')) {
      record.state = 'rejected'; record.code = e.message;
      props.setProperty(key, JSON.stringify(record));
    }
    throw e;
  }
  record.state = 'accepted';
  if (response.workflow_run_id) record.runId = response.workflow_run_id;
  props.setProperty(key, JSON.stringify(record));
  return record;
}
function actionsClockNotice_(health) {
  var props = actionsClockProps_(), email = props.getProperty('HEALTH_EMAIL');
  if (!email) throw new Error('CLOCK_HEALTH_EMAIL_REQUIRED');
  var tag = health.ok ? 'ok-' + new Date().toISOString().slice(0, 10) : 'failed-' + new Date().toISOString().slice(0, 10) + '-' + (health.code || 'stale');
  var lastAt = Number(props.getProperty('ACTIONS_CLOCK_NOTICE_AT') || 0);
  if (props.getProperty('ACTIONS_CLOCK_NOTICE') !== tag && Date.now() - lastAt >= 3600000) {
    MailApp.sendEmail(email, 'Sales QA Bot：GAS時計 ' + (health.ok ? '稼働報告' : '要確認'), '認証更新・Bot実行状態・保留要求を確認してください。実回答の成功確認とは別です。\n' + JSON.stringify(health));
    props.setProperty('ACTIONS_CLOCK_NOTICE', tag);
    props.setProperty('ACTIONS_CLOCK_NOTICE_AT', String(Date.now()));
  }
}
function tickActionsClock() {
  var props = actionsClockProps_();
  if (props.getProperty('ACTIONS_CLOCK_ENABLED') !== 'true') return {state: 'disabled'};
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return {state: 'busy'};
  var health = {ok: false, checkedAt: new Date().toISOString()};
  try {
    if (props.getProperty('ACTIONS_CLOCK_ENABLED') !== 'true') return {state: 'disabled'};
    if (props.getProperty('ACTIONS_CLOCK_MIGRATION_ACK') !== 'true') throw new Error('CLOCK_MIGRATION_REQUIRED');
    if (!props.getProperty('HEALTH_EMAIL')) throw new Error('CLOCK_HEALTH_EMAIL_REQUIRED');
    var runs = actionsClockRuns_('auth-refresh.yml');
    var history = actionsClockGitHub_('/actions/workflows/auth-refresh.yml/runs?branch=main&per_page=100').workflow_runs;
    if (!Array.isArray(history)) throw new Error('CLOCK_RUN_LIST_UNCERTAIN');
    var success = history.find(function(r) {return r.status === 'completed' && r.conclusion === 'success';});
    health.lastAuthSuccess = success ? success.updated_at : null;
    var pending = JSON.parse(props.getProperty('ACTIONS_CLOCK_AUTH_REQUEST') || 'null');
    if (pending && history.some(function(r) {return r.display_title === 'GAS認証更新 ' + pending.requestId;})) {
      props.deleteProperty('ACTIONS_CLOCK_AUTH_REQUEST'); pending = null;
    }
    if (!runs.length && !pending) {
      pending = actionsClockDispatch_('auth-refresh.yml', {ref: 'main'}, 'ACTIONS_CLOCK_AUTH_REQUEST');
      health.dispatched = true;
    }
    health.botActive = actionsClockRuns_('bot.yml').some(function(r) {return r.head_branch === 'main' && r.status === 'in_progress';});
    // 常駐Botを自動再起動しない。復旧は既存自己再起動とGitHub側の保険に委ねる。
    health.pendingAuthRequest = pending;
    if (pending && Date.now() - Date.parse(pending.requestedAt) >= 600000) health.code = 'CLOCK_REQUEST_UNCONFIRMED';
    else if (!health.botActive) health.code = 'CLOCK_BOT_NOT_RUNNING';
    else if (!success || Date.now() - Date.parse(success.updated_at) >= 1800000) health.code = 'CLOCK_AUTH_STALE';
    health.ok = health.botActive && !!success && Date.now() - Date.parse(success.updated_at) < 1800000 &&
      (!pending || Date.now() - Date.parse(pending.requestedAt) < 600000);
  } catch (e) {
    health.code = /^CLOCK_[A-Z_0-9]+$/.test(e.message || '') ? e.message : 'CLOCK_CHECK_FAILED';
  } finally { lock.releaseLock(); }
  health.pendingAuthRequest = JSON.parse(props.getProperty('ACTIONS_CLOCK_AUTH_REQUEST') || 'null');
  health.elapsedMs = Date.now() - Date.parse(health.checkedAt);
  props.setProperty('ACTIONS_CLOCK_HEALTH', JSON.stringify(health));
  actionsClockNotice_(health);
  console.log(JSON.stringify(health));
  return health;
}
function installActionsClock() {
  var props = actionsClockProps_();
  if (props.getProperty('ACTIONS_CLOCK_ENABLED') !== 'true' ||
      props.getProperty('ACTIONS_CLOCK_MIGRATION_ACK') !== 'true') throw new Error('CLOCK_MIGRATION_REQUIRED');
  if (!props.getProperty('ACTIONS_CLOCK_TOKEN') || !props.getProperty('HEALTH_EMAIL')) throw new Error('CLOCK_CONFIG_REQUIRED');
  if (!ScriptApp.getProjectTriggers().some(function(t) {return t.getHandlerFunction() === 'tickActionsClock';})) {
    ScriptApp.newTrigger('tickActionsClock').timeBased().everyMinutes(5).create();
  }
}
function stopActionsClock() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error('CLOCK_BUSY_RETRY_STOP');
  try {
    actionsClockProps_().setProperty('ACTIONS_CLOCK_ENABLED', 'false');
    ScriptApp.getProjectTriggers().filter(function(t) {return t.getHandlerFunction() === 'tickActionsClock';})
      .forEach(function(t) {ScriptApp.deleteTrigger(t);});
  } finally {lock.releaseLock();}
}
function healthActionsClock() {
  var p = actionsClockProps_();
  var result = {enabled: p.getProperty('ACTIONS_CLOCK_ENABLED') === 'true',
    migrationAck: p.getProperty('ACTIONS_CLOCK_MIGRATION_ACK') === 'true',
    tokenConfigured: !!p.getProperty('ACTIONS_CLOCK_TOKEN'),
    triggerCount: ScriptApp.getProjectTriggers().filter(function(t) {return t.getHandlerFunction() === 'tickActionsClock';}).length,
    health: JSON.parse(p.getProperty('ACTIONS_CLOCK_HEALTH') || 'null'),
    pendingAuthRequest: JSON.parse(p.getProperty('ACTIONS_CLOCK_AUTH_REQUEST') || 'null'),
    smoke: JSON.parse(p.getProperty('ACTIONS_CLOCK_SMOKE_REQUEST') || 'null')};
  console.log(JSON.stringify(result)); return result;
}
function runActionsClockOwnerSmoke() {
  var props = actionsClockProps_(), lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error('CLOCK_BUSY');
  try {
    if (props.getProperty('ACTIONS_CLOCK_ENABLED') === 'true') throw new Error('CLOCK_STOP_BEFORE_TEST');
    if (props.getProperty('ACTIONS_CLOCK_SMOKE_REQUEST')) throw new Error('CLOCK_SMOKE_ALREADY_REQUESTED');
    if (!props.getProperty('ACTIONS_CLOCK_TOKEN')) throw new Error('CLOCK_TOKEN_REQUIRED');
    var record = actionsClockDispatch_('bot.yml', {ref: 'slack-http', inputs: {owner_dm_smoke: true}}, 'ACTIONS_CLOCK_SMOKE_REQUEST');
    console.log(JSON.stringify(record)); return record;
  } finally {lock.releaseLock();}
}
