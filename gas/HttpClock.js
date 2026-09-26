// HTTP版の認証更新を起動する時計。回答とSlack受信は外部の最小処理へ委ねる。
function httpClockConfig_() {
  var p = PropertiesService.getScriptProperties().getProperties();
  if (!/^[a-z][a-z0-9-]+$/.test(p.HTTP_GCP_PROJECT || '') ||
      !/^[a-z]+-[a-z]+[0-9]$/.test(p.HTTP_GCP_REGION || '') ||
      !/^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)?\.run\.app$/.test(p.HTTP_WORKER_URL || '') ||
      !/^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(p.HTTP_TASKS_SERVICE_ACCOUNT || '')) {
    throw new Error('HTTP_CLOCK_CONFIG_REQUIRED');
  }
  return p;
}
function httpGoogle_(url, payload) {
  var options = {method: payload ? 'post' : 'get',
    headers: {Authorization: 'Bearer ' + ScriptApp.getOAuthToken()}, muteHttpExceptions: true};
  if (payload) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(payload);
  }
  var response = UrlFetchApp.fetch(url, options), code = response.getResponseCode();
  if (code === 409) return {duplicate: true};
  if (code < 200 || code >= 300) throw new Error('HTTP_CLOCK_GOOGLE_' + code);
  return JSON.parse(response.getContentText());
}
function tickHttpNotebookAuth() {
  var props = PropertiesService.getScriptProperties(), p = httpClockConfig_();
  if (p.HTTP_CLOCK_ENABLED !== 'true') return;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    var parent = 'projects/' + p.HTTP_GCP_PROJECT + '/locations/' + p.HTTP_GCP_REGION + '/queues/sales-qa';
    var taskName = parent + '/tasks/auth-' + Math.floor(Date.now() / 300000);
    httpGoogle_('https://cloudtasks.googleapis.com/v2/' + parent + '/tasks', {task: {
      name: taskName,
      httpRequest: {httpMethod: 'POST', url: p.HTTP_WORKER_URL + '/tasks/refresh-auth',
        oidcToken: {serviceAccountEmail: p.HTTP_TASKS_SERVICE_ACCOUNT, audience: p.HTTP_WORKER_URL}},
      dispatchDeadline: '300s'
    }});
    props.setProperty('HTTP_CLOCK_LAST_DISPATCH', new Date().toISOString());
  } finally {lock.releaseLock();}
}
function installHttpNotebookClock() {
  var p = httpClockConfig_();
  if (p.HTTP_CLOCK_ENABLED !== 'true') throw new Error('ENABLE_HTTP_CLOCK_FIRST');
  if (!ScriptApp.getProjectTriggers().some(function(t) {return t.getHandlerFunction() === 'tickHttpNotebookAuth';})) {
    ScriptApp.newTrigger('tickHttpNotebookAuth').timeBased().everyMinutes(5).create();
  }
  if (!ScriptApp.getProjectTriggers().some(function(t) {return t.getHandlerFunction() === 'checkHttpNotebookClock';})) {
    ScriptApp.newTrigger('checkHttpNotebookClock').timeBased().everyMinutes(15).create();
  }
}
function checkHttpNotebookClock() {
  var props = PropertiesService.getScriptProperties(), p = httpClockConfig_();
  if (p.HTTP_CLOCK_ENABLED !== 'true') return;
  var health = {role: 'notebooklm_auth_clock', checkedAt: new Date().toISOString()};
  try {
    health.triggerCount = ScriptApp.getProjectTriggers().filter(function(t) {
      return t.getHandlerFunction() === 'tickHttpNotebookAuth';
    }).length;
    var url = 'https://firestore.googleapis.com/v1/projects/' + p.HTTP_GCP_PROJECT +
      '/databases/(default)/documents/sales_qa_http_jobs/notebooklm-auth-refresh';
    var fields = httpGoogle_(url).fields || {};
    health.lastSuccess = Number((fields.last_success || {}).doubleValue || (fields.last_success || {}).integerValue || 0);
    health.lastDispatch = props.getProperty('HTTP_CLOCK_LAST_DISPATCH');
    health.ok = health.triggerCount === 1 && Date.now() / 1000 - health.lastSuccess < 1200 &&
      Date.now() - Date.parse(health.lastDispatch || '') < 1200000;
  } catch (e) {health.ok = false; health.code = String(e.message || 'HTTP_CLOCK_CHECK_FAILED').slice(0, 80);}
  props.setProperty('HTTP_CLOCK_HEALTH', JSON.stringify(health));
  console.log(JSON.stringify(health));
  var day = new Date().toISOString().slice(0, 10), previous = props.getProperty('HTTP_CLOCK_LAST_NOTICE');
  var notice = health.ok ? 'ok-' + day : 'failed';
  if (p.HEALTH_EMAIL && previous !== notice) {
    MailApp.sendEmail(p.HEALTH_EMAIL, 'Sales QA Bot ' + (health.ok ? '認証更新の稼働報告' : '認証更新の要確認'), JSON.stringify(health, null, 2));
    props.setProperty('HTTP_CLOCK_LAST_NOTICE', notice);
  }
  return health;
}
