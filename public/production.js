/* MSFS Deal Production — client work desk (Overview charts + Queue + Pipeline), server-shared, all real clients. */
(function(){
var DOCS=['SSC','DL','POA','FTC','Data breach','Affidavit','Perm. purpose','Experian letter'];
var VAS=['Antoinette','Bri','Jasmine','Tori','—'];
var STAGES=['Onboarding','Ready','In rounds','Completed'];
var C={blue:'#3b82f6',green:'#45B369',gold:'#FF9F29',red:'#EF4A00',gray:'#D1D5DB',slate:'#6B7280'};
var CLIENTS=[], loaded=false, saveT=null, charts={};
var curView='overview', curFilter='all', curSearch='', curPage=1, PAGE=60, openId=null;
var MYNAME=null, MYROLE=null, openStamp=null, pollTimer=null, lockedFilter=false;
fetch('/api/me').then(function(r){return r.json();}).then(function(m){
  MYNAME=m&&m.name;
  MYROLE=m&&m.role;
  if(m&&m.role==='admin'){
    var btn=document.getElementById('pvReconcileBtn'); if(btn)btn.style.display='';
    var sbtn=document.getElementById('pvSheetBtn'); if(sbtn)sbtn.style.display='';
  }
  // Employee (or an Admin previewing as one, since m.role is the EFFECTIVE
  // role -- see GET /api/me in server.js): pvNavBtn ("Deal Production")
  // stays exactly as Admin sees it -- the real top-level Pipeline view is
  // now open to employees too (see index.html's pipelineNavBtn + role.js),
  // so there's no need to relabel this one to stand in for it anymore.
  // Just add the locked New Clients queue button.
  // Any non-admin holding production, not just role==='employee' -- a VA has
  // the same job here and was being skipped by a role-name check.
  var caps=(m&&Array.isArray(m.capabilities))?m.capabilities:[];
  if(caps.indexOf('admin')<0&&caps.indexOf('production')>=0){
    var navCl=document.getElementById('navClients');
    if(navCl&&!document.getElementById('pvNewClientsBtn')){
      var nb=document.createElement('button');nb.id='pvNewClientsBtn';nb.setAttribute('onclick','pvGoNewClients()');
      nb.innerHTML='<span class="ico2"><i class="ri-user-add-line"></i></span>New Clients';
      navCl.appendChild(nb);
    }
  }
}).catch(function(){});

/* ---------- styles ---------- */
var css=''+
'#view-production .pv-sub{color:var(--muted);font-size:12.5px;margin:2px 0 14px;max-width:960px}'+
'#view-production .pv-tabs{display:inline-flex;border:1px solid var(--line);border-radius:9px;overflow:hidden;margin-bottom:14px}'+
'#view-production .pv-tabs button{border:none;background:var(--card);padding:8px 18px;font-size:12.5px;font-weight:700;cursor:pointer;color:var(--muted)}'+
'#view-production .pv-tabs button.on{background:var(--inverse-bg);color:var(--inverse-ink)}'+
'#view-production .pv-kpis{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin-bottom:16px}'+
'#view-production .pv-kpi{background:var(--card);border:none;border-radius:8px;box-shadow:0 0.25rem 1.875rem rgba(46,45,116,.05);padding:13px 15px}'+
'#view-production .pv-kpi .l{font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}'+
'#view-production .pv-kpi .v{font-size:24px;font-weight:800;margin-top:6px;letter-spacing:-.5px}'+
'#view-production .pv-kpi.alert{background:var(--red-soft);border-color:#F9B5C6}#view-production .pv-kpi.alert .v{color:var(--red)}'+
'#view-production .pv-kpi.good .v{color:var(--green)}'+
'#view-production .pv-grid2{display:grid;grid-template-columns:1.15fr .85fr;gap:16px;margin-bottom:16px}'+
'#view-production .pv-grid11{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}'+
'#view-production .pv-card{background:var(--card);border:none;border-radius:8px;box-shadow:0 0.25rem 1.875rem rgba(46,45,116,.05);padding:16px 18px}'+
'#view-production .pv-card h3{margin:0 0 3px;font-size:14px}#view-production .pv-card .cap{color:var(--muted);font-size:12px;margin:0 0 12px}'+
'#view-production .pv-wrap{position:relative;height:250px}#view-production .pv-wrap.sm{height:210px}'+
'#view-production .pv-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;flex-wrap:wrap}'+
'#view-production .pv-tools{display:flex;align-items:center;gap:12px;flex:1;min-width:240px}'+
'#view-production .pv-tools input{flex:1;max-width:340px;padding:9px 13px;border:1px solid var(--line);border-radius:9px;font-size:13px;background:var(--card);color:var(--ink)}'+
'#view-production .pv-count{font-size:12px;color:var(--muted);white-space:nowrap}'+
'#view-production .pv-chips{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 12px}'+
'#view-production .pv-chip{cursor:pointer;border:1px solid var(--line);background:var(--card);border-radius:20px;padding:7px 13px;font-size:12.5px;font-weight:600;display:flex;gap:7px;align-items:center;color:var(--ink)}'+
'#view-production .pv-chip.active{background:var(--inverse-bg);color:var(--inverse-ink);border-color:var(--inverse-bg)}'+
'#view-production .pv-chip .n{font-size:11px;opacity:.65;font-variant-numeric:tabular-nums}'+
'#view-production .pv-chip .dotc{width:8px;height:8px;border-radius:50%}'+
'#view-production .pv-tablewrap{background:var(--card);border:none;border-radius:8px;box-shadow:0 0.25rem 1.875rem rgba(46,45,116,.05);overflow:auto}'+
'#view-production table.pv-table{width:100%;border-collapse:collapse;font-size:12.5px}'+
'#view-production .pv-table th{position:sticky;top:0;background:var(--tile-bg);text-align:left;padding:10px 12px;font-size:10.5px;text-transform:uppercase;letter-spacing:.03em;color:var(--muted);border-bottom:1px solid var(--line);white-space:nowrap;z-index:1}'+
'#view-production .pv-table th.ctr,#view-production .pv-table td.ctr{text-align:center}'+
'#view-production .pv-table td{padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:middle}'+
'#view-production .pv-table tbody tr{cursor:pointer}#view-production .pv-table tbody tr:hover{background:var(--bg)}'+
'#view-production .pv-name{font-weight:700}#view-production .pv-pkg{color:var(--muted);font-size:11px;white-space:nowrap}'+
'#view-production .pill2{display:inline-block;padding:3px 9px;border-radius:20px;font-size:11px;font-weight:700;white-space:nowrap;line-height:1.3}'+
'#view-production .pv-done{background:var(--green-soft);color:var(--green-ink)}#view-production .pv-ready{background:var(--blue-soft);color:var(--blue-ink)}'+
'#view-production .pv-login{background:var(--red-soft);color:var(--red-ink)}#view-production .pv-none{background:var(--tile-bg);color:#9CA3AF}'+
'#view-production .pv-stg{display:inline-block;padding:3px 10px;border-radius:6px;font-size:11px;font-weight:700}'+
'#view-production .stg-onb{background:var(--tile-bg);color:var(--muted)}#view-production .stg-ready{background:var(--blue-soft);color:var(--blue-ink)}'+
'#view-production .stg-rounds{background:var(--green-soft);color:var(--green-ink)}#view-production .stg-done{background:var(--green-soft);color:var(--green-ink)}'+
'#view-production .pv-next{font-weight:600;white-space:nowrap}#view-production .pv-next.attn{color:var(--red)}'+
'#view-production .pv-doc{font-size:11px;font-weight:700}#view-production .doc-ok{color:var(--green-ink)}#view-production .doc-part{color:var(--gold)}#view-production .doc-no{color:var(--red)}'+
'#view-production .pv-mfsn{display:inline-block;padding:3px 9px;border-radius:20px;font-size:10.5px;font-weight:700;white-space:nowrap}'+
'#view-production .mfsn-yes{background:var(--green-soft);color:var(--green-ink)}#view-production .mfsn-no{background:var(--gold-soft);color:var(--gold-ink)}'+
'#view-production .pv-days{font-size:11.5px;color:var(--muted);white-space:nowrap}'+
'#view-production .pv-pager{display:flex;align-items:center;justify-content:space-between;margin-top:10px;font-size:12px;color:var(--muted)}'+
'#view-production .pv-pager button{border:1px solid var(--line);background:var(--card);border-radius:8px;padding:6px 12px;font-weight:700;cursor:pointer;color:var(--ink);font-size:12px}'+
'#view-production .pv-pager button:disabled{opacity:.4;cursor:default}'+
'#view-production .pv-board{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;align-items:start}'+
'#view-production .pv-col{background:var(--tile-bg);border-radius:12px;padding:10px;min-height:120px}'+
'#view-production .pv-col h4{margin:2px 4px 10px;font-size:12px;text-transform:uppercase;letter-spacing:.03em;color:var(--muted);display:flex;justify-content:space-between}'+
'#view-production .pv-ccard{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-bottom:9px;cursor:pointer}'+
'#view-production .pv-ccard.blk{border:1.5px solid var(--red)}'+
'#view-production .pv-ccard .cn{font-weight:700;font-size:12.5px}#view-production .pv-ccard .cp{color:var(--muted);font-size:11px;margin:1px 0 7px}'+
'#view-production .pv-ccard .cb{display:flex;gap:4px;margin-bottom:7px;flex-wrap:wrap}'+
'#view-production .pv-ccard .cf{display:flex;justify-content:space-between;font-size:11px;color:var(--muted)}'+
'#view-production .mini{font-size:10px;padding:2px 6px;border-radius:12px;font-weight:700}'+
'#view-production .pv-more{text-align:center;font-size:11.5px;color:var(--muted);padding:6px}'+
'#view-production .pv-foot{font-size:11.5px;color:var(--muted);margin-top:12px}'+
'#pvOverlay{position:fixed;inset:0;background:rgba(0,0,0,.34);display:none;z-index:60}'+
'#pvDrawer{position:fixed;top:0;right:0;height:100vh;width:430px;max-width:94vw;background:var(--bg);box-shadow:-8px 0 30px rgba(0,0,0,.18);transform:translateX(100%);transition:transform .18s ease;z-index:61;display:flex;flex-direction:column}'+
'#pvDrawer.open{transform:none}'+
'#pvDrawer .dh{padding:18px 20px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:flex-start}'+
'#pvDrawer .dh .nm{font-size:19px;font-weight:800}#pvDrawer .dh .mt{font-size:12px;color:var(--muted);margin-top:3px}'+
'#pvDrawer .dx{border:none;background:none;font-size:20px;cursor:pointer;color:var(--muted);line-height:1}'+
'#pvDrawer .db{padding:16px 20px;overflow:auto;flex:1}'+
'#pvDrawer .sec{font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:700;margin:16px 0 8px}#pvDrawer .sec:first-child{margin-top:0}'+
'#pvDrawer .fld{display:flex;align-items:center;gap:10px;margin-bottom:9px}#pvDrawer .fld label{width:96px;font-size:12px;color:var(--muted);flex-shrink:0}'+
'#pvDrawer select,#pvDrawer input[type=number]{padding:6px 9px;border:1px solid var(--line);border-radius:7px;background:var(--card);font-size:12.5px;color:var(--ink)}'+
'#pvDrawer .brow{display:grid;grid-template-columns:78px 60px 1fr;gap:8px;align-items:center;margin-bottom:8px}#pvDrawer .brow b{font-size:12px}'+
'#pvDrawer .docs{display:grid;grid-template-columns:1fr 1fr;gap:6px 12px}#pvDrawer .docs label{display:flex;align-items:center;gap:7px;font-size:12.5px;cursor:pointer}'+
'#pvDrawer .need{background:var(--gold-soft);color:var(--gold-ink);border-radius:8px;padding:8px 11px;font-size:12px;margin-top:8px}'+
'#pvDrawer .notes{display:flex;flex-direction:column;gap:8px;margin-bottom:10px}#pvDrawer .note{background:var(--card);border:1px solid var(--line);border-radius:9px;padding:9px 11px}'+
'#pvDrawer .note .m{font-size:10.5px;color:var(--muted);margin-bottom:3px}#pvDrawer .note .t{font-size:12.5px;line-height:1.4}'+
'#pvDrawer textarea{width:100%;min-height:64px;padding:9px 11px;border:1px solid var(--line);border-radius:9px;font-size:12.5px;font-family:inherit;background:var(--card);color:var(--ink);box-sizing:border-box}'+
'#pvDrawer .addbtn{margin-top:7px;background:var(--inverse-bg);color:var(--inverse-ink);border:none;border-radius:8px;padding:8px 15px;font-weight:700;font-size:12.5px;cursor:pointer}'+
'#pvDrawer .cfpb{display:flex;flex-direction:column;gap:6px;margin-bottom:8px}#pvDrawer .cfpbrow{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:7px 10px;font-size:12px;display:flex;flex-wrap:wrap;gap:4px 14px;align-items:center}'+
'#pvDrawer .cfpbrow b{flex:0 0 auto}#pvDrawer .cfpbrow .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}'+
'#pvDrawer .cfpbtoggle{background:none;border:1px solid var(--line);border-radius:6px;padding:3px 9px;font-size:11px;cursor:pointer;color:var(--muted)}';

var sectionHTML=''+
'<div class="pv-sub"><b>The client work desk.</b> Every credit-repair client and where they stand across all three bureaus. <b>Overview</b> for the numbers, <b>Queue</b> to work the list, <b>Pipeline</b> to see the board. Open any client to update status, documents, and notes — saved for the whole team.</div>'+
'<div class="pv-bar" style="margin-bottom:14px"><div class="pv-tabs" style="margin-bottom:0"><button id="pvTabOv" class="on" data-v="overview">Overview</button><button id="pvTabQ" data-v="queue">Queue</button><button id="pvTabP" data-v="board">Pipeline</button></div>'+
 '<div style="display:flex;gap:8px">'+
 '<button id="pvReconcileBtn" class="addbtn" style="display:none;margin-top:0">Sync new clients from GoHighLevel</button>'+
 '<button id="pvSheetBtn" class="addbtn" style="display:none;margin-top:0;background:var(--card);color:var(--ink);border:1px solid var(--line)">Sync from Credit Repair sheet</button>'+
 '<input id="pvSheetFile" type="file" accept=".csv" style="display:none">'+
 '</div></div>'+
 '<div id="pvReconcileResult" class="pv-card" style="display:none;margin-bottom:14px"></div>'+
 '<div id="pvSheetResult" class="pv-card" style="display:none;margin-bottom:14px"></div>'+
'<div id="pvOverview"></div>'+
'<div id="pvWork" style="display:none">'+
 '<div class="pv-chips" id="pvChips"></div>'+
 '<div class="pv-bar"><div class="pv-tools"><input id="pvSearch" placeholder="Search a client or package…"><span class="pv-count" id="pvCount"></span></div></div>'+
 '<div id="pvQueue"><div class="pv-tablewrap"><table class="pv-table"><thead><tr>'+
   '<th>Client</th><th>Package</th><th>Stage</th><th>In stage</th><th class="ctr">TransUnion</th><th class="ctr">Equifax</th><th class="ctr">Experian</th><th class="ctr">Docs</th><th>Assigned</th><th>MFSN</th><th>Next action</th>'+
   '</tr></thead><tbody id="pvBody"></tbody></table></div><div class="pv-pager" id="pvPager"></div></div>'+
 '<div id="pvBoardView" style="display:none"><div class="pv-board" id="pvBoard"></div></div>'+
'</div>'+
'<div class="pv-foot" id="pvFoot"></div>';

/* ---------- helpers ---------- */
function bureaus(c){return [c.tu,c.eq,c.ex];}
function anyLogin(c){return bureaus(c).some(function(b){return b.st==='login';});}
function anyReady(c){for(var i=0;i<3;i++){if(bureaus(c)[i].st==='ready')return bureaus(c)[i];}return null;}
function docCount(c){var n=0;for(var d=0;d<DOCS.length;d++)if(c.docs&&c.docs[DOCS[d]])n++;return n;}
function docsNeeded(c){var a=[];for(var d=0;d<DOCS.length;d++)if(!(c.docs&&c.docs[DOCS[d]]))a.push(DOCS[d]);return a;}
function nextAction(c){
  if(c.stage==='Onboarding')return{t:'Onboard + collect docs',a:true};
  if(anyLogin(c))return{t:'Chase MyFreeScoreNow',a:true};
  if(docCount(c)<DOCS.length)return{t:'Collect documents',a:true};
  var r=anyReady(c);if(r)return{t:'Submit round '+r.r,a:false};
  if(c.stage==='Completed')return{t:'Upsell to mentorship',a:false};
  return{t:'Awaiting next window',a:false};
}
var FILTERS=[
 {id:'all',label:'All clients',dot:C.gray,f:function(){return true;}},
 {id:'ready',label:'Ready to dispute',dot:C.blue,f:function(c){return !anyLogin(c)&&(c.stage==='Ready'||!!anyReady(c));}},
 {id:'login',label:'Login blocked',dot:C.red,f:function(c){return anyLogin(c);}},
 {id:'docs',label:'Docs incomplete',dot:C.gold,f:function(c){return docCount(c)<DOCS.length&&c.stage!=='Onboarding';}},
 {id:'rounds',label:'In rounds',dot:C.green,f:function(c){return c.stage==='In rounds';}},
 {id:'onb',label:'Onboarding',dot:'#6B7280',f:function(c){return c.stage==='Onboarding';}},
 {id:'done',label:'Completed',dot:'var(--green-ink)',f:function(c){return c.stage==='Completed';}},
{id:'needsAffiliate',label:'Needs affiliate',dot:C.gold,f:function(c){return c.mfsn==='needs';}},
// Backs the Employee "New Clients" nav item (pvGoNewClients below) -- just
// signed up, nothing worked yet, or already cleared for their first round.
// Not one of the regular chips (renderChips filters it out below) except
// for an employee/preview session, where it's the one this view opens on.
{id:'newclients',label:'New clients',dot:C.blue,f:function(c){return c.stage==='Onboarding'||(!anyLogin(c)&&(c.stage==='Ready'||!!anyReady(c)));}}
];
/* c.mfsn is computed server-side (see /api/production in server.js) by
   matching name against the synced MyFreeScoreNow roster -- 'affiliate' (paying
   her), 'needs' (her client, not enrolled under her link), or null/undefined
   before any MFSN sync has happened yet. */
function mfsnPill(c){
if(c.mfsn==='affiliate')return '<span class="pv-mfsn mfsn-yes">Affiliate</span>';
if(c.mfsn==='needs')return '<span class="pv-mfsn mfsn-no">Needs affiliate</span>';
return '<span class="pv-days">-</span>';
}
function bpill(b){
  if(b.st==='done')return '<span class="pill2 pv-done">R'+b.r+' ✓</span>';
  if(b.st==='ready')return '<span class="pill2 pv-ready">R'+b.r+' ready</span>';
  if(b.st==='login')return '<span class="pill2 pv-login">R'+b.r+' ⛔</span>';
  return '<span class="pill2 pv-none">—</span>';
}
function bmini(b){
  var cl=b.st==='done'?'pv-done':b.st==='ready'?'pv-ready':b.st==='login'?'pv-login':'pv-none';
  var tx=b.st==='none'?'—':'R'+b.r+(b.st==='done'?'✓':b.st==='login'?'⛔':'•');
  return '<span class="mini '+cl+'">'+tx+'</span>';
}
function stagePill(s){var m={'Onboarding':'stg-onb','Ready':'stg-ready','In rounds':'stg-rounds','Completed':'stg-done'};return '<span class="pv-stg '+(m[s]||'stg-onb')+'">'+s+'</span>';}
function docCell(c){var n=docCount(c),t=DOCS.length;var cl=n===t?'doc-ok':n>=t/2?'doc-part':'doc-no';return '<span class="pv-doc '+cl+'">'+n+'/'+t+'</span>';}
/* Notes are written by employees and read by the admin, so escaping has to hold
   in attribute contexts too, not just between tags. */
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function fmt(n){return n.toLocaleString();}

function currentRows(){
  var fl=FILTERS.filter(function(x){return x.id===curFilter;})[0]||FILTERS[0];
  return CLIENTS.filter(fl.f).filter(function(c){return !curSearch||((c.name||'')+' '+(c.pkg||'')+' '+(c.email||'')+' '+(c.phone||'')).toLowerCase().indexOf(curSearch)>=0;});
}

/* ---------- server load/save ---------- */
/* Save one lead at a time, sending ONLY the field that changed. The server
   deep-merges, so two people on the same lead editing different things no
   longer overwrite each other. Sending the whole record — as this once did —
   meant the later save clobbered the earlier one. */
var saveTimers={}, pending={};
function patchLead(c,patch){
  return fetch('/api/production/'+encodeURIComponent(c.id),
    {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(patch)});
}
function flush(id){
  var c=byId(id), patch=pending[id];
  delete pending[id]; delete saveTimers[id];
  if(c&&patch){ try{patchLead(c,patch);}catch(e){} }
}
function save(c,patch){
  if(!c||!c.id)return Promise.resolve();
  if(patch&&patch.note!=null) return patchLead(c,{note:patch.note}); // notes send at once and return the list
  /* Accumulate changed fields across the debounce window rather than replacing,
     so a quick doc-tick then round-change sends both. */
  pending[c.id]=Object.assign(pending[c.id]||{}, patch||{});
  if(saveTimers[c.id])clearTimeout(saveTimers[c.id]);
  saveTimers[c.id]=setTimeout(function(){flush(c.id);},500);
  return Promise.resolve();
}
function loadThen(cb){
  fetch('/api/production').then(function(r){return r.json();}).then(function(d){
    CLIENTS=(d&&Array.isArray(d.clients))?d.clients:[]; loaded=true; cb();
  }).catch(function(){ CLIENTS=[]; loaded=true; cb(); });
}

/* ---------- GHL <-> Deal Production reconciliation (admin only) ---------- */
// Adds any GHL credit-repair client with no existing Deal Production record.
// Also reports (never creates) Deal Production clients matching no current
// GHL contact — the old sheet import has no email or phone, so there is
// nothing to create a real GHL contact from; those need a human look.
function runReconcile(){
  var btn=document.getElementById('pvReconcileBtn'), out=document.getElementById('pvReconcileResult');
  if(!btn)return;
  btn.disabled=true; var origText=btn.textContent; btn.textContent='Syncing…';
  fetch('/api/production/reconcile',{method:'POST'}).then(function(r){return r.json();}).then(function(d){
    btn.disabled=false; btn.textContent=origText;
    if(!d||d.error){ out.style.display=''; out.innerHTML='<div class="cardsub">Sync failed'+(d&&d.error?': '+esc(d.error):'')+'.</div>'; return; }
    var addedRows=(d.added||[]).slice(0,15).map(function(c){return '<div class="cardsub">'+esc(c.name)+(c.email?' · '+esc(c.email):'')+'</div>';}).join('');
    var missingRows=(d.notInGhl||[]).slice(0,15).map(function(c){return '<div class="cardsub">'+esc(c.name)+'</div>';}).join('');
    out.style.display='';
    out.innerHTML='<h3>GoHighLevel sync results</h3>'+
      '<p class="cap" style="margin-bottom:10px">Added '+fmt(d.addedCount)+' client'+(d.addedCount===1?'':'s')+' from GoHighLevel to Deal Production.'+
      (d.notInGhlCount?' '+fmt(d.notInGhlCount)+' Deal Production client'+(d.notInGhlCount===1?'':'s')+' could not be matched to a current GoHighLevel contact by name — review these by hand (the old sheet import has no email or phone to match on, so a common name can hide a real match).':'')+'</p>'+
      (addedRows?'<div class="sec" style="font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:700;margin:6px 0">Added ('+fmt(d.addedCount)+(d.addedCount>15?', first 15':'')+')</div>'+addedRows:'')+
      (missingRows?'<div class="sec" style="font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:700;margin:14px 0 6px">Not matched to GoHighLevel ('+fmt(d.notInGhlCount)+(d.notInGhlCount>15?', first 15':'')+')</div>'+missingRows:'');
    if(d.addedCount)loadThen(function(){renderOverview();drawWork();});
  }).catch(function(){
    btn.disabled=false; btn.textContent=origText;
    out.style.display=''; out.innerHTML='<div class="cardsub">Sync failed — check your connection and try again.</div>';
  });
}

/* ---------- Credit Repair sheet sync (admin only) ---------- */
// Tiffany's live Google Sheet is the source of truth for package/TU/EQ/EX/
// notes -- always runs as a dry run first (apply:false) so the diff can be
// reviewed before anything is written; a second click with apply:true
// commits it. See lib/sheet.js for the matching/parsing rules.
var lastSheetCsv=null;
function runSheetSync(csvText, apply){
  var btn=document.getElementById('pvSheetBtn'), out=document.getElementById('pvSheetResult');
  if(!btn)return;
  lastSheetCsv=csvText;
  btn.disabled=true; var origText=btn.textContent; btn.textContent=apply?'Applying…':'Reading sheet…';
  fetch('/api/production/sheet-sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({csv:csvText,apply:!!apply})})
    .then(function(r){return r.json();}).then(function(d){
      btn.disabled=false; btn.textContent=origText;
      if(!d||d.error){ out.style.display=''; out.innerHTML='<div class="cardsub">Sheet sync failed'+(d&&d.error?': '+esc(d.error):'')+'.</div>'; return; }
      out.style.display='';
      var updateRows=(d.updates||[]).slice(0,15).map(function(u){
        var fields=Object.keys(u.patch).join(', ');
        return '<div class="cardsub">'+esc(u.id)+' — '+esc(fields)+(u.matchedGhl?'':' <span style="color:var(--gold)">(no live GHL match)</span>')+'</div>';
      }).join('');
      var createRows=(d.toCreate||[]).slice(0,15).map(function(c){return '<div class="cardsub">'+esc(c.name)+' · '+esc(c.pkg||'—')+'</div>';}).join('');
      var unmatchedRows=(d.unmatched||[]).slice(0,15).map(function(r){return '<div class="cardsub">'+esc(r.name)+'</div>';}).join('');
      var dupRows=(d.duplicateNames||[]).slice(0,15).map(function(n){return '<div class="cardsub">'+esc(n)+'</div>';}).join('');
      out.innerHTML='<h3>Credit Repair sheet sync'+(d.apply?' — applied':' — preview')+'</h3>'+
        '<p class="cap" style="margin-bottom:10px">Read '+fmt(d.sheetRowCount)+' sheet rows. '+
          fmt(d.updatesCount)+' existing client'+(d.updatesCount===1?'':'s')+' would be updated to match the sheet, '+
          fmt(d.toCreateCount)+' new client'+(d.toCreateCount===1?'':'s')+' would be added, '+
          fmt(d.unmatchedCount)+' sheet row'+(d.unmatchedCount===1?'':'s')+' matched no current GoHighLevel contact (not created — no email/phone to go on), and '+
          fmt(d.duplicateNameCount)+' had an ambiguous duplicate name on the sheet itself (skipped).'+'</p>'+
        (d.apply?'<p class="cap" style="color:var(--green);font-weight:700;margin-bottom:10px">Applied — Deal Production now reflects the sheet.</p>':
          '<button class="addbtn" id="pvSheetApplyBtn" style="margin-top:0">Apply this sync</button>')+
        (updateRows?'<div class="sec" style="font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:700;margin:14px 0 6px">Updates ('+fmt(d.updatesCount)+(d.updatesCount>15?', first 15':'')+')</div>'+updateRows:'')+
        (createRows?'<div class="sec" style="font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:700;margin:14px 0 6px">New from sheet ('+fmt(d.toCreateCount)+(d.toCreateCount>15?', first 15':'')+')</div>'+createRows:'')+
        (unmatchedRows?'<div class="sec" style="font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:700;margin:14px 0 6px">Not matched to GoHighLevel ('+fmt(d.unmatchedCount)+(d.unmatchedCount>15?', first 15':'')+')</div>'+unmatchedRows:'')+
        (dupRows?'<div class="sec" style="font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:700;margin:14px 0 6px">Ambiguous duplicate names on the sheet ('+fmt(d.duplicateNameCount)+(d.duplicateNameCount>15?', first 15':'')+')</div>'+dupRows:'');
      var ap=document.getElementById('pvSheetApplyBtn');
      if(ap)ap.onclick=function(){runSheetSync(lastSheetCsv,true);};
      if(d.apply&&(d.updatesCount||d.toCreateCount))loadThen(function(){renderOverview();drawWork();});
    }).catch(function(){
      btn.disabled=false; btn.textContent=origText;
      out.style.display=''; out.innerHTML='<div class="cardsub">Sheet sync failed — check your connection and try again.</div>';
    });
}

/* ---------- overview (charts) ---------- */
function bucketOf(b){
  if(b.st==='none')return 'Not started'; if(b.st==='login')return 'Login'; if(b.st==='ready')return 'Ready';
  return b.r>=6?'R6+':('R'+b.r);
}
function renderOverview(){
  var ov=document.getElementById('pvOverview');
  var st={Onboarding:0,Ready:0,'In rounds':0,Completed:0};
  var attn=0,docsInc=0,pkg={};
  var cats=['Not started','R1','R2','R3','R4','R5','R6+','Ready','Login'];
  var bur={TU:{},EQ:{},EX:{}}; cats.forEach(function(k){bur.TU[k]=0;bur.EQ[k]=0;bur.EX[k]=0;});
  var mfsnAffiliate=0, mfsnNeeds=0;
  CLIENTS.forEach(function(c){
    st[c.stage]=(st[c.stage]||0)+1;
    if(anyLogin(c))attn++;
    if(docCount(c)<DOCS.length&&c.stage!=='Onboarding')docsInc++;
    if(c.pkg)pkg[c.pkg]=(pkg[c.pkg]||0)+1;
    if(c.mfsn==='affiliate')mfsnAffiliate++; else if(c.mfsn==='needs')mfsnNeeds++;
    bur.TU[bucketOf(c.tu)]++; bur.EQ[bucketOf(c.eq)]++; bur.EX[bucketOf(c.ex)]++;
  });
  var topPkg=Object.keys(pkg).map(function(k){return[k,pkg[k]];}).sort(function(a,b){return b[1]-a[1];}).slice(0,10);
  ov.innerHTML=''+
   '<div class="pv-kpis" style="grid-template-columns:repeat(8,1fr)">'+
    '<div class="pv-kpi"><div class="l">Total clients</div><div class="v">'+fmt(CLIENTS.length)+'</div></div>'+
    '<div class="pv-kpi good"><div class="l">In rounds</div><div class="v">'+fmt(st['In rounds'])+'</div></div>'+
    '<div class="pv-kpi"><div class="l">Completed</div><div class="v">'+fmt(st.Completed)+'</div></div>'+
    '<div class="pv-kpi"><div class="l">Onboarding</div><div class="v">'+fmt(st.Onboarding)+'</div></div>'+
    '<div class="pv-kpi alert"><div class="l">Login blocked</div><div class="v">'+fmt(attn)+'</div></div>'+
    '<div class="pv-kpi"><div class="l">Docs incomplete</div><div class="v">'+fmt(docsInc)+'</div></div>'+
    '<div class="pv-kpi good"><div class="l">MFSN affiliate</div><div class="v">'+fmt(mfsnAffiliate)+'</div></div>'+
    '<div class="pv-kpi alert"><div class="l">Needs affiliate</div><div class="v">'+fmt(mfsnNeeds)+'</div></div>'+
   '</div>'+
   '<div class="pv-grid2">'+
    '<div class="pv-card"><h3>Dispute rounds by bureau</h3><p class="cap">Where each bureau stands across the whole book.</p><div class="pv-wrap"><canvas id="pvChBur"></canvas></div></div>'+
    '<div class="pv-card"><h3>Clients by stage</h3><p class="cap">The production pipeline at a glance.</p><div class="pv-wrap"><canvas id="pvChStage"></canvas></div></div>'+
   '</div>'+
   '<div class="pv-grid11">'+
    '<div class="pv-card"><h3>Package mix</h3><p class="cap">What clients bought.</p><div class="pv-wrap sm"><canvas id="pvChPkg"></canvas></div></div>'+
    '<div class="pv-card"><h3>Login / monitoring queue by bureau</h3><p class="cap">Blocked rounds to chase (MyFreeScoreNow off).</p><div class="pv-wrap sm"><canvas id="pvChLogin"></canvas></div></div>'+
   '</div>';
  if(typeof Chart==='undefined')return;
  Object.keys(charts).forEach(function(k){try{charts[k].destroy();}catch(e){}});charts={};
  charts.bur=new Chart(document.getElementById('pvChBur'),{type:'bar',data:{labels:cats,datasets:[
    {label:'TransUnion',data:cats.map(function(k){return bur.TU[k];}),backgroundColor:C.blue},
    {label:'Equifax',data:cats.map(function(k){return bur.EQ[k];}),backgroundColor:C.green},
    {label:'Experian',data:cats.map(function(k){return bur.EX[k];}),backgroundColor:C.gold}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{boxWidth:11,font:{size:11}}}},scales:{x:{grid:{display:false},ticks:{font:{size:10}}},y:{grid:{color:'rgba(156,163,175,.2)'},ticks:{font:{size:10}}}}}});
  charts.stage=new Chart(document.getElementById('pvChStage'),{type:'bar',data:{labels:STAGES,datasets:[{data:STAGES.map(function(k){return st[k]||0;}),backgroundColor:['#6B7280',C.blue,C.green,C.gold],borderRadius:5}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{display:false},ticks:{font:{size:11}}},y:{grid:{color:'rgba(156,163,175,.2)'},ticks:{font:{size:10}}}}}});
  charts.pkg=new Chart(document.getElementById('pvChPkg'),{type:'bar',data:{labels:topPkg.map(function(p){return p[0];}),datasets:[{data:topPkg.map(function(p){return p[1];}),backgroundColor:C.blue,borderRadius:4}]},
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{color:'rgba(156,163,175,.2)'},ticks:{font:{size:10}}},y:{grid:{display:false},ticks:{font:{size:10}}}}}});
  charts.login=new Chart(document.getElementById('pvChLogin'),{type:'bar',data:{labels:['TransUnion','Equifax','Experian'],datasets:[{data:[bur.TU.Login,bur.EQ.Login,bur.EX.Login],backgroundColor:[C.blue,C.green,C.gold],borderRadius:4}]},
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{color:'rgba(156,163,175,.2)'},ticks:{font:{size:10}}},y:{grid:{display:false},ticks:{font:{size:11}}}}}});
}

