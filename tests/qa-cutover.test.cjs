const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function setup(initial = {}) {
  const p = {...initial}, tabs = [], calls = [];
  const props = {getProperty:k=>p[k] || null, setProperty:(k,v)=>p[k]=v,
    setProperties:v=>Object.assign(p,v), deleteProperty:k=>delete p[k]};
  const ctx = vm.createContext({console:{log(){}},PropertiesService:{getScriptProperties:()=>props},
    LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
    config_:()=>({p:{...p}}), book_:()=>({}), sheet_:(b,n)=>({name:n,clearContents(){tabs.push(n);}}),
    rows_:s=>s.name==='STATE'?[['last_processed_ts','123.45']]:[],
    prepareSalesQa:()=>calls.push('prepare'),installSalesQaTrigger:()=>calls.push('install')});
  vm.runInContext(fs.readFileSync('gas/QaCutover.js','utf8'),ctx);
  ctx.inspectQaProduction=()=>calls.push('inspect');
  return {ctx,p,tabs,calls};
}
test('有効な記録や不明なNotion作成があれば本番準備を拒否',()=>{
  for(const p of [{ENABLED:'true'},{NOTION_CREATE_PENDING:'123'}]) {
    const x=setup(p);assert.throws(()=>x.ctx.prepareQaProduction());assert.deepEqual(x.calls,[]);
    assert.equal(x.p.GOOGLE_SPREADSHEET_ID,undefined);
  }
});
test('準備は既存鍵とActions時計と同期IDを保持し検証先の巡回位置だけを解除',()=>{
  const x=setup({ENABLED:'false',SLACK_READ_TOKEN:'dummy',ACTIONS_CLOCK_ENABLED:'true',
    SCAN_STATE:'old',RECENT_STATE:'old',NOTION_DATA_SOURCE_ID:'old'});
  x.ctx.prepareQaProduction();assert.equal(x.p.SLACK_READ_TOKEN,'dummy');
  assert.equal(x.p.ACTIONS_CLOCK_ENABLED,'true');assert.equal(x.p.ENABLED,'false');
  assert.equal(x.p.SCAN_STATE,undefined);assert.equal(x.p.NOTION_DATA_SOURCE_ID,undefined);
  assert.equal(x.p.RECENT_THROUGH_TS,'123.45');
  assert.deepEqual(x.tabs,['GAS_STAGE','GAS_STAGE_RECENT']);
});
test('準備前や保存先の不一致では開始しない',()=>{
  const x=setup();assert.throws(()=>x.ctx.startQaProduction(),/QA_PREPARE_REQUIRED/);
  x.p.QA_PRODUCTION_PREPARED='true';assert.throws(()=>x.ctx.startQaProduction(),/QA_TARGET_MISMATCH/);
  assert.equal(x.p.ENABLED,undefined);assert.deepEqual(x.calls,[]);
});
test('登録失敗は記録を無効へ戻しActions時計は保持',()=>{
  const x=setup({ACTIONS_CLOCK_ENABLED:'true'});Object.assign(x.p,x.ctx.QA_PRODUCTION,{QA_PRODUCTION_PREPARED:'true'});
  x.ctx.installSalesQaTrigger=()=>{throw Error('FAILED');};
  assert.throws(()=>x.ctx.startQaProduction(),/FAILED/);assert.equal(x.p.ENABLED,'false');
  assert.equal(x.p.ACTIONS_CLOCK_ENABLED,'true');
});
test('確認済みの保存先で記録開始し時計を保持',()=>{
  const x=setup({ACTIONS_CLOCK_ENABLED:'true'});Object.assign(x.p,x.ctx.QA_PRODUCTION,{QA_PRODUCTION_PREPARED:'true'});
  x.ctx.startQaProduction();assert.equal(x.p.ENABLED,'true');assert.deepEqual(x.calls,['install']);
  assert.equal(x.p.ACTIONS_CLOCK_ENABLED,'true');
});

test('再準備が途中失敗した場合は以前の準備完了フラグを解除',()=>{
 const x=setup({QA_PRODUCTION_PREPARED:'true'});
 x.ctx.inspectQaProduction=()=>{throw Error('HTTP_403');};
 assert.throws(()=>x.ctx.prepareQaProduction(),/HTTP_403/);
 assert.equal(x.p.QA_PRODUCTION_PREPARED,undefined);
 assert.throws(()=>x.ctx.startQaProduction(),/QA_PREPARE_REQUIRED/);
});

