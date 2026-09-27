/* QA記録先だけを切り替える。既存の認証情報とActions時計は保持する。 */
var QA_PRODUCTION = {
  GOOGLE_SPREADSHEET_ID: '1uZpR4M8spaNV9cEXQ4_jB_NOu6w8j2HIGwnyUNQl28Y',
  GOOGLE_SHEET_NAME: 'シート1', NOTION_DATABASE_ID: '60255780-4556-4b86-b83c-9ebc579ce31a',
  QA_CHANNEL_ID: 'C05LY9ZN41Z'
};
function inspectQaProduction() {
  var c = config_();
  c.p = Object.assign({}, c.p, QA_PRODUCTION);
  delete c.p.NOTION_DATA_SOURCE_ID;
  c.qa = QA_PRODUCTION.QA_CHANNEL_ID; c.channels = [c.qa];
  var b = book_(c), s = sheet_(b, c.p.GOOGLE_SHEET_NAME), values = rows_(s);
  var expected = ['サービス','質問内容','質問背景','URL','質問者','回答者','画像','送信日時','タイムスタンプ','回答テキスト'];
  if (!values.length || expected.some(function(h,i) {return values[0][i] !== h;})) throw new Error('QA_HEADERS_MISMATCH');
  sheet_(b, 'CORRECTIONS');
  var schema = notion_(c, 'data_sources/' + sourceId_(c), undefined, 'get').properties || {};
  var types = {'サービス':'rich_text','URL':'url','回答者':'rich_text','回答テキスト':'rich_text',
    '質問の内容':'title','タイムスタンプ':'rich_text','質問者':'rich_text'};
  Object.keys(types).forEach(function(k) {if (!schema[k] || schema[k].type !== types[k]) throw new Error('QA_NOTION_SCHEMA_MISMATCH');});
  var channel = slack_(c, 'conversations.info', {channel: c.qa}).channel;
  if (!channel || channel.id !== c.qa || channel.is_archived) throw new Error('QA_CHANNEL_MISMATCH');
  notionQuestionDateType_(c);
  var history = slack_(c, 'conversations.history', {channel: c.qa, limit: 15});
  var out = {enabled: PropertiesService.getScriptProperties().getProperty('ENABLED') === 'true',
    targets: QA_PRODUCTION, rows: values.length - 1, channelName: channel.name,
    latestParents: (history.messages || []).map(function(m) {return {ts:m.ts, replyCount:m.reply_count || 0};}),
    notionSource: sourceId_(c), notionDateType: notionQuestionDateType_(c)};
  console.log(JSON.stringify(out)); return out;
}
function prepareQaProduction() {
  var p = PropertiesService.getScriptProperties(), lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error('QA_BUSY');
  try {
    if (p.getProperty('ENABLED') === 'true') throw new Error('DISABLE_FIRST');
    if (p.getProperty('NOTION_CREATE_PENDING')) throw new Error('NOTION_CREATE_RECONCILE');
    p.deleteProperty('QA_PRODUCTION_PREPARED');
    inspectQaProduction();
    p.setProperties(QA_PRODUCTION);
    p.deleteProperty('NOTION_DATA_SOURCE_ID');
    prepareSalesQa();
    ['SCAN_STATE', 'RECENT_STATE', 'RECENT_THROUGH_TS', 'CYCLE_THROUGH_TS',
      'LAST_RUN_SUCCESS', 'LAST_RECENT_CYCLE_SUCCESS', 'LAST_CYCLE_SUCCESS', 'LAST_SYNC_VERIFIED',
      'HEALTH', 'RETRY_AT'].forEach(function(k) {p.deleteProperty(k);});
    var b = book_(config_());
    ['GAS_STAGE', 'GAS_STAGE_RECENT'].forEach(function(n) {sheet_(b,n).clearContents();});
    // 直近の記録位置から重ねて読み、交代待ちの間の発言を取り逃さない。
    var state = rows_(sheet_(b, 'STATE')).find(function(r) {return r[0] === 'last_processed_ts';});
    p.setProperty('RECENT_THROUGH_TS', String(Math.min(state && /^\d+(\.\d+)?$/.test(state[1]) ? Number(state[1]) : Infinity, Date.now()/1000 - 86400)));
    p.setProperty('QA_PRODUCTION_PREPARED', 'true');
    console.log('QA_PRODUCTION_PREPARED');
  } finally {lock.releaseLock();}
}
// Python記録OFFの新Bot起動を確認した後だけ実行する。
function startQaProduction() {
  var p = PropertiesService.getScriptProperties(), lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error('QA_BUSY');
  try {
    if (p.getProperty('QA_PRODUCTION_PREPARED') !== 'true') throw new Error('QA_PREPARE_REQUIRED');
    var c = config_();
    Object.keys(QA_PRODUCTION).forEach(function(k) {if (c.p[k] !== QA_PRODUCTION[k]) throw new Error('QA_TARGET_MISMATCH');});
    p.setProperty('ENABLED', 'true');
    try {installSalesQaTrigger();} catch(e) {p.setProperty('ENABLED', 'false'); throw e;}
    console.log('QA_RECORDING_STARTED');
  } finally {lock.releaseLock();}
}
// 実際に完了した同期の保存先を読戻す。質問・回答本文はログへ出さない。
function verifyQaProduction() {
  var c = config_(), b = book_(c), qaRows = rows_(sheet_(b, c.p.GOOGLE_SHEET_NAME));
  var complete = rows_(sheet_(b, 'GAS_SYNC_STATE')).filter(function(r) {return r[2] === 'COMPLETE';});
  var verified = complete.slice(0, 3).map(function(r) {
    var ts = r[0].slice(r[0].indexOf(':')+1);
    var matching = qaRows.filter(function(q) {return q[8] === ts || (q[3] || '').indexOf('/p'+ts.replace('.','')) >= 0;});
    if (matching.length !== 1) throw new Error('QA_READBACK_DUPLICATE');
    var pages = notion_(c, 'data_sources/' + sourceId_(c) + '/query', {
      filter: {property:'タイムスタンプ',rich_text:{equals:ts}}
    }).results;
    if (!pages || !pages.some(function(p) {return p.id === r[3];})) throw new Error('QA_NOTION_READBACK_DUPLICATE');
    if (pages.some(function(p) {return p.properties && p.properties.URL && p.properties.URL.url && p.properties.URL.url !== matching[0][3];})) throw new Error('QA_NOTION_READBACK_MISMATCH');
    var page = notion_(c, 'pages/'+r[3], undefined, 'get'), q = matching[0];
    [['サービス',0],['回答者',5],['回答テキスト',9]].forEach(function(pair) {
      var actual = (page.properties[pair[0]].rich_text || []).map(function(x) {return x.plain_text || (x.text || {}).content || '';}).join('');
      if (actual !== rich_(q[pair[1]])[0].text.content) throw new Error('QA_NOTION_READBACK_MISMATCH');
    });
    if (page.properties.URL.url !== q[3]) throw new Error('QA_NOTION_READBACK_MISMATCH');
    return {ts:ts, pageId:r[3], sheetRows:matching.length, notionPages:pages.length};
  });
  var out = {completeCount:complete.length, verified:verified};
  console.log(JSON.stringify(out)); return out;
}
function pauseQaProduction() {
  PropertiesService.getScriptProperties().setProperty('ENABLED', 'false');
  console.log('QA_RECORDING_PAUSED');
}
function qaRecordingProgress() {
  var p=PropertiesService.getScriptProperties(), s=JSON.parse(p.getProperty('SCAN_STATE') || '{}');
  var out={runBudgetSeconds:Number(p.getProperty('RUN_BUDGET_SECONDS') || 45),
    dailyLimitSeconds:Number(p.getProperty('DAILY_RUNTIME_LIMIT_SECONDS') || 14400),
    lastDeepCycle:p.getProperty('LAST_CYCLE_SUCCESS'), lastRecentCycle:p.getProperty('LAST_RECENT_CYCLE_SUCCESS'),
    cursorPresent:!!s.cursor, parentsRemaining:s.parents ? s.parents.length-(s.index || 0) : null,
    thread:s.thread ? s.thread.ts : null, dailyRuntime:JSON.parse(p.getProperty('DAILY_RUNTIME') || '{}')};
  console.log(JSON.stringify(out)); return out;
}

// 初回全履歴だけ210秒で進める。通常の予算設定は書き換えない。
function continueQaInitialScan() {
  pollSalesQaWithBudget_(210);
}