/* ---------- queue (table + pager) ---------- */
function renderChips(){
  var chips=document.getElementById('pvChips');
  // Locked mode (the Employee "New Clients" nav item, see pvGoNewClients) --
  // no chip picking, just a static label naming the fixed filter.
  if(lockedFilter){
    chips.innerHTML='<div class="pv-sub" style="margin:0 0 4px">New clients — just onboarded or ready to dispute. Use <b>Pipeline</b> in the sidebar for the full board.</div>';
    return;
  }
  // 'newclients' backs that locked view and isn't a chip anyone picks by
  // hand -- keep it out of Admin's Queue toolbar (unchanged from before)
  // and out of an Employee's normal Pipeline browsing too.
  var list=FILTERS.filter(function(fl){return fl.id!=='newclients';});
  chips.innerHTML=list.map(function(fl){var n=CLIENTS.filter(fl.f).length;return '<div class="pv-chip'+(fl.id===curFilter?' active':'')+'" data-f="'+fl.id+'"><span class="dotc" style="background:'+fl.dot+'"></span>'+fl.label+' <span class="n">'+fmt(n)+'</span></div>';}).join('');
  chips.querySelectorAll('.pv-chip').forEach(function(el){el.onclick=function(){curFilter=el.getAttribute('data-f');curPage=1;drawWork();};});
}
function drawWork(){
  var rows=currentRows();
  document.getElementById('pvCount').textContent=fmt(rows.length)+' of '+fmt(CLIENTS.length)+' clients';
  document.querySelectorAll('#pvChips .pv-chip').forEach(function(el){el.classList.toggle('active',el.getAttribute('data-f')===curFilter);});
  if(curView==='queue'){
    var pages=Math.max(1,Math.ceil(rows.length/PAGE)); if(curPage>pages)curPage=pages;
    var slice=rows.slice((curPage-1)*PAGE,curPage*PAGE);
    document.getElementById('pvBody').innerHTML=slice.length?slice.map(function(c){var na=nextAction(c);return '<tr onclick="pvOpen(\''+c.id+'\')">'+
      '<td class="pv-name">'+esc(c.name)+'</td><td class="pv-pkg">'+esc(c.pkg)+'</td><td>'+stagePill(c.stage)+'</td><td class="pv-days">'+(c.days||0)+'d</td>'+
      '<td class="ctr">'+bpill(c.tu)+'</td><td class="ctr">'+bpill(c.eq)+'</td><td class="ctr">'+bpill(c.ex)+'</td>'+
      '<td class="ctr">'+docCell(c)+'</td><td>'+esc(c.va||'—')+'</td><td>'+mfsnPill(c)+'</td><td class="pv-next'+(na.a?' attn':'')+'">'+na.t+'</td></tr>';
    }).join(''):'<tr><td colspan="11" style="padding:30px;text-align:center;color:var(--muted)">No clients in this queue.</td></tr>';
    var from=rows.length?((curPage-1)*PAGE+1):0, to=Math.min(curPage*PAGE,rows.length);
    document.getElementById('pvPager').innerHTML='<button id="pvPrev"'+(curPage<=1?' disabled':'')+'>‹ Prev</button><span>'+fmt(from)+'–'+fmt(to)+' of '+fmt(rows.length)+'</span><button id="pvNext"'+(curPage>=pages?' disabled':'')+'>Next ›</button>';
    var pv=document.getElementById('pvPrev'),nx=document.getElementById('pvNext');
    if(pv)pv.onclick=function(){if(curPage>1){curPage--;drawWork();}};
    if(nx)nx.onclick=function(){if(curPage<pages){curPage++;drawWork();}};
  } else {
    var CAP=40;
    document.getElementById('pvBoard').innerHTML=STAGES.map(function(sg){
      var items=rows.filter(function(c){return c.stage===sg;});
      var shown=items.slice(0,CAP);
      return '<div class="pv-col"><h4><span>'+sg+'</span><span>'+fmt(items.length)+'</span></h4>'+shown.map(function(c){var na=nextAction(c);return '<div class="pv-ccard'+(anyLogin(c)?' blk':'')+'" onclick="pvOpen(\''+c.id+'\')"><div class="cn">'+esc(c.name)+'</div><div class="cp">'+esc(c.pkg)+'</div><div class="cb">'+bmini(c.tu)+bmini(c.eq)+bmini(c.ex)+'</div><div class="cf"><span>⏱ '+(c.days||0)+'d · 📄 '+docCount(c)+'/'+DOCS.length+'</span><span>'+esc(c.va||'—')+'</span></div></div>';}).join('')+(items.length>CAP?'<div class="pv-more">+'+fmt(items.length-CAP)+' more — use Queue to see all</div>':'')+'</div>';
    }).join('');
  }
}

