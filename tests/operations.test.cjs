const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function setup(fail=false) {
 const p={GOOGLE_SPREADSHEET_ID:'book',ENABLED:'true',ACTIONS_CLOCK_ENABLED:'true',
  SLACK_BOT_TOKEN:'must-not-leak',ACTIONS_CLOCK_HEALTH:JSON.stringify({ok:true,checkedAt:'now',pendingAuthRequest:{requestId:'private'}}),
  HEALTH:JSON.stringify({status:'ok',durationMs:45000,thread:'private',requestId:'private'})};
 let values;
 const sheet={getRange:()=>({setNumberFormat(){return this;},setValues(v){if(fail)throw Error('secret');values=v;},getDisplayValue(){return values[0][1];}})};
 const ctx={console:{log(){}},PropertiesService:{getScriptProperties:()=>({getProperty:k=>p[k]})},
 SpreadsheetApp:{openById:()=>({getSheetByName:()=>null,insertSheet:()=>sheet}),flush(){}},
 ScriptApp:{getProjectTriggers:()=>['pollSalesQa','tickActionsClock'].map(n=>({getHandlerFunction:()=>n}))}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('gas/Operations.js','utf8'),ctx);
 return {ctx,read:()=>values};
}
test('公開するのは時刻・状態・登録数だけで秘密値や要求IDを含めない',()=>{
 const x=setup();x.ctx.publishQaHeartbeat_();const raw=x.read()[0][1],s=JSON.parse(raw);
 assert.equal(s.pollTriggers,1);assert.equal(s.clockTriggers,1);assert.equal(s.health.durationMs,45000);
 assert.doesNotMatch(raw,/must-not-leak|private|TOKEN|requestId|thread/);
});
test('heartbeat失敗は既存の時計処理へ伝播しない',()=>{
 const x=setup(true);assert.doesNotThrow(()=>x.ctx.publishQaHeartbeatSafely_());
 assert.throws(()=>x.ctx.inspectQaHeartbeat());
});
test('Notion全頁の読取だけで重複と固定先を数える',()=>{
 const x=setup();let calls=0;
 x.ctx.config_=()=>({});x.ctx.sourceId_=()=> 'source';x.ctx.book_=()=>({});x.ctx.sheet_=()=>({});
 x.ctx.rows_=()=>[['key','1','COMPLETE','a']];
 x.ctx.notion_=(c,path,query)=>{
  calls++;assert.equal(path,'data_sources/source/query');
  return calls===1?{results:[{id:'a',properties:{URL:{url:'url'}}}],has_more:true,next_cursor:'next'}:
   {results:[{id:'b',properties:{URL:{url:'url'}}}],has_more:false};
 };
 const r=x.ctx.auditQaNotionDuplicates();assert.equal(calls,2);assert.equal(r.pages,2);
 assert.equal(r.extraPages,1);assert.equal(r.groupsWithFixedPage,1);
 assert.equal(x.read(),undefined);
});
