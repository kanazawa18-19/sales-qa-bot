const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function makeSheet(header) {
  const data = header ? [header.map(String)] : [];
  function ensure(r, c) { while (data.length < r) data.push([]); while (data[r - 1].length < c) data[r - 1].push(''); }
  return {
    getLastRow: () => data.length,
    getLastColumn: () => (data.length ? data[0].length : 0),
    appendRow: (values) => data.push(values.map(String)),
    getRange: (r, c, nr, nc) => {
      nr = nr || 1; nc = nc || 1;
      const range = {
        setNumberFormat: () => range,
        setValues: (vals) => { vals.forEach((row, i) => row.forEach((v, j) => { ensure(r + i, c + j); data[r + i - 1][c + j - 1] = String(v); })); return range; },
        setValue: (v) => { ensure(r, c); data[r - 1][c - 1] = String(v); return range; },
        getDisplayValues: () => { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push((data[r + i - 1] || [])[c + j - 1] || ''); out.push(row); } return out; },
      };
      return range;
    },
    _data: data,
  };
}
function makeBook(sheets) {
  return {
    getSheetByName: (name) => sheets[name],
    insertSheet: (name) => { sheets[name] = makeSheet(); return sheets[name]; },
  };
}
function setup(props = {}, fetchImpl = () => { throw Error('unexpected fetch'); }, sheets = {}) {
  const p = { GOOGLE_SPREADSHEET_ID: 'SHEET1', BOT_USER_ID: 'UBOT', ...props };
  const calls = [], emails = [], triggers = [];
  const books = { SHEET1: makeBook(sheets) };
  const ctx = {
    Date, JSON, console: { log() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => p[k], setProperty: (k, v) => { p[k] = v; }, deleteProperty: (k) => { delete p[k]; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Utilities: { getUuid: () => '22222222-2222-2222-2222-222222222222' },
    UrlFetchApp: { fetch: (url, options) => { calls.push({ url, options }); return fetchImpl(url, options); } },
    MailApp: { sendEmail: (...a) => emails.push(a) },
    SpreadsheetApp: { openById: (id) => books[id] },
    ContentService: { createTextOutput: (text) => ({ _text: text, setMimeType() { return this; } }), MimeType: { JSON: 'JSON' } },
    ScriptApp: {
      getProjectTriggers: () => triggers,
      newTrigger: (name) => ({ timeBased: () => ({ everyMinutes: () => ({ create: () => triggers.push({ getHandlerFunction: () => name }) }) }) }),
      deleteTrigger: (t) => triggers.splice(triggers.indexOf(t), 1),
    },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync('gas/Http.js', 'utf8'), ctx);
  return { ctx, p, calls, emails, triggers, sheets };
}
const response = (code, data = {}) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(data) });
const okEvent = { type: 'event_callback', event_id: 'Ev1', team_id: 'TREAL', event: { type: 'app_mention', channel: 'C1', user: 'UASK', ts: '100.1', text: '<@UBOT> 質問' } };
function post(x, body) { return x.ctx.doPost({ postData: { contents: JSON.stringify(body) } }); }