function renderProduction(){
  if(!document.getElementById('pvChips')){return;}
  if(!loaded){ loadThen(function(){renderProduction();}); return; }
  document.getElementById('pvFoot').textContent='Team-shared client book ('+fmt(CLIENTS.length)+' clients from the credit-repair sheet) — every status, document, and note saves to the server for the whole team. Logins and credentials are never shown.';
  // Locked mode (Employee "New Clients", see pvGoNewClients below) is a
  // single fixed queue -- no switching to Overview/Board from there.
  // Normal Deal Production navigation always leaves lockedFilter false, so
  // this never affects Admin.
  var tabs=document.querySelector('#view-production .pv-tabs');
  if(tabs)tabs.style.display=lockedFilter?'none':'';
  renderChips();
  var s=document.getElementById('pvSearch'); if(s&&!s.__b){s.__b=1;s.oninput=function(){curSearch=s.value.toLowerCase();curPage=1;drawWork();};}
  if(curView==='overview'){ renderOverview(); } else { drawWork(); }
}
window.pvSetPV=function(v){
  curView=v;
  document.getElementById('pvTabOv').classList.toggle('on',v==='overview');
  document.getElementById('pvTabQ').classList.toggle('on',v==='queue');
  document.getElementById('pvTabP').classList.toggle('on',v==='board');
  document.getElementById('pvOverview').style.display=v==='overview'?'':'none';
  document.getElementById('pvWork').style.display=v==='overview'?'none':'';
  document.getElementById('pvQueue').style.display=v==='queue'?'':'none';
  document.getElementById('pvBoardView').style.display=v==='board'?'':'none';
  renderProduction();
};
// Employee "New Clients" nav entry point -- Queue, forced to the
// 'newclients' filter, chips/tab-switcher hidden (see renderChips/
// renderProduction above) so it reads as one fixed worklist.
window.pvGoNewClients=function(){
  lockedFilter=true; curFilter='newclients'; curPage=1;
  showView('production'); pvSetPV('queue');
  // showView('production') always highlights pvNavBtn ("Deal Production")
  // as the active nav item -- point the highlight at New Clients instead
  // since that's the button actually clicked.
  var pvBtn=document.getElementById('pvNavBtn'); if(pvBtn)pvBtn.classList.remove('on');
  var ncBtn=document.getElementById('pvNewClientsBtn'); if(ncBtn)ncBtn.classList.add('on');
  var pt=document.getElementById('pageTitle'); if(pt)pt.textContent='New Clients';
};
// Safe external entry point into the drawer (e.g. from team.js's Team
// Dashboard rows) regardless of whether this module has loaded its own
// CLIENTS list yet.
window.pvOpenClient=function(id){
  if(!loaded){ loadThen(function(){ pvOpen(id); }); } else { pvOpen(id); }
};

