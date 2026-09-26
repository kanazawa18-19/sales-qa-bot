const test = require('node:test');
const assert = require('node:assert/strict');
const qa = require('../gas/Core.js');
const c = {
    channels: ['CQ'], qa: 'CQ', ai: 'CA', mentions: ['CQ'], cutoff: '100', botUser: 'UB'
};
test('NotebookLM構成ではGASはQAだけを巡回しAI候補を作らない', () => {
    const p = { AI_BACKEND: 'notebooklm_external', SLACK_BOT_TOKEN: 'bot',
        SLACK_READ_TOKEN: 'reader', BOT_USER_ID: 'UB', QA_CHANNEL_ID: 'CQ',
        GOOGLE_SPREADSHEET_ID: 'sheet', NOTION_TOKEN: 'notion',
        NOTION_DATABASE_ID: 'db', AI_START_TS: '100', AI_CHANNEL_ID: 'CA',
        MENTION_CHANNEL_IDS: 'CQ,CA' };
    const ctx = runtime({ PropertiesService: { getScriptProperties: () => ({getProperties: () => p}) }});
    const configured = ctx.config_();
    assert.deepEqual(Array.from(configured.channels), ['CQ']);
    assert.equal(qa.candidate({ts: '101', text: '<@UB> 質問'}, 'CQ', configured), false);
    assert.equal(qa.candidate({ts: '101', text: '質問'}, 'CA', configured), false);
    const f = fixture();
    let state = {};
    for (let i = 0; i < 100 && !f.cycles; i++) state = qa.step(state, f.io, configured);
    assert.ok(f.synced.length > 0);
    assert.equal(f.answers.length, 0);
    p.AI_BACKEND = 'claude';
    assert.throws(() => ctx.config_(), /CONFIG_NOTEBOOKLM_EXTERNAL_REQUIRED/);
});
test('NotebookLM構成で過去のClaude送信台帳を再送しない', () => {
    const ctx = runtime();
    ctx.slack_ = () => { throw Error('外部投稿禁止'); };
    assert.throws(() => ctx.answer_({p: {AI_BACKEND: 'notebooklm_external'}}, null,
        'CQ', {ts: '101'}, []), /NOTEBOOKLM_ANSWER_OWNED_BY_PYTHON/);
});
test('Workflow本文、ブロックと人間の回答・画像を取り出す', () => {
    const r = qa.row('CQ', [{
            ts: '101.000001', user: 'U1', blocks: [{
                    type: 'section', text: {
                        text: '■サービス\nホテル\n■質問内容\n質問'
                    }
                }]
        }, {
            ts: '102', text: '回答', user: 'U2'
        }, {
            ts: '103', text: 'AI', bot_id: 'B'
        }], 'https://example.slack.com');
    assert.equal(r[0], 'ホテル');
    assert.equal(r[1], '質問');
    assert.equal(r[9], '回答');
    assert.equal(r[8], '101.000001');
});
test('cutoffとallowlist、親/返信メンションを区別', () => {
    assert.equal(qa.candidate({
        ts: '99', text: '<@UB> 質問'
    }, 'CQ', c), false);
    assert.equal(qa.candidate({
        ts: '101', thread_ts: '1', text: '<@UB> 質問'
    }, 'CQ', c), true);
    assert.equal(qa.candidate({
        ts: '101', text: '<@UB> 質問'
    }, 'CX', c), false);
    assert.equal(qa.candidate({
        ts: '101', thread_ts: '1', text: '質問'
    }, 'CA', c), false);
    assert.equal(qa.candidate({
        ts: '101', text: '質問'
    }, 'CA', c), true);
});
function fixture() {
    let staged = [], synced = [], answers = [], cycles = 0, calls = [];
    return {
        synced, answers, calls, get cycles() {
            return cycles;
        }, io: {
            now: () => 200000, history: (ch, cursor) => {
                calls.push(['history', cursor]);
                return cursor ? {
                    messages: [{
                            ts: '1'
                        }]
                } : {
                    messages: [{
                            ts: '101'
                        }], response_metadata: {
                        next_cursor: 'p2'
                    }
                };
            }, replies: (ch, ts, cursor) => {
                calls.push(['replies', ts, cursor]);
                return cursor ? {
                    messages: [{
                            ts: '150', thread_ts: ts, text: '<@UB> 新しい返信'
                        }]
                } : {
                    messages: [{
                            ts, text: '親'
                        }], response_metadata: {
                        next_cursor: 'r2'
                    }
                };
            }, clearStage: () => {
                staged = [];
            }, stage: ms => {
                for (const m of ms)
                    if (!staged.some(x => x.ts === m.ts))
                        staged.push(m);
            }, staged: () => staged, sync: (ch, ms) => synced.push(ms.map(x => x.ts)), answer: (ch, m) => answers.push(m.ts), cycleComplete: () => cycles++
        }
    };
}
test('履歴と返信の全ページ、古い親への新しいメンションを取得', () => {
    const f = fixture();
    let s = {};
    for (let i = 0; i < 50 && !f.cycles; i++)
        s = qa.step(s, f.io, c);
    assert.equal(f.cycles, 1);
    assert.deepEqual(f.synced, [['101', '150'], ['1', '150']]);
    assert.equal(f.answers.length, 2);
    assert.ok(f.calls.some(x => x[0] === 'history' && x[1] === 'p2'));
});
test('同期失敗後は保存済みの位置から再実行し次の親に飛ばさない', () => {
    const f = fixture();
    let s = {};
    while (!s.thread?.done)
        s = qa.step(s, f.io, c);
    const saved = JSON.stringify(s);
    const original = f.io.sync;
    f.io.sync = () => {
        throw new Error('HTTP_503');
    };
    assert.throws(() => qa.step(JSON.parse(saved), f.io, c), /HTTP_503/);
    assert.equal(JSON.stringify(s), saved);
    f.io.sync = original;
    s = qa.step(JSON.parse(saved), f.io, c);
    assert.equal(s.thread.synced, true);
    assert.equal(f.synced.length, 1);
});
test('返信ページ保存失敗は同じcursorを再試行', () => {
    const f = fixture();
    let s = qa.step({}, f.io, c);
    s = qa.step(s, f.io, c);
    const before = JSON.stringify(s);
    const original = f.io.stage;
    f.io.stage = () => {
        throw new Error('STORE_FAILED');
    };
    assert.throws(() => qa.step(JSON.parse(before), f.io, c));
    f.io.stage = original;
    s = qa.step(JSON.parse(before), f.io, c);
    assert.equal(s.thread.cursor, 'r2');
    assert.equal(f.calls.filter(x => x[0] === 'replies' && x[2] === '').length, 2);
});
test('has_moreなのにcursor欠落は完了扱いしない', () => {
    const f = fixture();
    f.io.history = () => ({
        messages: [], has_more: true
    });
    assert.throws(() => qa.step({}, f.io, c), /CURSOR_MISSING/);
});
const vm = require('node:vm'), fs = require('node:fs');
function runtime(extra = {}) {
    const ctx = {
        SalesQa: qa, console: {
            log() {
            }
        }, Date, JSON, ...extra
    };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(require.resolve('../gas/Main.js'), 'utf8'), ctx);
    return ctx;
}
test('HTTP 429はsleepや本文ログを出さずRetry-Afterを保持', () => {
    let calls = 0;
    const ctx = runtime({
        UrlFetchApp: {
            fetch() {
                calls++;
                return {
                    getResponseCode: () => 429, getAllHeaders: () => ({
                        'Retry-After': '120'
                    }), getContentText: () => {
                        throw Error('本文を読まない');
                    }
                };
            }
        }
    });
    const before = Date.now();
    assert.throws(() => ctx.request_('https://example', 'get', {}), e => e.message === 'RATE_LIMITED' && e.retryAt >= before + 120000);
    assert.equal(calls, 1);
});
test('ネットワーク例外の認証情報や本文を出さない', () => {
    const ctx = runtime({
        UrlFetchApp: {
            fetch() {
                throw Error('secret-token customer-body');
            }
        }
    });
    assert.throws(() => ctx.request_('https://example', 'get', {}), /^Error: NETWORK_UNCERTAIN$/);
    assert.equal(ctx.safeError_(Error('secret-token')), 'OPERATION_FAILED');
});
test('dryRunはGET読み取りだけでAI・書込・進捗保存を呼ばない', () => {
    let calls = [];
    const p = { AI_BACKEND: 'notebooklm_external',
        SLACK_BOT_TOKEN: 'bot', SLACK_READ_TOKEN: 'read', BOT_USER_ID: 'UB', QA_CHANNEL_ID: 'CQ', GOOGLE_SPREADSHEET_ID: 'sheet', NOTION_TOKEN: 'notion', NOTION_DATABASE_ID: 'db', AI_START_TS: '100'
    };
    const ctx = runtime({
        PropertiesService: {
            getScriptProperties: () => ({
                getProperties: () => p, setProperty: () => {
                    throw Error('書込');
                }
            })
        }, SpreadsheetApp: {
            openById: () => ({
                getSheetByName: () => ({})
            })
        }, UrlFetchApp: {
            fetch(url, opt) {
                calls.push([url, opt]);
                assert.equal(opt.method, 'get');
                return {
                    getResponseCode: () => 200, getContentText: () => JSON.stringify(url.includes('auth.test') ? {
                        ok: true, user_id: 'UB', team_id: 'T'
                    } : url.includes('slack.com') ? {
                        ok: true, messages: [{
                                ts: '101'
                            }]
                    } : url.includes('/data_sources/') ? {
                        properties: { '質問日時': { type: 'created_time' } }
                    } : {
                        data_sources: [{
                                id: 'ds'
                            }]
                    })
                };
            }
        }
    });
    const result = ctx.dryRunSalesQa();
    assert.equal(result[0].ids[0], '101');
    assert.equal(calls.length, 5);
});
test('信頼するWorkflowだけAI回答対象にする', () => {
    const m = {
        ts: '101', bot_id: 'BW', text: '質問'
    };
    assert.equal(qa.candidate(m, 'CA', c), false);
    assert.equal(qa.candidate(m, 'CA', {
        ...c, workflowBots: ['BW']
    }), true);
});
test('Notion複数sourceは明示設定がなければ停止', () => {
    const ctx = runtime();
    ctx.notion_ = () => ({
        data_sources: [{
                id: 'a'
            }, {
                id: 'b'
            }]
    });
    assert.throws(() => ctx.sourceId_({
        p: {
            NOTION_DATABASE_ID: 'db'
        }
    }), /NOTION_SOURCE_REQUIRED/);
    assert.equal(ctx.sourceId_({
        p: {
            NOTION_DATABASE_ID: 'db', NOTION_DATA_SOURCE_ID: 'b'
        }
    }), 'b');
});
function memorySheet(initial = []) {
    const data = initial.map(r => [...r]);
    return {
        data, getLastRow: () => data.length, getLastColumn: () => Math.max(0, ...data.map(r => r.length)), clearContents() {
            data.length = 0;
        }, getRange(row, col, height = 1, width = 1) {
            return {
                setNumberFormat() {
                    return this;
                }, setValue(value) {
                    return this.setValues([[value]]);
                }, setValues(values) {
                    values.forEach((r, y) => r.forEach((v, x) => {
                        data[row - 1 + y] ??= [];
                        data[row - 1 + y][col - 1 + x] = String(v).replace(/^'=/, '=');
                    }));
                    return this;
                }, getDisplayValues() {
                    return Array.from({
                        length: height
                    }, (_, y) => Array.from({
                        length: width
                    }, (_, x) => data[row - 1 + y]?.[col - 1 + x] ?? ''));
                }
            };
        }
    };
}
function adapterFixture() {
    const sheets = {
        QA: memorySheet([Array(10).fill('header')]), CORRECTIONS: memorySheet(), GAS_SYNC_STATE: memorySheet(), GAS_AI_JOURNAL: memorySheet(), GAS_STAGE: memorySheet(), GAS_STAGE_RECENT: memorySheet()
    };
    const props = {};
    const store = {
        getProperty: k => props[k] ?? null, setProperty(k, v) {
            props[k] = v;
        }, deleteProperty(k) {
            delete props[k];
        }, getProperties: () => props
    };
    const book = {
        getSheetByName: n => sheets[n]
    };
    const ctx = runtime({
        SpreadsheetApp: {
            flush() {
            }, openById: () => book
        }, PropertiesService: {
            getScriptProperties: () => store
        }, Utilities: {
            getUuid: () => 'id', base64Encode: () => 'base64'
        }
    });
    let saved = {};
    ctx.sourceId_ = () => 'source';
    ctx.notion_ = (c, path, body, method) => {
        if (path.endsWith('/query'))
            return {
                results: [{
                        id: 'page'
                    }]
            };
        if (method === 'patch') {
            saved = body.properties;
            return {
                id: 'page'
            };
        }
        return {
            properties: saved
        };
    };
    ctx.aiText_ = () => '回答';
    return {
        ctx, book, sheets, props, store, c: {
            ...c, p: {}, notionQuestionDateType: 'date'
        }, messages: [{
                ts: '101', text: '質問', user: 'U1'
            }, {
                ts: '102', text: '新回答', user: 'U2'
            }]
    };
}
for (const type of ['date', 'created_time', 'rich_text']) {
    test('Notion新規作成で実際の質問日時型を扱う: ' + type, () => {
        const f = adapterFixture();
        delete f.c.notionQuestionDateType;
        let saved, schemaReads = 0, creates = 0;
        f.ctx.notion_ = (c, path, body, method) => {
            if (path === 'data_sources/source') {
                assert.equal(method, 'get');
                schemaReads++;
                return { properties: { '質問日時': { type } } };
            }
            if (path.endsWith('/query')) return { results: [] };
            if (path === 'pages') {
                creates++;
                saved = body.properties;
                return { id: 'created' };
            }
            return { properties: saved };
        };
        if (type === 'rich_text') {
            assert.throws(() => f.ctx.sync_(f.c, f.book, 'CQ', f.messages, '300'), /NOTION_QUESTION_DATE_SCHEMA/);
            assert.equal(creates, 0);
            assert.equal(f.props.NOTION_CREATE_PENDING, undefined);
        } else {
            f.ctx.sync_(f.c, f.book, 'CQ', f.messages, '300');
            assert.equal(creates, 1);
            assert.equal(saved['タイムスタンプ'].rich_text[0].text.content, '101');
            if (type === 'date') assert.equal(saved['質問日時'].date.start, '1970-01-01T00:01:41.000Z');
            else assert.equal(Object.hasOwn(saved, '質問日時'), false);
            assert.equal(f.sheets.GAS_SYNC_STATE.data[0][2], 'COMPLETE');
            f.ctx.notionQuestionDateType_(f.c);
        }
        assert.equal(schemaReads, 1);
    });
}
test('Sheetsの手編集列保持、日本時間H列、新世代sync後の古いsnapshotを抑止', () => {
    const f = adapterFixture();
    f.ctx.sync_(f.c, f.book, 'CQ', f.messages, '200');
    assert.equal(f.sheets.QA.data[1][7], '1970-01-01 09:01');
    for (const i of [1, 2, 4, 7, 8])
        f.sheets.QA.data[1][i] = '手編集' + i;
    f.sheets.QA.data[1][8] = '101';
    f.ctx.sync_(f.c, f.book, 'CQ', [f.messages[0], {
            ts: '103', text: '最新回答'
        }], '300');
    assert.equal(f.sheets.QA.data[1][1], '手編集1');
    assert.equal(f.sheets.QA.data[1][7], '手編集7');
    f.ctx.sync_(f.c, f.book, 'CQ', f.messages, '200');
    assert.equal(f.sheets.QA.data[1][9], '最新回答');
    assert.equal(f.sheets.GAS_SYNC_STATE.data[0][1], '300');
});
test('Notion失敗後のPENDING watermarkも古いlaneを防ぎ、新世代再試行できる', () => {
    const f = adapterFixture();
    const original = f.ctx.notion_;
    f.ctx.notion_ = () => {
        throw Error('HTTP_503');
    };
    assert.throws(() => f.ctx.sync_(f.c, f.book, 'CQ', f.messages, '300'), /HTTP_503/);
    assert.equal(f.sheets.GAS_SYNC_STATE.data[0][2], 'PENDING');
    f.ctx.sync_(f.c, f.book, 'CQ', [f.messages[0]], '200');
    assert.equal(f.sheets.QA.data[1][9], '新回答');
    f.ctx.notion_ = original;
    f.ctx.sync_(f.c, f.book, 'CQ', f.messages, '300');
    assert.equal(f.sheets.GAS_SYNC_STATE.data[0][2], 'COMPLETE');
});
test('別threadのNotion更新で不確かな作成pendingを消さない', () => {
    const f = adapterFixture();
    f.props.NOTION_CREATE_PENDING = '999';
    f.ctx.sync_(f.c, f.book, 'CQ', f.messages, '300');
    assert.equal(f.props.NOTION_CREATE_PENDING, '999');
    f.props.NOTION_CREATE_PENDING = '101';
    f.ctx.sync_(f.c, f.book, 'CQ', f.messages, '300');
    assert.equal(f.props.NOTION_CREATE_PENDING, undefined);
});
test('Slack投稿結果不明はPOSTINGを残し再投稿せず停止', () => {
    const f = adapterFixture();
    let count = 0;
    f.ctx.slack_ = () => {
        count++;
        throw Error('NETWORK_UNCERTAIN');
    };
    assert.throws(() => f.ctx.answer_(f.c, f.book, 'CQ', f.messages[0], []), /NETWORK_UNCERTAIN/);
    assert.equal(f.sheets.GAS_AI_JOURNAL.data[0][1], 'POSTING');
    assert.throws(() => f.ctx.answer_(f.c, f.book, 'CQ', f.messages[0], []), /RECONCILE/);
    assert.equal(count, 1);
});
test('Slack429後はPREPAREDから再送、読戻し成功後SENTを再処理しない', () => {
    const f = adapterFixture();
    f.ctx.slack_ = () => {
        throw Error('RATE_LIMITED');
    };
    assert.throws(() => f.ctx.answer_(f.c, f.book, 'CQ', f.messages[0], []), /RATE_LIMITED/);
    assert.equal(f.sheets.GAS_AI_JOURNAL.data[0][1], 'PREPARED');
    let posts = 0;
    f.ctx.slack_ = (c, method) => method === 'chat.postMessage' ? (posts++, {
        ts: '999'
    }) : {
        messages: [{
                ts: '999', user: 'UB'
            }]
    };
    f.ctx.answer_(f.c, f.book, 'CQ', f.messages[0], []);
    assert.equal(f.sheets.GAS_AI_JOURNAL.data[0][1], 'SENT');
    f.ctx.answer_(f.c, f.book, 'CQ', f.messages[0], []);
    assert.equal(posts, 1);
    assert.ok(f.props.LAST_AI_ACCEPTED);
});
test('Slack投稿後のreadback失敗もPOSTING保留', () => {
    const f = adapterFixture();
    f.ctx.slack_ = (c, method) => method === 'chat.postMessage' ? {
        ts: '999'
    } : {
        messages: []
    };
    assert.throws(() => f.ctx.answer_(f.c, f.book, 'CQ', f.messages[0], []), /VERIFY_FAILED/);
    assert.equal(f.sheets.GAS_AI_JOURNAL.data[0][1], 'POSTING');
    assert.equal(f.props.LAST_AI_ACCEPTED, undefined);
});
test('新着/過去laneは別stageで途中再開し相互に混ざらない', () => {
    const f = adapterFixture();
    f.ctx.slack_ = (c, method, args) => method === 'conversations.history' ? {
        messages: [{
                ts: args.oldest === '100' ? '101' : '1'
            }]
    } : {
        messages: [{
                ts: args.ts, text: '質問'
            }]
    };
    let recent = {}, deep = {};
    f.c.oldest = '100';
    const ri = f.ctx.io_(f.c, f.book, 'recent');
    for (let i = 0; i < 3; i++)
        recent = qa.step(recent, ri, f.c);
    f.c.oldest = '0';
    const di = f.ctx.io_(f.c, f.book, 'deep');
    for (let i = 0; i < 3; i++)
        deep = qa.step(deep, di, f.c);
    assert.equal(ri.staged()[0].ts, '101');
    assert.equal(di.staged()[0].ts, '1');
    recent = qa.step(JSON.parse(JSON.stringify(recent)), ri, f.c);
    deep = qa.step(JSON.parse(JSON.stringify(deep)), di, f.c);
    assert.equal(recent.thread.synced, true);
    assert.equal(deep.thread.synced, true);
    assert.equal(f.sheets.GAS_SYNC_STATE.data.length, 2);
});
test('pollは失敗lane/channel/threadを本文なしで保存、進捗を保持', () => {
    const f = adapterFixture();
    Object.assign(f.props, {
        ENABLED: 'true', HEALTH_EMAIL: 'self@example.invalid', LAST_HEALTH_MAIL_DAY: new Date().toISOString().slice(0, 10), RECENT_STATE: JSON.stringify({
            latest: '200', thread: {
                ts: '101', done: true
            }, parents: ['101'], index: 0
        })
    });
    f.ctx.config_ = () => ({
        ...f.c, p: f.props
    });
    f.ctx.LockService = {
        getScriptLock: () => ({
            tryLock: () => true, releaseLock() {
            }
        })
    };
    f.ctx.MailApp = {
        sendEmail() {
        }
    };
    f.ctx.ScriptApp = {
        getProjectTriggers: () => []
    };
    f.ctx.io_ = () => ({
        sync() {
            throw Error('HTTP_503');
        }, staged: () => f.messages
    });
    const before = f.props.RECENT_STATE;
    assert.throws(() => f.ctx.pollSalesQa(), /HTTP_503/);
    assert.equal(f.props.RECENT_STATE, before);
    const health = JSON.parse(f.props.HEALTH);
    assert.equal(health.lane, 'recent');
    assert.equal(health.channel, 'CQ');
    assert.equal(health.thread, '101');
    assert.ok(!JSON.stringify(health).includes('新回答'));
});
test('画像4枚目と非対応形式は未読枚数を回答に明示する', () => {
    const f = adapterFixture();
    vm.runInContext(fs.readFileSync(require.resolve('../gas/Main.js'), 'utf8'), f.ctx);
    Object.assign(f.c.p, {
        AI_BACKEND: 'claude', NOTEBOOKLM_MIGRATION_ACK: 'true', ANTHROPIC_API_KEY: 'secret'
    });
    f.ctx.UrlFetchApp = {
        fetch: () => ({
            getResponseCode: () => 200, getBlob: () => ({
                getBytes: () => [1, 2]
            })
        })
    };
    let images;
    f.ctx.request_ = (url, method, headers, payload) => {
        images = payload.messages[0].content.filter(x => x.type === 'image');
        return {
            stop_reason: 'end_turn', content: [{
                    type: 'text', text: '回答'
                }]
        };
    };
    const files = Array.from({
        length: 4
    }, () => ({
        mimetype: 'image/png', size: 2, url_private: 'https://files.slack.com/test'
    }));
    files.push({
        mimetype: 'image/svg+xml'
    });
    const answer = f.ctx.aiText_(f.c, f.book, {
        ts: '101', text: '質問', files
    });
    assert.equal(images.length, 3);
    assert.match(answer, /添付画像2枚は未確認/);
});
test('Notion作成後GET失敗でも既知page IDから再開し検索反映待ちの再POSTをしない', () => {
    const f = adapterFixture();
    let posts = 0, queries = 0, fail = true, saved;
    f.ctx.notion_ = (c, path, body, method) => {
        if (path.endsWith('/query')) {
            queries++;
            return {
                results: []
            };
        }
        if (path === 'pages') {
            posts++;
            saved = body.properties;
            return {
                id: 'created'
            };
        }
        if (method === 'patch') {
            assert.equal(path, 'pages/created');
            saved = body.properties;
            return {
                id: 'created'
            };
        }
        if (fail)
            throw Error('HTTP_503');
        return {
            properties: saved
        };
    };
    assert.throws(() => f.ctx.sync_(f.c, f.book, 'CQ', f.messages, '300'), /HTTP_503/);
    assert.equal(f.sheets.GAS_SYNC_STATE.data[0][3], 'created');
    assert.equal(f.props.NOTION_CREATE_PENDING, '101');
    fail = false;
    f.ctx.sync_(f.c, f.book, 'CQ', f.messages, '300');
    assert.equal(posts, 1);
    assert.equal(queries, 1);
    assert.equal(f.props.NOTION_CREATE_PENDING, undefined);
});
test('Notion作成成功後ID保存前の停止でもpendingを維持し検索0なら保留', () => {
    const f = adapterFixture();
    let posts = 0;
    f.ctx.notion_ = (c, path) => path.endsWith('/query') ? {
        results: []
    } : (posts++, {
        id: 'created'
    });
    const raw = f.ctx.rawCell_;
    f.ctx.rawCell_ = (sheet, row, col, value) => {
        if (sheet === f.sheets.GAS_SYNC_STATE && col === 4)
            throw Error('STORE_FAILED');
        return raw(sheet, row, col, value);
    };
    assert.throws(() => f.ctx.sync_(f.c, f.book, 'CQ', f.messages, '300'), /STORE_FAILED/);
    assert.equal(f.props.NOTION_CREATE_PENDING, '101');
    f.ctx.rawCell_ = raw;
    assert.throws(() => f.ctx.sync_(f.c, f.book, 'CQ', f.messages, '300'), /NOTION_CREATE_RECONCILE/);
    assert.equal(posts, 1);
});
test('削除済みthreadだけ先へ進め権限エラーでは止まる', () => {
    const f = fixture();
    let deleted = [];
    f.io.deleted = (ch, ts) => deleted.push(ts);
    f.io.replies = () => {
        throw Error('SLACK_THREAD_NOT_FOUND');
    };
    const state = {
        latest: '200', thread: {
            ts: '101'
        }, index: 0
    };
    const result = qa.step(state, f.io, c);
    assert.equal(result.index, 1);
    assert.deepEqual(deleted, ['101']);
    f.io.replies = () => {
        throw Error('SLACK_NOT_IN_CHANNEL');
    };
    assert.throws(() => qa.step({
        latest: '200', thread: {
            ts: '101'
        }, index: 0
    }, f.io, c), /NOT_IN_CHANNEL/);
});
test('システム投稿を除外しWorkflowはhistoryに残す', () => {
    const f = fixture();
    f.io.history = () => ({
        messages: [{
                ts: '1', subtype: 'tombstone'
            }, {
                ts: '2', subtype: 'channel_topic', text: '<@UB>'
            }, {
                ts: '3', subtype: 'bot_message', bot_id: 'WF'
            }]
    });
    assert.deepEqual(qa.step({}, f.io, c).parents, ['3']);
    assert.equal(qa.candidate({
        ts: '101', subtype: 'channel_purpose', text: '質問'
    }, 'CA', c), false);
});
test('AI空回答はFAILEDを保存し巡回し直しても再課金しない、PREPAREDで明示再試行', () => {
    const f = adapterFixture();
    let calls = 0;
    f.ctx.aiText_ = () => {
        calls++;
        throw Error('AI_EMPTY');
    };
    assert.throws(() => f.ctx.answer_(f.c, f.book, 'CQ', f.messages[0], []), /AI_EMPTY/);
    assert.equal(f.sheets.GAS_AI_JOURNAL.data[0][1], 'FAILED');
    f.ctx.answer_(f.c, f.book, 'CQ', f.messages[0], []);
    assert.equal(calls, 1);
    f.sheets.GAS_AI_JOURNAL.data[0][1] = 'PREPARED';
    assert.throws(() => f.ctx.answer_(f.c, f.book, 'CQ', f.messages[0], []));
    assert.equal(calls, 2);
    f.sheets.GAS_AI_JOURNAL.data[0][1] = 'SKIP';
    f.ctx.answer_(f.c, f.book, 'CQ', f.messages[0], []);
    assert.equal(calls, 2);
});
test('既知返信tsのPOSTINGは読戻しだけ再試行する', () => {
    const f = adapterFixture();
    f.sheets.GAS_AI_JOURNAL.data.push(['CQ:101', 'POSTING', '回答', '999']);
    let methods = [];
    f.ctx.slack_ = (c, method) => {
        methods.push(method);
        return {
            messages: [{
                    ts: '999', user: 'UB'
                }]
        };
    };
    f.ctx.answer_(f.c, f.book, 'CQ', f.messages[0], []);
    assert.deepEqual(methods, ['conversations.replies']);
    assert.equal(f.sheets.GAS_AI_JOURNAL.data[0][1], 'SENT');
});
test('Slack確定拒否はPREPARED、Notion確定400は作成保留解除', () => {
    const f = adapterFixture();
    f.ctx.slack_ = () => {
        throw Error('SLACK_CHANNEL_NOT_FOUND');
    };
    assert.throws(() => f.ctx.answer_(f.c, f.book, 'CQ', f.messages[0], []));
    assert.equal(f.sheets.GAS_AI_JOURNAL.data[0][1], 'PREPARED');
    f.ctx.notion_ = (c, path) => {
        if (path.endsWith('/query'))
            return {
                results: []
            };
        throw Error('HTTP_400');
    };
    assert.throws(() => f.ctx.sync_(f.c, f.book, 'CQ', f.messages, '300'));
    assert.equal(f.props.NOTION_CREATE_PENDING, undefined);
});
test('画像のsize欠落/容量超過/404は未読表示で回答継続', () => {
    const f = adapterFixture();
    vm.runInContext(fs.readFileSync(require.resolve('../gas/Main.js'), 'utf8'), f.ctx);
    Object.assign(f.c.p, {
        AI_BACKEND: 'claude', NOTEBOOKLM_MIGRATION_ACK: 'true', ANTHROPIC_API_KEY: 'secret'
    });
    f.ctx.UrlFetchApp = {
        fetch: () => ({
            getResponseCode: () => 404
        })
    };
    f.ctx.request_ = () => ({
        stop_reason: 'end_turn', content: [{
                type: 'text', text: '回答'
            }]
    });
    const files = [{
            mimetype: 'image/png', url_private: 'https://files.slack.com/x'
        }, {
            mimetype: 'image/png', size: 5000000, url_private: 'https://files.slack.com/x'
        }, {
            mimetype: 'image/png', size: 2, url_private: 'https://files.slack.com/x'
        }];
    assert.match(f.ctx.aiText_(f.c, f.book, {
        text: '質問', files
    }), /添付画像3枚は未確認/);
});
test('日次実測上限に達した日は外部処理せず繰越する', () => {
    const f = adapterFixture();
    Object.assign(f.props, {
        ENABLED: 'true', DAILY_RUNTIME: JSON.stringify({
            startedAt: Date.now() - 1000, ms: 14400000
        })
    });
    f.ctx.config_ = () => ({
        ...f.c, p: f.props
    });
    f.ctx.LockService = {
        getScriptLock: () => ({
            tryLock: () => true, releaseLock() {
            }
        })
    };
    f.ctx.io_ = () => {
        throw Error('外部処理禁止');
    };
    f.ctx.pollSalesQa();
    const h = JSON.parse(f.props.HEALTH);
    assert.equal(h.code, 'DAILY_RUNTIME_LIMIT');
    assert.equal(h.status, 'deferred');
});
test('空cursorを送らず、rich textの途中サロゲートを切り落とす', () => {
    const ctx = runtime({
        UrlFetchApp: {
            fetch: (url) => {
                assert.ok(!url.includes('cursor='));
                return {
                    getResponseCode: () => 200, getContentText: () => '{"ok":true}'
                };
            }
        }
    });
    ctx.slack_({
        p: {
            SLACK_READ_TOKEN: 'read'
        }
    }, 'conversations.history', {
        channel: 'CQ', cursor: ''
    });
    assert.equal(ctx.rich_('a'.repeat(1999) + '😀')[0].text.content.length, 1999);
});
test('実行予算は24時間後に解除されて巡回を再開する', () => {
    const f = adapterFixture();
    Object.assign(f.props, {
        ENABLED: 'true', HEALTH_EMAIL: 'self@example.invalid', LAST_HEALTH_MAIL_DAY: new Date().toISOString().slice(0, 10), DAILY_RUNTIME: JSON.stringify({
            startedAt: Date.now() - 86400001, ms: 14400000
        })
    });
    f.ctx.config_ = () => ({
        ...f.c, p: f.props
    });
    f.ctx.LockService = {
        getScriptLock: () => ({
            tryLock: () => true, releaseLock() {
            }
        })
    };
    let calls = 0;
    f.ctx.io_ = () => ({
        now: Date.now, history: () => {
            calls++;
            return {
                messages: []
            };
        }, cycleComplete() {
        }
    });
    f.ctx.pollSalesQa();
    assert.equal(calls, 2);
    assert.equal(JSON.parse(f.props.HEALTH).status, 'ok');
    assert.ok(JSON.parse(f.props.DAILY_RUNTIME).ms < 14400000);
});
test('Drive資料はダウンロード前に容量と形式を確認する', () => {
    const f = adapterFixture();
    vm.runInContext(fs.readFileSync(require.resolve('../gas/Main.js'), 'utf8'), f.ctx);
    Object.assign(f.c.p, {
        AI_BACKEND: 'claude', NOTEBOOKLM_MIGRATION_ACK: 'true', ANTHROPIC_API_KEY: 'secret', SERVICE_MATERIALS_FILE_ID: 'file'
    });
    f.ctx.DriveApp = {
        getFileById: () => ({
            getSize: () => 1000001, getMimeType: () => 'text/plain', getBlob: () => {
                throw Error('読込禁止');
            }
        })
    };
    assert.throws(() => f.ctx.aiText_(f.c, f.book, {
        text: '質問'
    }), /MATERIAL_FILE_UNSUPPORTED/);
});
test('Slack内部失敗・timeout・未知拒否はPOSTINGを保ち再POSTしない', () => {
    for (const code of ['SLACK_INTERNAL_ERROR','SLACK_FATAL_ERROR','SLACK_REQUEST_TIMEOUT','SLACK_UNKNOWN_ERROR','HTTP_408']) {
        const f=adapterFixture();let posts=0;
        f.ctx.slack_=()=>{posts++;throw Error(code);};
        assert.throws(()=>f.ctx.answer_(f.c,f.book,'CQ',f.messages[0],[]));
        assert.equal(f.sheets.GAS_AI_JOURNAL.data[0][1],'POSTING',code);
        assert.throws(()=>f.ctx.answer_(f.c,f.book,'CQ',f.messages[0],[]),/SLACK_POST_RECONCILE/);
        assert.equal(posts,1,code);
    }
});
