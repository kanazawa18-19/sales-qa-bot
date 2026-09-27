/* 外部監視用の時刻だけを専用タブへ保存する。秘密値・QA本文は含めない。 */
function publishQaHeartbeat_() {
  var p = PropertiesService.getScriptProperties();
  var b = SpreadsheetApp.openById(p.getProperty('GOOGLE_SPREADSHEET_ID'));
  var s = b.getSheetByName('GAS_HEALTH') || b.insertSheet('GAS_HEALTH');
  var triggers = ScriptApp.getProjectTriggers().map(function(t) {return t.getHandlerFunction();});
  var state = {
    schema: 1, observedAt: new Date().toISOString(),
    enabled: p.getProperty('ENABLED') === 'true',
    clockEnabled: p.getProperty('ACTIONS_CLOCK_ENABLED') === 'true',
    pollTriggers: triggers.filter(function(n) {return n === 'pollSalesQa';}).length,
    clockTriggers: triggers.filter(function(n) {return n === 'tickActionsClock';}).length,
    lastRun: p.getProperty('LAST_RUN_SUCCESS'),
    lastRecentCycle: p.getProperty('LAST_RECENT_CYCLE_SUCCESS'),
    lastDeepCycle: p.getProperty('LAST_CYCLE_SUCCESS'),
    health: JSON.parse(p.getProperty('HEALTH') || '{}'),
    clock: JSON.parse(p.getProperty('ACTIONS_CLOCK_HEALTH') || '{}'),
    daily: JSON.parse(p.getProperty('DAILY_RUNTIME') || '{}'),
    dailyLimitSeconds: Number(p.getProperty('DAILY_RUNTIME_LIMIT_SECONDS') || 14400)
  };
  state.daily = {startedAt:state.daily.startedAt, ms:state.daily.ms};
  // API要求IDやスレッドIDを外部監視の保存先へコピーしない。
  state.health = {status:state.health.status, code:state.health.code,
    started:state.health.started, durationMs:state.health.durationMs};
  state.clock = {ok:state.clock.ok, checkedAt:state.clock.checkedAt,
    lastAuthSuccess:state.clock.lastAuthSuccess, elapsedMs:state.clock.elapsedMs};
  s.getRange(1, 1, 1, 2).setNumberFormat('@').setValues([['heartbeat', JSON.stringify(state)]]);
  SpreadsheetApp.flush();
  if (s.getRange(1, 2).getDisplayValue() !== JSON.stringify(state)) throw Error('HEARTBEAT_VERIFY_FAILED');
  return state;
}
function publishQaHeartbeatSafely_() {
  try {publishQaHeartbeat_();}
  catch (e) {console.log('HEARTBEAT_PUBLISH_FAILED');}
}
// 配置時の読戻し。記録・時計の開始や停止はしない。
function inspectQaHeartbeat() {
  console.log(JSON.stringify(publishQaHeartbeat_()));
}
// 全ページを読み取って重複件数と固定同期先の有無だけを報告する。ページは変更しない。
function auditQaNotionDuplicates() {
  var c = config_(), groups = {}, cursor = null, count = 0, requests = 0;
  do {
    var query = {page_size:100};
    if (cursor) query.start_cursor = cursor;
    var result = notion_(c, 'data_sources/' + sourceId_(c) + '/query', query);
    if (!Array.isArray(result.results)) throw Error('AUDIT_RESPONSE_INVALID');
    result.results.forEach(function(page) {
      var url = page.properties && page.properties.URL && page.properties.URL.url;
      count++;
      if (!url) return;
      if (!groups[url]) groups[url] = [];
      groups[url].push(page.id);
    });
    cursor = result.has_more ? result.next_cursor : null;
    if (result.has_more && !cursor) throw Error('AUDIT_CURSOR_MISSING');
    if (++requests >= 50 && cursor) throw Error('AUDIT_INCOMPLETE');
  } while (cursor);
  var state = rows_(sheet_(book_(c), 'GAS_SYNC_STATE'));
  var fixed = state.filter(function(r) {return r[2] === 'COMPLETE';}).map(function(r) {return r[3];});
  var duplicate = Object.keys(groups).filter(function(url) {return groups[url].length > 1;});
  var out = {pages:count, urls:Object.keys(groups).length, duplicateGroups:duplicate.length,
    extraPages:duplicate.reduce(function(n,url) {return n+groups[url].length-1;},0),
    groupsWithFixedPage:duplicate.filter(function(url) {return groups[url].some(function(id) {return fixed.indexOf(id)>=0;});}).length,
    maxCopies:Math.max.apply(null, [0].concat(duplicate.map(function(url) {return groups[url].length;})))};
  console.log(JSON.stringify(out)); return out;
}