/* ---------- drawer ---------- */
function byId(id){for(var i=0;i<CLIENTS.length;i++)if(CLIENTS[i].id===id)return CLIENTS[i];return null;}
window.pvOpen=function(id){var c=byId(id);if(!c)return;openId=id;openStamp=c.updatedAt||null;
  document.getElementById('dNm').textContent=c.name;
  document.getElementById('dMt').textContent=c.pkg+' · '+(c.days||0)+' days in '+c.stage.toLowerCase();
  document.getElementById('dBody').innerHTML=drawerBody(c); bindDrawer(c);
  document.getElementById('pvOverlay').style.display='block'; document.getElementById('pvDrawer').classList.add('open');
  startPoll();
};
window.pvCloseDrawer=function(){document.getElementById('pvDrawer').classList.remove('open');document.getElementById('pvOverlay').style.display='none';openId=null;stopPoll();};

/* While a drawer is open, poll just that one lead so a colleague's change shows
   up without a reload. Deliberately gentle: skip while the user is mid-edit or
   has a save pending, and never react to our own writes. */
function stopPoll(){if(pollTimer){clearInterval(pollTimer);pollTimer=null;}}
function startPoll(){stopPoll();pollTimer=setInterval(pollOpenLead,4000);}
function editingDrawer(){var a=document.activeElement;var dr=document.getElementById('pvDrawer');return a&&dr&&dr.contains(a);}
function pollOpenLead(){
  if(!openId){stopPoll();return;}
  var id=openId;
  fetch('/api/production/'+encodeURIComponent(id)).then(function(r){return r.ok?r.json():null;}).then(function(d){
    if(!d||!d.client||openId!==id)return;
    var fresh=d.client;
    if(!fresh.updatedAt||fresh.updatedAt===openStamp)return;   // nothing new
    if(fresh.updatedBy&&fresh.updatedBy===MYNAME){openStamp=fresh.updatedAt;return;} // our own save
    if(editingDrawer()||pending[id])return;                    // don't clobber an edit in progress; catch it next tick
    var c=byId(id); if(c){for(var k in fresh)c[k]=fresh[k];}    // adopt the colleague's version
    openStamp=fresh.updatedAt;
    document.getElementById('dBody').innerHTML=drawerBody(c||fresh); bindDrawer(c||fresh);
    flashUpdated(fresh.updatedBy);
    if(curView==='overview')renderOverview();else drawWork();
  }).catch(function(){});
}
function flashUpdated(who){
  var el=document.getElementById('dMt'); if(!el)return;
  var prev=el.textContent;
  el.textContent='↻ Updated by '+(who||'a teammate');
  el.style.color='var(--gold,#FF9F29)';
  setTimeout(function(){el.style.color='';var c=byId(openId);if(c)el.textContent=c.pkg+' · '+(c.days||0)+' days in '+c.stage.toLowerCase();else el.textContent=prev;},2500);
}
function opts(a,sel){return a.map(function(o){return '<option'+(o===sel?' selected':'')+'>'+o+'</option>';}).join('');}
// Password display defaults to masked -- these are live CFPB portal logins,
// and the drawer can be open on a shared screen. "Show" reveals every round
// at once rather than one at a time, since a teammate filing a complaint
// usually needs to compare across rounds.
var cfpbRevealed=false;
function cfpbHTML(c){
  var rows=c.cfpb||[];
  if(!rows.length)return '';
  var body=rows.map(function(r){
    var pw=r.pw?(cfpbRevealed?esc(r.pw):'••••••••'):'—';
    return '<div class="cfpbrow"><b>Round '+r.round+'</b>'+
      (r.date?'<span>'+esc(r.date)+'</span>':'')+
      (r.email?'<span class="mono">'+esc(r.email)+'</span>':'')+
      '<span class="mono">'+pw+'</span></div>';
  }).join('');
  return '<div class="sec">CFPB portal logins <button class="cfpbtoggle" id="dCfpbToggle" type="button">'+(cfpbRevealed?'Hide passwords':'Show passwords')+'</button></div>'+
   '<div class="cfpb">'+body+'</div>';
}
function drawerBody(c){
  var need=docsNeeded(c);
  var brow=function(key,label){var b=c[key];return '<div class="brow"><b>'+label+'</b><input type="number" min="0" max="9" value="'+b.r+'" data-b="'+key+'"><select data-b="'+key+'" data-k="st"><option value="none"'+(b.st==='none'?' selected':'')+'>— not started</option><option value="ready"'+(b.st==='ready'?' selected':'')+'>Ready</option><option value="done"'+(b.st==='done'?' selected':'')+'>Round done</option><option value="login"'+(b.st==='login'?' selected':'')+'>⛔ Login issue</option></select></div>';};
  var docsHtml=DOCS.map(function(d){return '<label><input type="checkbox" data-doc="'+d+'"'+((c.docs&&c.docs[d])?' checked':'')+'> '+d+'</label>';}).join('');
  var notesHtml=(c.notes&&c.notes.length)?c.notes.map(function(n){return '<div class="note"><div class="m">'+esc(n.when)+' · '+esc(n.who)+'</div><div class="t">'+esc(n.text)+'</div></div>';}).join(''):'<div class="pv-days">No notes yet.</div>';
  return '<div class="sec">Status</div>'+
   '<div class="fld"><label>Stage</label><select id="dStage">'+opts(STAGES,c.stage)+'</select></div>'+
   '<div class="fld"><label>Assigned</label><select id="dVa">'+opts(VAS,c.va||'—')+'</select></div>'+
   '<div class="sec">Dispute rounds by bureau</div>'+brow('tu','TransUnion')+brow('eq','Equifax')+brow('ex','Experian')+
   cfpbHTML(c)+
   '<div class="sec">Documents ('+docCount(c)+'/'+DOCS.length+')</div><div class="docs">'+docsHtml+'</div>'+
   (need.length?'<div class="need"><b>Still needed:</b> '+need.join(', ')+'</div>':'<div class="need" style="background:var(--green-soft);color:var(--green-ink)"><b>All documents collected.</b></div>')+
   '<div class="sec">Notes</div><div class="notes" id="dNotes">'+notesHtml+'</div>'+
   '<textarea id="dNoteIn" placeholder="Add a note (e.g. \'Submitted R2 disputes 7/21 — Antoinette\')"></textarea>'+
   '<div><button class="addbtn" id="dAddNote">Add note</button></div>';
}
function bindDrawer(c){
  var body=document.getElementById('dBody');
  /* Each handler saves only what it touched, so the server merge stays clean. */
  function commit(patch){save(c,patch);if(curView==='overview')renderOverview();else drawWork();document.getElementById('dMt').textContent=c.pkg+' · '+(c.days||0)+' days in '+c.stage.toLowerCase();}
  document.getElementById('dStage').onchange=function(e){if(c.stage!==e.target.value){c.stage=e.target.value;c.days=0;}commit({stage:c.stage,days:c.days});document.getElementById('dBody').innerHTML=drawerBody(c);bindDrawer(c);};
  document.getElementById('dVa').onchange=function(e){c.va=e.target.value;commit({va:c.va});};
  var cfpbToggle=document.getElementById('dCfpbToggle');
  if(cfpbToggle)cfpbToggle.onclick=function(){cfpbRevealed=!cfpbRevealed;document.getElementById('dBody').innerHTML=drawerBody(c);bindDrawer(c);};
  body.querySelectorAll('input[data-b]').forEach(function(el){el.onchange=function(){var k=el.getAttribute('data-b');c[k].r=parseInt(el.value||'0',10);var p={};p[k]={r:c[k].r};commit(p);};});
  body.querySelectorAll('select[data-b]').forEach(function(el){el.onchange=function(){var k=el.getAttribute('data-b');c[k].st=el.value;var p={};p[k]={st:c[k].st};commit(p);};});
  body.querySelectorAll('input[data-doc]').forEach(function(el){el.onchange=function(){if(!c.docs)c.docs={};var d=el.getAttribute('data-doc');c.docs[d]=el.checked;var dp={};dp[d]=el.checked;commit({docs:dp});document.getElementById('dBody').innerHTML=drawerBody(c);bindDrawer(c);};});
  /* The server stamps the author from the session, so take the notes list back
     from its response rather than guessing the name here. */
  document.getElementById('dAddNote').onclick=function(){
    var t=document.getElementById('dNoteIn').value.trim();if(!t)return;
    document.getElementById('dNoteIn').value='';
    save(c,{note:t}).then(function(r){return r&&r.json?r.json():null;}).then(function(d){
      if(d&&d.client)c.notes=d.client.notes;
      document.getElementById('dBody').innerHTML=drawerBody(c);bindDrawer(c);
    }).catch(function(){});
  };
}

