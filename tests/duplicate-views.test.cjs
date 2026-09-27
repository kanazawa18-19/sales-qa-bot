const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function fixture(failBackup=false, extraCount=53) {
 const fixed=Array.from({length:9},(_,i)=>'fixed'+i);
 const pages=fixed.concat(Array.from({length:extraCount},(_,i)=>'extra'+i)).map((id,i)=>({id,url:'notion',properties:{URL:{url:'slack'+(i<9?i:(i-9)%9)},担当:{rich_text:[{plain_text:id}]}}}));
 const cells=[],patches=[],views=[];
 const backup={getRange:r=>({getDisplayValues:()=>[failBackup?['broken']:cells[r-1]]})};
 const book={getSheetByName:()=>backup};
 const c={console:{log(){}},LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
 config_:()=>({p:{NOTION_DATABASE_ID:'db'}}),sourceId_:()=> 'source',book_:()=>book,sheet_:()=>({}),rows_:()=>fixed.map(id=>['key','1','COMPLETE',id]),
 appendRaw_:(s,v)=>cells.push(v),SpreadsheetApp:{flush(){}},
 notion_:(cfg,path,body,method)=>{
  if(path.endsWith('/query'))return {results:pages,has_more:false};
  if(path==='data_sources/source')return {properties:{QA重複退避:{type:'checkbox'}}};
  const p=pages.find(p=>path==='pages/'+p.id);assert.ok(p);
  if(method==='patch'){patches.push(body);Object.assign(p.properties,body.properties);}return p;
 }};
 vm.createContext(c);vm.runInContext(fs.readFileSync('gas/DuplicateViews.js','utf8'),c);
 c.notionViewsApi_=(cfg,path,body)=>{
  if(path.startsWith('views?'))return {results:views.map(v=>({view:{id:v.id}})),has_more:false};
  if(path==='views'){assert.equal(body.type,'table');const v={...body,id:'v'+views.length};views.push(v);return v;}
  return views.find(v=>path==='views/'+v.id);
 };
 return {c,pages,cells,patches,views};
}
test('重複だけ退避し既存プロパティを変えず再実行で二重退避しない',()=>{
 const f=fixture();const before=JSON.stringify(f.pages[0]);
 f.c.prepareNotionDuplicateViews();assert.equal(JSON.stringify(f.pages[0]),before);
 assert.equal(f.patches.length,53);assert.deepEqual(Object.keys(f.patches[0].properties),['QA重複退避']);
 assert.equal(f.pages[9].properties.担当.rich_text[0].plain_text,'extra0');
 assert.equal(JSON.parse(f.cells[0][3]).properties.担当.rich_text[0].plain_text,'extra0');
 assert.equal(f.views.length,2);f.c.prepareNotionDuplicateViews();assert.equal(f.patches.length,53);assert.equal(f.cells.length,53);assert.equal(f.views.length,2);
});
test('退避読戻し失敗ならページへ書かない',()=>{const f=fixture(true);assert.throws(()=>f.c.prepareNotionDuplicateViews(),/BACKUP/);assert.equal(f.patches.length,0);});
test('固定先不明なら書かない',()=>{const f=fixture();f.c.rows_=()=>[];assert.throws(()=>f.c.prepareNotionDuplicateViews(),/CANONICAL/);assert.equal(f.patches.length,0);});
test('同名ビューの条件が異なるなら書かない',()=>{const f=fixture();f.views.push({id:'v0',name:'QA（重複整理済み）',data_source_id:'source',filter:{}});assert.throws(()=>f.c.prepareNotionDuplicateViews(),/VIEW_CONFIGURATION/);assert.equal(f.patches.length,0);});
test('本番件数9組53頁から変われば退避前に停止する',()=>{
 const f=fixture(false,52);
 assert.throws(()=>f.c.prepareNotionDuplicateViews(),/DUPLICATE_COUNT_CHANGED/);assert.equal(f.patches.length,0);assert.equal(f.cells.length,0);
});