test('最近のSTATEや未設定でも少なくとも24時間前まで重ねて読む',()=>{
 for(const values of [[],[['last_processed_ts',String(Date.now()/1000)]]]) {
  const x=setup();x.ctx.rows_=()=>values;const before=Date.now()/1000 - 86400;
  x.ctx.prepareQaProduction();assert.ok(Number(x.p.RECENT_THROUGH_TS)>=before);
  assert.ok(Number(x.p.RECENT_THROUGH_TS)<=Date.now()/1000-86400);
 }
});
test('本番ヘッダーとNotion列型が一致しなければ読取確認を拒否',()=>{
 const headers=['サービス','質問内容','質問背景','URL','質問者','回答者','画像','送信日時','タイムスタンプ','回答テキスト'];
 const types={'サービス':'rich_text','URL':'url','回答者':'rich_text','回答テキスト':'rich_text','質問の内容':'title','タイムスタンプ':'rich_text','質問者':'rich_text'};
 const x=setup();vm.runInContext(fs.readFileSync('gas/QaCutover.js','utf8'),x.ctx);
 x.ctx.rows_=()=>[headers];x.ctx.sourceId_=()=> 'source';
 x.ctx.notionQuestionDateType_=()=> 'created_time';
 const schema=Object.fromEntries(Object.entries(types).map(([k,type])=>[k,{type}]));
 x.ctx.notion_=()=>({properties:schema});
 x.ctx.slack_=(c,method)=>method==='conversations.info'?{channel:{id:c.qa,name:'QA'}}:{messages:[]};
 assert.equal(x.ctx.inspectQaProduction().notionSource,'source');
 headers[0]='別列';assert.throws(()=>x.ctx.inspectQaProduction(),/QA_HEADERS_MISMATCH/);
 headers[0]='サービス';schema['URL'].type='rich_text';
 assert.throws(()=>x.ctx.inspectQaProduction(),/QA_NOTION_SCHEMA_MISMATCH/);
 assert.deepEqual(x.p,{});
});
test('実記録の読戻しは両保存先1件・回答一致を要求する',()=>{
 const x=setup({GOOGLE_SHEET_NAME:'シート1'}), url='https://example/p12345';
 let qa=[['サービス','','',url,'','回答者','','','123.45','回答']];
 const page={id:'page',properties:{'サービス':{rich_text:[{plain_text:'サービス'}]},'回答者':{rich_text:[{plain_text:'回答者'}]},'回答テキスト':{rich_text:[{plain_text:'回答'}]},URL:{url}}};
 x.ctx.rows_=s=>s.name==='GAS_SYNC_STATE'?[['CQ:123.45','200','COMPLETE','page']]:qa;
 x.ctx.sourceId_=()=> 'source';x.ctx.rich_=v=>[{text:{content:String(v)}}];
 x.ctx.notion_=(c,path)=>path.endsWith('/query')?{results:[page]}:page;
 assert.equal(x.ctx.verifyQaProduction().completeCount,1);
 page.properties['回答テキスト'].rich_text[0].plain_text='不一致';
 assert.throws(()=>x.ctx.verifyQaProduction(),/QA_NOTION_READBACK_MISMATCH/);
 qa.push(qa[0]);assert.throws(()=>x.ctx.verifyQaProduction(),/QA_READBACK_DUPLICATE/);
});
test('初回全履歴は限定予算を渡し通常設定を変更しない',()=>{
 const x=setup({RUN_BUDGET_SECONDS:'45'});let seen;
 x.ctx.pollSalesQaWithBudget_=v=>seen=v;x.ctx.continueQaInitialScan();
 assert.equal(seen,210);assert.equal(x.p.RUN_BUDGET_SECONDS,'45');
 x.ctx.pollSalesQaWithBudget_=()=>{throw Error('HTTP_503');};
 assert.throws(()=>x.ctx.continueQaInitialScan(),/HTTP_503/);
 assert.equal(x.p.RUN_BUDGET_SECONDS,'45');
});