test('url_verificationはchallengeを即返す・キューに触れない', () => {
  const x = setup();
  const out = x.ctx.doPost({ postData: { contents: JSON.stringify({ type: 'url_verification', challenge: 'abc' }) } });
  assert.equal(out._text, JSON.stringify({ challenge: 'abc' }));
  assert.equal(x.calls.length, 0);
});
test('event_callback以外・不正JSONは何もせず200相当', () => {
  const x = setup({}, undefined, { GAS_HTTP_QUEUE: makeSheet() });
  post(x, { type: 'something_else' });
  x.ctx.doPost({ postData: { contents: 'not json' } });
  assert.equal(x.sheets.GAS_HTTP_QUEUE._data.length, 0);
});
test('関連イベントはqueuedで積まれる', () => {
  const x = setup({}, undefined, { GAS_HTTP_QUEUE: makeSheet() });
  post(x, okEvent);
  const row = x.sheets.GAS_HTTP_QUEUE._data[0];
  assert.equal(row[0], 'Ev1'); assert.equal(row[8], 'queued'); assert.equal(row[7], '<@UBOT> 質問'); assert.equal(row[14], 'TREAL');
});
test('自分自身の発言・編集削除はskipで積む（Pythonでの再判定に残す）', () => {
  const x = setup({}, undefined, { GAS_HTTP_QUEUE: makeSheet() });
  post(x, { type: 'event_callback', event_id: 'Ev2', event: { type: 'message', channel: 'C1', user: 'UBOT', ts: '1.1', text: 'x' } });
  assert.equal(x.sheets.GAS_HTTP_QUEUE._data[0][8], 'skip');
});
test('同じevent_idは二重に積まない（Slack再送対策）', () => {
  const x = setup({}, undefined, { GAS_HTTP_QUEUE: makeSheet() });
  post(x, okEvent); post(x, okEvent);
  assert.equal(x.sheets.GAS_HTTP_QUEUE._data.length, 1);
});
test('event_id欠落は例外を投げてSlackの再送に委ねる', () => {
  const x = setup({}, undefined, { GAS_HTTP_QUEUE: makeSheet() });
  assert.throws(() => post(x, { type: 'event_callback', event: { type: 'message', channel: 'C1', ts: '1.1', text: 'x' } }), /HTTP_EVENT_ID_MISSING/);
});
test('無効化中はtickが通信しない', () => {
  const x = setup({}, undefined, { GAS_HTTP_QUEUE: makeSheet() });
  assert.equal(x.ctx.tickHttpQueue().state, 'disabled');
  assert.equal(x.calls.length, 0);
});
test('queuedをanswer.ymlへdispatchしrequest_idを保存', () => {
  const sheet = makeSheet();
  sheet.appendRow(['Ev1', '2026-01-01T00:00:00.000Z', 'C1', 'UASK', '100.1', '100.1', 'app_mention', '質問', 'queued', '', '', '', '', '', 'TREAL']);
  const x = setup({ HTTP_QUEUE_ENABLED: 'true', ACTIONS_CLOCK_TOKEN: 't' }, (url) => url.includes('/dispatches') ? response(204) : response(200, { workflow_runs: [] }), { GAS_HTTP_QUEUE: sheet });
  const result = x.ctx.tickHttpQueue();
  assert.equal(result.dispatched, 1);
  const row = x.sheets.GAS_HTTP_QUEUE._data[0];
  assert.equal(row[8], 'dispatched'); assert.equal(row[9], '22222222-2222-2222-2222-222222222222');
  const payload = JSON.parse(x.calls.find((c) => c.options.method === 'post').options.payload);
  assert.equal(payload.ref, 'slack-http');
  assert.equal(payload.inputs.request_id, '22222222-2222-2222-2222-222222222222');
  assert.equal(payload.inputs.channel, 'C1');
  assert.equal(payload.inputs.team_id, 'TREAL');
});
test('確定拒否422/429はrejectedにして再送しない', () => {
  for (const code of [422, 429]) {
    const sheet = makeSheet();
    sheet.appendRow(['Ev1', 't', 'C1', 'UASK', '100.1', '100.1', 'app_mention', '質問', 'queued', '', '', '', '', '']);
    const x = setup({ HTTP_QUEUE_ENABLED: 'true', ACTIONS_CLOCK_TOKEN: 't' }, () => response(code), { GAS_HTTP_QUEUE: sheet });
    x.ctx.tickHttpQueue();
    assert.equal(x.sheets.GAS_HTTP_QUEUE._data[0][8], 'rejected');
  }
});
test('結果不明な失敗（5xx等）はqueuedへ戻さない・同じ周期内では再dispatchしない', () => {
  const sheet = makeSheet();
  sheet.appendRow(['Ev1', 't', 'C1', 'UASK', '100.1', '100.1', 'app_mention', '質問', 'queued', '', '', '', '', '']);
  let dispatchCalls = 0;
  const x = setup({ HTTP_QUEUE_ENABLED: 'true', ACTIONS_CLOCK_TOKEN: 't' }, (url) => {
    if (url.includes('/dispatches')) { dispatchCalls++; return response(500); }
    return response(200, { workflow_runs: [] });
  }, { GAS_HTTP_QUEUE: sheet });
  x.ctx.tickHttpQueue();
  const row = x.sheets.GAS_HTTP_QUEUE._data[0];
  assert.equal(row[8], 'dispatched'); // 'queued'に戻らない
  assert.ok(row[9]); // request_idは保持される
  assert.equal(dispatchCalls, 1);
});
test('結果不明な失敗の後、次周期でも同じ行を再dispatchしない（二重回答防止）', () => {
  const sheet = makeSheet();
  sheet.appendRow(['Ev1', 't', 'C1', 'UASK', '100.1', '100.1', 'app_mention', '質問', 'queued', '', '', '', '', '']);
  let dispatchCalls = 0;
  const x = setup({ HTTP_QUEUE_ENABLED: 'true', ACTIONS_CLOCK_TOKEN: 't' }, (url) => {
    if (url.includes('/dispatches')) { dispatchCalls++; return response(500); }
    return response(200, { workflow_runs: [] });
  }, { GAS_HTTP_QUEUE: sheet });
  x.ctx.tickHttpQueue();
  x.ctx.tickHttpQueue();
  assert.equal(dispatchCalls, 1); // 2周期目はdispatchせず履歴照合だけ行う
});
test('GitHubの履歴取得自体が失敗し続けても、返信も無ければ最終的にuncertain化して通知する', () => {
  const sheet = makeSheet();
  const old = new Date(Date.now() - 20 * 60000).toISOString();
  sheet.appendRow(['Ev1', old, 'C1', 'UASK', '100.1', '100.1', 'app_mention', '質問', 'dispatched', 'REQ1', old, '', '', '']);
  const x = setup({ HTTP_QUEUE_ENABLED: 'true', ACTIONS_CLOCK_TOKEN: 't', SLACK_READ_TOKEN: 'r', HEALTH_EMAIL: 'owner@example.test' }, (url) => {
    if (url.includes('/runs')) throw Error('network down');
    if (url.includes('conversations.replies')) return response(200, { ok: true, messages: [] });
    throw Error('unexpected ' + url);
  }, { GAS_HTTP_QUEUE: sheet });
  x.ctx.tickHttpQueue();
  assert.equal(x.sheets.GAS_HTTP_QUEUE._data[0][8], 'uncertain');
  assert.equal(x.emails.length, 1);
});
test('実返信が確認できたらdoneにする（Actionsの結了状態だけを信じない）', () => {
  const sheet = makeSheet();
  const past = new Date(Date.now() - 60000).toISOString();
  sheet.appendRow(['Ev1', past, 'C1', 'UASK', '100.1', '100.1', 'app_mention', '質問', 'dispatched', 'REQ1', past, '', '', '']);
  const x = setup({ HTTP_QUEUE_ENABLED: 'true', ACTIONS_CLOCK_TOKEN: 't', SLACK_READ_TOKEN: 'r' }, (url) => {
    if (url.includes('/runs')) return response(200, { workflow_runs: [{ id: 9, display_title: 'QA回答 REQ1', status: 'in_progress' }] });
    if (url.includes('conversations.replies')) return response(200, { ok: true, messages: [{ user: 'UBOT', ts: String(Date.now() / 1000) }] });
    throw Error('unexpected ' + url);
  }, { GAS_HTTP_QUEUE: sheet });
  x.ctx.tickHttpQueue();
  assert.equal(x.sheets.GAS_HTTP_QUEUE._data[0][8], 'done');
});
test('返信も実行履歴も見つからないまま長時間経過したらuncertainにして通知・再送しない', () => {
  const sheet = makeSheet();
  const old = new Date(Date.now() - 20 * 60000).toISOString();
  sheet.appendRow(['Ev1', old, 'C1', 'UASK', '100.1', '100.1', 'app_mention', '質問', 'dispatched', 'REQ1', old, '', '', '']);
  const x = setup({ HTTP_QUEUE_ENABLED: 'true', ACTIONS_CLOCK_TOKEN: 't', SLACK_READ_TOKEN: 'r', HEALTH_EMAIL: 'owner@example.test' }, (url) => {
    if (url.includes('/runs')) return response(200, { workflow_runs: [] });
    if (url.includes('conversations.replies')) return response(200, { ok: true, messages: [] });
    throw Error('unexpected ' + url);
  }, { GAS_HTTP_QUEUE: sheet });
  x.ctx.tickHttpQueue();
  assert.equal(x.sheets.GAS_HTTP_QUEUE._data[0][8], 'uncertain');
  assert.equal(x.emails.length, 1);
  x.ctx.tickHttpQueue();
  assert.equal(x.calls.filter((c) => c.options.method === 'post').length, 0); // rejected/uncertain行は再送しない
});
test('1周期あたりdispatch5件・resolve10件で打ち切る', () => {
  const sheet = makeSheet();
  for (let i = 0; i < 8; i++) sheet.appendRow(['Ev' + i, 't', 'C1', 'UASK', '100.' + i, '100.' + i, 'app_mention', '質問', 'queued', '', '', '', '', '']);
  const x = setup({ HTTP_QUEUE_ENABLED: 'true', ACTIONS_CLOCK_TOKEN: 't' }, (url) => url.includes('/dispatches') ? response(204) : response(200, { workflow_runs: [] }), { GAS_HTTP_QUEUE: sheet });
  const result = x.ctx.tickHttpQueue();
  assert.equal(result.dispatched, 5);
});
test('prepareは有効化前だけ・シートを作る', () => {
  const x = setup({}, undefined, {});
  x.ctx.prepareHttpQueue();
  assert.ok(x.sheets.GAS_HTTP_QUEUE);
  x.p.HTTP_QUEUE_ENABLED = 'true';
  assert.throws(() => x.ctx.prepareHttpQueue(), /DISABLE_FIRST/);
});
test('installは有効化とトークン必須・stopはトリガーだけ止める', () => {
  const x = setup({}, undefined, { GAS_HTTP_QUEUE: makeSheet() });
  assert.throws(() => x.ctx.installHttpQueue(), /HTTP_ENABLE_FIRST/);
  x.p.HTTP_QUEUE_ENABLED = 'true';
  assert.throws(() => x.ctx.installHttpQueue(), /HTTP_TOKEN_REQUIRED/);
  x.p.ACTIONS_CLOCK_TOKEN = 't';
  x.ctx.installHttpQueue(); x.ctx.installHttpQueue();
  assert.equal(x.triggers.length, 1);
  x.ctx.stopHttpQueue();
  assert.equal(x.p.HTTP_QUEUE_ENABLED, 'false');
  assert.equal(x.triggers.length, 0);
});
test('healthは状態別件数とトリガー数を返す', () => {
  const sheet = makeSheet();
  sheet.appendRow(['Ev1', 't', 'C1', 'U', '1.1', '1.1', 'message', 'x', 'done', '', '', '', '', '']);
  sheet.appendRow(['Ev2', 't', 'C1', 'U', '1.2', '1.2', 'message', 'x', 'queued', '', '', '', '', '']);
  const x = setup({}, undefined, { GAS_HTTP_QUEUE: sheet });
  const h = x.ctx.healthHttpQueue();
  assert.equal(h.total, 2); assert.equal(h.byState.done, 1); assert.equal(h.byState.queued, 1);
});
