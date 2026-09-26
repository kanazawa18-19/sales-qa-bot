const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function setup(code=200) {
  const p={HTTP_GCP_PROJECT:'test-project',HTTP_GCP_REGION:'asia-northeast1',HTTP_WORKER_URL:'https://worker.asia-northeast1.run.app',HTTP_TASKS_SERVICE_ACCOUNT:'caller@test-project.iam.gserviceaccount.com',HTTP_CLOCK_ENABLED:'true'};
  const calls=[]; let released=0;
  const context=vm.createContext({Date,console,PropertiesService:{getScriptProperties:()=>({getProperties:()=>p,getProperty:k=>p[k],setProperty:(k,v)=>p[k]=v})},LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>released++})},ScriptApp:{getOAuthToken:()=> 'fake'},UrlFetchApp:{fetch:(url,options)=>{calls.push({url,options});return {getResponseCode:()=>code,getContentText:()=> '{}'};}}});
  vm.runInContext(fs.readFileSync('gas/HttpClock.js','utf8'),context);
  return {p,calls,context,released:()=>released};
}
test('GAS時計は専用キューへOIDC付きで認証更新を1件送る',()=>{
  const s=setup();s.context.tickHttpNotebookAuth();
  const task=JSON.parse(s.calls[0].options.payload).task;
  assert.equal(task.httpRequest.oidcToken.audience,s.p.HTTP_WORKER_URL);
  assert.equal(task.httpRequest.url,s.p.HTTP_WORKER_URL+'/tasks/refresh-auth');
  assert.equal(task.dispatchDeadline,'300s');assert.equal(s.released(),1);
});
test('時計OFFでは外部通信しない',()=>{const s=setup();s.p.HTTP_CLOCK_ENABLED='false';s.context.tickHttpNotebookAuth();assert.equal(s.calls.length,0);});
test('同じ時刻の重複登録409は成功として扱う',()=>{const s=setup(409);s.context.tickHttpNotebookAuth();assert.ok(s.p.HTTP_CLOCK_LAST_DISPATCH);});
test('API拒否時も鍵を解放し成功時刻を残さない',()=>{const s=setup(403);assert.throws(()=>s.context.tickHttpNotebookAuth(),/HTTP_CLOCK_GOOGLE_403/);assert.equal(s.released(),1);assert.equal(s.p.HTTP_CLOCK_LAST_DISPATCH,undefined);});
