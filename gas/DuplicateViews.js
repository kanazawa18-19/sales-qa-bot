/* ページを消さず退避フラグで表示を分ける。既存プロパティ・本文・コメントは保持。 */
var QA_ARCHIVE_FIELD = 'QA重複退避';
function notionDuplicatePlan_() {
  var c=config_(), source=sourceId_(c), groups={}, cursor=null, turns=0;
  do {
    var q={page_size:100}; if(cursor) q.start_cursor=cursor;
    var r=notion_(c,'data_sources/'+source+'/query',q);
    if(!Array.isArray(r.results)) throw Error('DUPLICATE_LIST_INVALID');
    r.results.forEach(function(p) {
      var url=p.properties && p.properties.URL && p.properties.URL.url;
      if(!url) return;
      (groups[url] || (groups[url]=[])).push(p);
    });
    cursor=r.has_more?r.next_cursor:null;
    if(r.has_more&&!cursor || ++turns>=50&&cursor) throw Error('DUPLICATE_LIST_INCOMPLETE');
  } while(cursor);
  var fixed=rows_(sheet_(book_(c),'GAS_SYNC_STATE')).filter(function(r) {return r[2]==='COMPLETE';}).map(function(r) {return r[3];});
  var extra=[], canonical=[];
  Object.keys(groups).forEach(function(url) {
    if(groups[url].length<2) return;
    var chosen=groups[url].filter(function(p) {return fixed.indexOf(p.id)>=0;});
    if(chosen.length!==1) throw Error('DUPLICATE_CANONICAL_UNCERTAIN');
    canonical.push(chosen[0]);
    extra=extra.concat(groups[url].filter(function(p) {return p.id!==chosen[0].id;}));
  });
  return {c:c,source:source,extra:extra,canonical:canonical};
}
function previewNotionDuplicateViews() {
  var p=notionDuplicatePlan_();
  console.log(JSON.stringify({groups:p.canonical.length,extraPages:p.extra.length,
    alreadyMarked:p.extra.filter(function(x) {return (x.properties[QA_ARCHIVE_FIELD]||{}).checkbox===true;}).length}));
}
function notionViewsApi_(c,path,body) {
  return request_('https://api.notion.com/v1/'+path,body?'post':'get',
    {Authorization:'Bearer '+c.p.NOTION_TOKEN,'Notion-Version':'2026-03-11'},body);
}
function prepareNotionDuplicateViews() {
  var lock=LockService.getScriptLock();
  if(!lock.tryLock(1000)) throw Error('QA_BUSY');
  try {
    var deadline=Date.now()+180000, p=notionDuplicatePlan_(), c=p.c;
    if(p.canonical.length!==9 || p.extra.length!==53) throw Error('DUPLICATE_COUNT_CHANGED');
    // 新APIの読取が使えない場合、変更を始めない。
    var listed=notionViewsApi_(c,'views?database_id='+c.p.NOTION_DATABASE_ID);
    if(!Array.isArray(listed.results)||listed.has_more) throw Error('VIEW_LIST_INCOMPLETE');
    listed.results=listed.results.map(function(ref) {
      var id=(ref.view||ref).id;
      if(!id) throw Error('VIEW_REFERENCE_INVALID');
      return notionViewsApi_(c,'views/'+id);
    });
    var schema=notion_(c,'data_sources/'+p.source,undefined,'get').properties;
    var specs=[{name:'QA（重複整理済み）',archived:false},{name:'重複退避（元の記入を保持）',archived:true}];
    specs.forEach(function(v) {
      var matches=listed.results.filter(function(x) {return x.name===v.name;});
      if(matches.length>1) throw Error('DUPLICATE_VIEW_NAME');
      if(matches.length) {
        var view=matches[0], f=view.filter||{};
        if(view.data_source_id!==p.source || (f.property!==QA_ARCHIVE_FIELD && (!((schema[QA_ARCHIVE_FIELD]||{}).id) || f.property!==schema[QA_ARCHIVE_FIELD].id)) || !f.checkbox || f.checkbox.equals!==v.archived) throw Error('VIEW_CONFIGURATION_CONFLICT');
      }
    });
    if(schema[QA_ARCHIVE_FIELD] && schema[QA_ARCHIVE_FIELD].type!=='checkbox') throw Error('ARCHIVE_FIELD_CONFLICT');
    if(!schema[QA_ARCHIVE_FIELD]) {
      var columns={}; columns[QA_ARCHIVE_FIELD]={checkbox:{}};
      notion_(c,'data_sources/'+p.source,{properties:columns},'patch');
    }
    var book=book_(c), backup=book.getSheetByName('NOTION重複退避記録') || book.insertSheet('NOTION重複退避記録');
    var changed=0;
    p.canonical.forEach(function(page) {
      if((page.properties[QA_ARCHIVE_FIELD]||{}).checkbox===true) throw Error('CANONICAL_MARKED_AS_ARCHIVE');
    });
    p.extra.forEach(function(page) {
      if((page.properties[QA_ARCHIVE_FIELD]||{}).checkbox===true) return;
      if(Date.now()>deadline) throw Error('ARCHIVE_BATCH_PAUSED_RETRY');
      // 退避前の人手プロパティはQAブックへ文字列のまま保存。40,000文字ずつ分割。
      var snapshot=JSON.stringify({id:page.id,url:page.url,properties:page.properties});
      for(var i=0;i<snapshot.length;i+=40000) {
        var values=[page.id,new Date().toISOString(),String(i/40000),snapshot.slice(i,i+40000)];
        var row=appendRaw_(backup,values); SpreadsheetApp.flush();
        if(JSON.stringify(backup.getRange(row,1,1,4).getDisplayValues()[0])!==JSON.stringify(values)) throw Error('ARCHIVE_BACKUP_VERIFY_FAILED');
      }
      var properties={};properties[QA_ARCHIVE_FIELD]={checkbox:true};
      notion_(c,'pages/'+page.id,{properties:properties},'patch');
      var read=notion_(c,'pages/'+page.id,undefined,'get');
      if(!read.properties[QA_ARCHIVE_FIELD].checkbox) throw Error('ARCHIVE_FLAG_VERIFY_FAILED');
      changed++;
    });
    var viewIds=[];
    specs.forEach(function(v) {
      var matches=listed.results.filter(function(x) {return x.name===v.name;});
      if(matches.length>1) throw Error('DUPLICATE_VIEW_NAME');
      var view=matches[0];
      if(!view) view=notionViewsApi_(c,'views',{database_id:c.p.NOTION_DATABASE_ID,data_source_id:p.source,
        name:v.name,type:'table',configuration:{type:'table'},filter:{property:QA_ARCHIVE_FIELD,checkbox:{equals:v.archived}},position:{type:'end'}});
      viewIds.push({name:v.name,id:view.id});
    });
    console.log(JSON.stringify({groups:p.canonical.length,extraPages:p.extra.length,changed:changed,views:viewIds}));
  } finally {lock.releaseLock();}
}
// 退避したプロパティと現存ページを読み取り照合。本文・コメントは変更しない。
function verifyNotionDuplicateViews() {
  var p=notionDuplicatePlan_(), byId={}, parts={};
  p.extra.forEach(function(page) {byId[page.id]=page;});
  rows_(sheet_(book_(p.c),'NOTION重複退避記録')).forEach(function(r) {
    if(!parts[r[0]]) parts[r[0]]=[];
    parts[r[0]][Number(r[2])]=r[3];
  });
  function stable(x) {
    if(Array.isArray(x)) return '['+x.map(stable).join(',')+']';
    if(x&&typeof x==='object') return '{'+Object.keys(x).sort().map(function(k) {return JSON.stringify(k)+':'+stable(x[k]);}).join(',')+'}';
    return JSON.stringify(x);
  }
  var checked=0, differences=0;
  Object.keys(parts).forEach(function(id) {
    var before=JSON.parse(parts[id].join('')), after=byId[id];
    if(!after) throw Error('ARCHIVE_PAGE_MISSING');
    Object.keys(before.properties).forEach(function(k) {
      if(k!==QA_ARCHIVE_FIELD && stable(before.properties[k])!==stable(after.properties[k])) differences++;
    });
    checked++;
  });
  var marked=p.extra.filter(function(x) {return (x.properties[QA_ARCHIVE_FIELD]||{}).checkbox===true;}).length;
  var fixedMarked=p.canonical.filter(function(x) {return (x.properties[QA_ARCHIVE_FIELD]||{}).checkbox===true;}).length;
  console.log(JSON.stringify({backupPages:checked,extraPages:p.extra.length,marked:marked,fixedMarked:fixedMarked,propertyDifferences:differences}));
  if(p.extra.length!==53||p.canonical.length!==9||checked!==53||marked!==53||fixedMarked||differences) throw Error('ARCHIVE_VERIFY_FAILED');
}
