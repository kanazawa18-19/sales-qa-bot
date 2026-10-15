// 追加GCPを使わない時計。認証情報の更新は既存auth-refreshだけが担当する。
var ACTIONS_CLOCK_REPO = 'kanazawa18-19/sales-qa-bot';
function actionsClockProps_() { return PropertiesService.getScriptProperties(); }
function actionsClockGitHub_(path, payload) {
  var token = actionsClockProps_().getProperty('ACTIONS_CLOCK_TOKEN');
  if (!token) throw new Error('CLOCK_TOKEN_REQUIRED');
  var options = {method: payload ? 'post' : 'get', muteHttpExceptions: true,
    followRedirects: false, headers: {Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Cache-Control': 'no-cache'}};
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
    var data = actionsClockGitHub_('/actions/workflows/' + workflow + '/runs?branch=main&per_page=100&status=' + status);
    if (!Number.isInteger(data.total_count) || data.total_count < 0 || data.total_count > 100 ||
        !Array.isArray(data.workflow_runs) || data.workflow_runs.length !== data.total_count) {
      throw new Error('CLOCK_RUN_LIST_UNCERTAIN');
    }
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
// 完全な一覧と10分の猶予を揃えた要求だけを再試行可能にする。
function actionsClockReconcile_(workflow, key, title, active) {
  var props = actionsClockProps_(), pending = JSON.parse(props.getProperty(key) || 'null');
  if (!pending) return null;
  if (!pending.requestId || !isFinite(Date.parse(pending.requestedAt))) throw new Error('CLOCK_REQUEST_INVALID');
  var since = new Date(Date.parse(pending.requestedAt) - 60000).toISOString();
  var data = actionsClockGitHub_('/actions/workflows/' + workflow + '/runs?branch=main&event=workflow_dispatch&created=' + encodeURIComponent('>=' + since) + '&per_page=100');
  if (!Array.isArray(data.workflow_runs)) throw new Error('CLOCK_RUN_LIST_UNCERTAIN');
  var matched = data.workflow_runs.some(function(r) {return r.display_title === title + pending.requestId;});
  var complete = Number.isInteger(data.total_count) && data.total_count >= 0 && data.total_count <= 100 && data.workflow_runs.length === data.total_count;
  if (matched || (complete && !active.length && Date.now() - Date.parse(pending.requestedAt) >= 600000)) {
    props.deleteProperty(key); return null;
  }
  return pending;
}
function actionsClockPeriodic_(workflow, key, title, interval, inputs) {
  var props = actionsClockProps_();
  var pending = JSON.parse(props.getProperty(key) || 'null');
  var due = Date.now() - Number(props.getProperty(key + '_AT') || 0) >= interval;
  var active = pending || due ? actionsClockRuns_(workflow) : [];
  if (!props.getProperty(key + '_FIRST_AT')) props.setProperty(key + '_FIRST_AT', new Date().toISOString());
  if (pending) pending = actionsClockReconcile_(workflow, key, title, active);
  if (!pending && !active.length && due) {
    pending = actionsClockDispatch_(workflow, {ref:'main', inputs:inputs || {}}, key);
    props.setProperty(key + '_AT', String(Date.parse(pending.requestedAt)));
  }
  var successes = actionsClockGitHub_('/actions/workflows/' + workflow + '/runs?branch=main&status=success&per_page=1').workflow_runs;
  if (!Array.isArray(successes)) throw new Error('CLOCK_RUN_LIST_UNCERTAIN');
  var success = successes.find(function(r) {return r.status === 'completed' && r.conclusion === 'success';});
  return {firstRequestedAt:props.getProperty(key + '_FIRST_AT'), lastSuccess:success ? success.updated_at : null, lastCompleted:success ? success.updated_at : null,
    pendingSince:pending ? pending.requestedAt : null, pendingState:pending ? pending.state : null};
}
function actionsClockPeriodicFresh_(state, maxAge) {
  var age = Date.now() - Date.parse(state.lastSuccess || state.firstRequestedAt);
  var pendingAge = state.pendingSince ? Date.now() - Date.parse(state.pendingSince) : 0;
  return isFinite(age) && age >= -60000 && age <= maxAge && isFinite(pendingAge) && pendingAge <= maxAge;
}

function actionsClockNotice_(health) {
  var props = actionsClockProps_(), email = props.getProperty('HEALTH_EMAIL');
  if (!email) throw new Error('CLOCK_HEALTH_EMAIL_REQUIRED');
  var tag = health.ok ? 'ok-' + new Date().toISOString().slice(0, 10) : 'failed-' + new Date().toISOString().slice(0, 10) + '-' + (health.code || 'stale');
  var lastAt = Number(props.getProperty('ACTIONS_CLOCK_NOTICE_AT') || 0);
  if (props.getProperty('ACTIONS_CLOCK_NOTICE') !== tag && Date.now() - lastAt >= 3600000) {
    var reasons = {CLOCK_REQUEST_UNCONFIRMED: '認証更新の起動要求を10分以上照合できていません。',
      CLOCK_RECOVERY_UNCONFIRMED: '停止確認の起動要求を10分以上照合できていません。',
      CLOCK_MONITOR_STALE: '外部監視の完了または保留要求が75分以上停滞しています。',
      CLOCK_SYNC_STALE: '資料更新の成功または保留要求が8時間以上停滞しています。',
      CLOCK_BOT_NOT_RUNNING: '稼働中のBotを確認できません。待機中・復旧要求中の可能性もあります。',
      CLOCK_AUTH_STALE: '認証更新の最終成功から30分以上経過したか、成功を確認できません。'};
    var message = health.ok ? '認証更新の鮮度とBot稼働を確認しました。' :
      (reasons[health.code] || 'GAS時計の確認に失敗しました。理由：' + (health.code || '不明'));
    message += '\nActions履歴：https://github.com/' + ACTIONS_CLOCK_REPO + '/actions';
    message += '\n保留要求は照合IDとActions履歴を確認してから解除してください。未確認のまま消すと起動を重複させる恐れがあります。';
    message += '\nこの確認はSlack実回答の成功確認とは別です。\n' + JSON.stringify(health);
    MailApp.sendEmail(email, 'Sales QA Bot：GAS時計 ' + (health.ok ? '稼働報告' : '要確認'), message);
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
    // 成功確認と要求照合を全履歴から分ける。古い一覧応答で成功を見失わない。
    var successes = actionsClockGitHub_('/actions/workflows/auth-refresh.yml/runs?branch=main&status=success&per_page=1').workflow_runs;
    if (!Array.isArray(successes)) throw new Error('CLOCK_RUN_LIST_UNCERTAIN');
    var success = successes.find(function(r) {return r.status === 'completed' && r.conclusion === 'success';});
    health.lastAuthSuccess = success ? success.updated_at : null;
    health.lastAuthRunId = success ? success.id : null;
    var pending = actionsClockReconcile_('auth-refresh.yml', 'ACTIONS_CLOCK_AUTH_REQUEST', 'GAS認証更新 ', runs);
    if (!runs.length && !pending) {
      pending = actionsClockDispatch_('auth-refresh.yml', {ref: 'main'}, 'ACTIONS_CLOCK_AUTH_REQUEST');
      health.dispatched = true;
    }
    var botRuns = actionsClockRuns_('bot.yml');
    health.botActive = botRuns.some(function(r) {return r.head_branch === 'main' && r.status === 'in_progress';});
    var recovery = actionsClockReconcile_('bot-watchdog.yml', 'ACTIONS_CLOCK_RECOVERY_REQUEST', 'GAS停止確認 ', actionsClockRuns_('bot-watchdog.yml'));
    // 待機runもあれば触らない。復旧直前の再確認と実行枠の制御は既存watchdogが担当する。
    if (!botRuns.length && !recovery && !actionsClockRuns_('bot-watchdog.yml').length) {
      recovery = actionsClockDispatch_('bot-watchdog.yml', {ref: 'main'}, 'ACTIONS_CLOCK_RECOVERY_REQUEST');
      health.recoveryDispatched = true;
    }
    health.monitor = actionsClockPeriodic_('gas-monitor.yml', 'ACTIONS_CLOCK_MONITOR_REQUEST', 'GAS外部監視 ', 1800000, {notify:'true'});
    health.sync = actionsClockPeriodic_('sync.yml', 'ACTIONS_CLOCK_SYNC_REQUEST', 'GAS資料更新 ', 21600000);
    health.pendingRecoveryRequest = recovery;
    health.pendingAuthRequest = pending;
    if (recovery && Date.now() - Date.parse(recovery.requestedAt) >= 600000) health.code = 'CLOCK_RECOVERY_UNCONFIRMED';
    else if (pending && Date.now() - Date.parse(pending.requestedAt) >= 600000) health.code = 'CLOCK_REQUEST_UNCONFIRMED';
    else if (!health.botActive) health.code = 'CLOCK_BOT_NOT_RUNNING';
    else if (!success || Date.now() - Date.parse(success.updated_at) >= 1800000) health.code = 'CLOCK_AUTH_STALE';
    if (!health.code && !actionsClockPeriodicFresh_(health.monitor, 4500000)) health.code = 'CLOCK_MONITOR_STALE';
    if (!health.code && !actionsClockPeriodicFresh_(health.sync, 28800000)) health.code = 'CLOCK_SYNC_STALE';
    health.ok = !health.code && health.botActive && !!success && Date.now() - Date.parse(success.updated_at) < 1800000 &&
      (!pending || Date.now() - Date.parse(pending.requestedAt) < 600000) &&
      (!recovery || Date.now() - Date.parse(recovery.requestedAt) < 600000);
  } catch (e) {
    health.code = /^CLOCK_[A-Z_0-9]+$/.test(e.message || '') ? e.message : 'CLOCK_CHECK_FAILED';
  } finally { lock.releaseLock(); }
  health.pendingAuthRequest = JSON.parse(props.getProperty('ACTIONS_CLOCK_AUTH_REQUEST') || 'null');
  health.pendingRecoveryRequest = JSON.parse(props.getProperty('ACTIONS_CLOCK_RECOVERY_REQUEST') || 'null');
  health.elapsedMs = Date.now() - Date.parse(health.checkedAt);
  props.setProperty('ACTIONS_CLOCK_HEALTH', JSON.stringify(health));
  if (typeof publishQaHeartbeatSafely_ === 'function') publishQaHeartbeatSafely_();
  actionsClockNotice_(health);
  console.log(JSON.stringify(health));
  return health;
}
// 設定済みの鍵と通知先を保持したまま、本人指示の時計切替を開始する。
function startActionsClock() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error('CLOCK_BUSY');
  var props = actionsClockProps_();
  try {
    if (!props.getProperty('ACTIONS_CLOCK_TOKEN') || !props.getProperty('HEALTH_EMAIL')) throw new Error('CLOCK_CONFIG_REQUIRED');
    props.setProperty('ACTIONS_CLOCK_MIGRATION_ACK', 'true');
    props.setProperty('ACTIONS_CLOCK_ENABLED', 'true');
    try { installActionsClock(); }
    catch (e) { props.setProperty('ACTIONS_CLOCK_ENABLED', 'false'); throw e; }
    console.log('CLOCK_STARTED triggerCount=' + ScriptApp.getProjectTriggers().filter(function(t) {return t.getHandlerFunction() === 'tickActionsClock';}).length);
  } finally { lock.releaseLock(); }
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
    pendingRecoveryRequest: JSON.parse(p.getProperty('ACTIONS_CLOCK_RECOVERY_REQUEST') || 'null'),
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