/* ---------- init ---------- */
function initProd(){
  if(document.getElementById('view-production'))return;
  var style=document.createElement('style');style.textContent=css;document.head.appendChild(style);
  var anc=document.getElementById('view-dash');
  var sec=document.createElement('section');sec.id='view-production';sec.style.display='none';sec.innerHTML=sectionHTML;
  if(anc&&anc.parentNode)anc.parentNode.insertBefore(sec,anc); else document.body.appendChild(sec);
  var ov=document.createElement('div');ov.id='pvOverlay';ov.onclick=window.pvCloseDrawer;document.body.appendChild(ov);
  var dr=document.createElement('div');dr.id='pvDrawer';dr.innerHTML='<div class="dh"><div><div class="nm" id="dNm">—</div><div class="mt" id="dMt"></div></div><button class="dx" onclick="pvCloseDrawer()">×</button></div><div class="db" id="dBody"></div>';document.body.appendChild(dr);
  document.getElementById('pvTabOv').onclick=function(){pvSetPV('overview');};
  document.getElementById('pvTabQ').onclick=function(){pvSetPV('queue');};
  document.getElementById('pvTabP').onclick=function(){pvSetPV('board');};
  document.getElementById('pvReconcileBtn').onclick=runReconcile;
  document.getElementById('pvSheetBtn').onclick=function(){document.getElementById('pvSheetFile').click();};
  document.getElementById('pvSheetFile').onchange=function(e){
    var f=e.target.files&&e.target.files[0]; if(!f)return;
    var reader=new FileReader();
    reader.onload=function(){ runSheetSync(reader.result,false); };
    reader.readAsText(f);
    e.target.value='';
  };
  var nav=document.getElementById('navProduction')||document.getElementById('nav');
  if(nav&&!document.getElementById('pvNavBtn')){
    var b=document.createElement('button');b.id='pvNavBtn';b.setAttribute('onclick',"showView('production')");
    b.innerHTML='<span class="ico2"><i class="ri-briefcase-4-line"></i></span>Deal Production';nav.appendChild(b);
  }
  if(typeof window.showView==='function'&&!window.__pvWrap){
    window.__pvWrap=true;var _sv=window.showView;
    window.showView=function(id){
      if(id==='production'){
        // hide standard views via their class (never leave inline display:none on them — it breaks the app's .view.on toggle)
        var sv=document.querySelectorAll('.view');for(var i=0;i<sv.length;i++){sv[i].classList.remove('on');sv[i].style.display='';}
        var pl=document.getElementById('view-personal');if(pl)pl.style.display='none';
        var v=document.getElementById('view-production');if(v)v.style.display='';
        var nbs=document.querySelectorAll('.navgroup button');for(var j=0;j<nbs.length;j++)nbs[j].classList.remove('on');
        var nb=document.getElementById('pvNavBtn');if(nb)nb.classList.add('on');
        if(window.setNavGroup)window.setNavGroup('pr',false);
        var pt=document.getElementById('pageTitle');if(pt)pt.textContent='Deal Production';
        renderProduction();
      } else {
        var v=document.getElementById('view-production');if(v)v.style.display='none';
        // clear any leftover inline display on standard views so the app's class toggle can show them again
        var sv=document.querySelectorAll('.view');for(var i=0;i<sv.length;i++)sv[i].style.display='';
        var nb=document.getElementById('pvNavBtn');if(nb)nb.classList.remove('on');
        _sv(id);
      }
    };
  }
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initProd);else initProd();
})();
