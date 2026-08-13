/* Dispute desk — the round queue and the bureau record behind it.
   Self-injecting module (see mfsn.js/production.js for the pattern): adds its
   own nav button + <section> and wraps window.showView, rather than being
   edited into index.html.

   Carries no money of any kind. The server never sends any on these routes
   (lib/disputes.js builds its rows field by field), so there is nothing here
   to hide -- which is the point: a disputer's surface can't leak a figure it
   was never given. */
(function(){
var BUREAU_LABEL={tu:'TransUnion',eq:'Equifax',ex:'Experian'};
var BUREAUS=['tu','eq','ex'];
var state={queue:[],filter:'workable',search:'',loading:false,openId:null,record:null,err:'',me:null,caps:[],canAssign:false};
// Who is signed in, so the Mine tab can mean something. Deal Production
// records the assignee by display name, so that is what we match on.
var DISPUTERS=[];
window.apiMe().then(function(m){
  state.me=m&&m.name||null;
  state.caps=(m&&Array.isArray(m.capabilities))?m.capabilities:[];
  // Assigning is a desk-manager job, not a disputer one -- a disputer should
  // work their own files, not hand them around. The server enforces this too
  // (va sits in PRODUCTION_FIELDS); hiding the control just avoids offering
  // something that would be refused.
  state.canAssign=state.caps.indexOf('assign')>=0||state.caps.indexOf('admin')>=0;
  if(state.canAssign){
    fetch('/api/users').then(function(r){return r.json();}).then(function(us){
      DISPUTERS=(us||[]).filter(function(u){
        if(u.disabled)return false;
        var c=u.capabilities||[];
        // Fall back to the role when no override is stored.
        if(!u.capabilities)return u.role==='disputer'||u.role==='va'||u.role==='employee';
        return c.indexOf('disputes')>=0;
      }).map(function(u){return u.name||u.username;});
    }).catch(function(){});
  }
  if(document.getElementById('dqBody'))render();
}).catch(function(){});

function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function plural(n,w){return n+' '+w+(n===1?'':'s');}

var css=''+
'#view-disputes{padding:24px 30px 60px}'+
'#view-disputes .dq-sub{color:var(--muted);font-size:12.5px;margin:2px 0 16px;max-width:900px;line-height:1.6}'+
'#view-disputes .dq-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px}'+
'#view-disputes .dq-kpi{background:var(--card);border-radius:8px;box-shadow:0 .25rem 1.875rem rgba(46,45,116,.05);padding:14px 16px;border-top:3px solid var(--line)}'+
'#view-disputes .dq-kpi.ready{border-top-color:#45B369}'+
'#view-disputes .dq-kpi.blocked{border-top-color:#EF4A00}'+
'#view-disputes .dq-kpi .l{font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}'+
'#view-disputes .dq-kpi .v{font-size:24px;font-weight:800;margin-top:6px;letter-spacing:-.5px}'+
'#view-disputes .dq-kpi .s{font-size:11px;color:var(--muted);margin-top:3px}'+
'#view-disputes .dq-tabs{display:inline-flex;border:1px solid var(--line);border-radius:9px;overflow:hidden;margin-bottom:14px}'+
'#view-disputes .dq-tabs button{border:none;background:var(--card);padding:8px 18px;font-size:12.5px;font-weight:700;cursor:pointer;color:var(--muted);border-right:1px solid var(--line)}'+
'#view-disputes .dq-tabs button:last-child{border-right:none}'+
'#view-disputes .dq-tabs button.on{background:var(--inverse-bg);color:var(--inverse-ink)}'+
'#view-disputes .dq-wrap{background:var(--card);border-radius:8px;box-shadow:0 .25rem 1.875rem rgba(46,45,116,.05);overflow:hidden}'+
'#view-disputes table{width:100%;border-collapse:collapse;font-size:13px}'+
'#view-disputes th{text-align:left;padding:11px 14px;font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);background:var(--soft);border-bottom:1px solid var(--line)}'+
'#view-disputes td{padding:11px 14px;border-bottom:1px solid var(--line)}'+
'#view-disputes tbody tr{cursor:pointer}'+
'#view-disputes tbody tr:hover{background:var(--soft)}'+
'#view-disputes .nm{font-weight:650}'+
'#view-disputes .chip{display:inline-block;padding:2px 8px;border-radius:999px;font-size:10.5px;font-weight:700;letter-spacing:.02em}'+
'#view-disputes .chip.ready{background:rgba(69,179,105,.14);color:#2f8a4d}'+
'#view-disputes .chip.login{background:rgba(239,74,0,.13);color:#c93c00}'+
'#view-disputes .chip.done{background:rgba(107,114,128,.14);color:var(--muted)}'+
'#view-disputes .chip.none{background:transparent;color:var(--muted);opacity:.5}'+
'#view-disputes .bu{display:inline-flex;gap:5px}'+
'#view-disputes .days{font-variant-numeric:tabular-nums}'+
'#view-disputes .days.old{color:#c93c00;font-weight:700}'+
'#view-disputes .empty{padding:40px;text-align:center;color:var(--muted);font-size:13px}'+
/* drawer */
'#dqDrawer{position:fixed;top:0;right:0;bottom:0;width:min(560px,92vw);background:var(--card);box-shadow:-8px 0 40px rgba(0,0,0,.16);z-index:1200;display:none;flex-direction:column}'+
'#dqDrawer.on{display:flex}'+
'#dqDrawer .hd{padding:18px 22px;border-bottom:1px solid var(--line);display:flex;align-items:flex-start;gap:12px}'+
'#dqDrawer .hd h3{margin:0;font-size:17px;letter-spacing:-.2px}'+
'#dqDrawer .hd .meta{font-size:12px;color:var(--muted);margin-top:3px}'+
'#dqDrawer .x{margin-left:auto;border:none;background:transparent;font-size:22px;line-height:1;cursor:pointer;color:var(--muted)}'+
'#dqDrawer .bd{padding:18px 22px;overflow:auto;flex:1}'+
'#dqDrawer h4{font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:20px 0 9px}'+
'#dqDrawer h4:first-child{margin-top:0}'+
'#dqDrawer .brow{display:grid;grid-template-columns:1fr 78px 120px;gap:9px;align-items:center;padding:9px 0;border-bottom:1px solid var(--line)}'+
'#dqDrawer .brow b{font-size:13px;font-weight:600}'+
'#dqDrawer select,#dqDrawer input[type=number]{width:100%;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--ink);font-size:12.5px}'+
'#dqDrawer .docs{display:grid;grid-template-columns:1fr 1fr;gap:6px}'+
'#dqDrawer .doc{font-size:12.5px;display:flex;align-items:center;gap:7px;color:var(--muted)}'+
'#dqDrawer .doc.y{color:var(--ink);font-weight:600}'+
'#dqDrawer .cf{font-size:12px;border:1px solid var(--line);border-radius:7px;padding:9px 11px;margin-bottom:7px}'+
'#dqDrawer .cf .r{font-weight:700;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}'+
'#dqDrawer .cf code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;word-break:break-all}'+
'#dqDrawer .note{border-left:2px solid var(--line);padding:4px 0 4px 11px;margin-bottom:10px;font-size:12.5px}'+
'#dqDrawer .note .w{font-size:10.5px;color:var(--muted);margin-bottom:2px}'+
'#dqDrawer textarea{width:100%;min-height:70px;padding:9px 11px;border:1px solid var(--line);border-radius:7px;background:var(--bg);color:var(--ink);font:inherit;font-size:12.5px;resize:vertical}'+
'#dqDrawer .ft{padding:14px 22px;border-top:1px solid var(--line);display:flex;gap:9px}'+
'#dqDrawer .btn{border:none;border-radius:7px;padding:9px 16px;font-size:12.5px;font-weight:700;cursor:pointer}'+
'#dqDrawer .btn.p{background:var(--inverse-bg);color:var(--inverse-ink)}'+
'#dqDrawer .btn.s{background:var(--soft);color:var(--ink)}'+
'#dqDrawer .msg{font-size:12px;margin-left:auto;align-self:center;color:var(--muted)}'+
'#dqScrim{position:fixed;inset:0;background:rgba(15,18,32,.34);z-index:1199;display:none}'+
'#dqScrim.on{display:block}'+
'@media(max-width:900px){#view-disputes{padding:18px 14px 50px}#view-disputes .dq-kpis{grid-template-columns:1fr 1fr}}';

var sectionHTML=''+
'<h2 style="margin:0 0 2px;font-size:22px;letter-spacing:-.4px">Dispute Desk</h2>'+
'<div class="dq-sub">Longest wait first. Files you can actually work today are at the top.</div>'+
'<div class="dq-kpis">'+
 '<div class="dq-kpi ready"><div class="l">Can file now</div><div class="v" id="dqKWorkable">—</div><div class="s">bureau ready, docs complete</div></div>'+
 '<div class="dq-kpi"><div class="l">Waiting on docs</div><div class="v" id="dqKDocs">—</div><div class="s">bureau ready, paperwork missing</div></div>'+
 '<div class="dq-kpi blocked"><div class="l">Blocked on login</div><div class="v" id="dqKBlocked">—</div><div class="s">client must reconnect</div></div>'+
 '<div class="dq-kpi"><div class="l">Mine</div><div class="v" id="dqKMine">—</div><div class="s">assigned to you</div></div>'+
'</div>'+
'<div class="dq-tabs" style="margin-bottom:12px">'+
 '<button data-f="workable" class="on">Can file now</button>'+
 '<button data-f="docs">Waiting on docs</button>'+
 '<button data-f="blocked">Blocked</button>'+
 '<button data-f="mine">Mine</button>'+
 '<button data-f="all">All</button>'+
'</div>'+
'<div style="margin:0 0 14px"><input id="dqSearch" type="search" name="dq-client-search" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="Search a client\u2026" style="width:100%;max-width:320px;padding:8px 12px;border:1px solid var(--line);border-radius:9px;font-size:13px;background:var(--card);color:var(--ink)"></div>'+
'<div class="dq-wrap"><div id="dqBody"><div class="empty">Loading…</div></div></div>';

var drawerHTML=''+
'<div class="hd"><div><h3 id="dqdName">—</h3><div class="meta" id="dqdMeta"></div></div>'+
'<button class="x" id="dqdClose" aria-label="Close">&times;</button></div>'+
'<div class="bd" id="dqdBody"></div>'+
'<div class="ft"><button class="btn p" id="dqdSave">Save</button>'+
'<button class="btn s" id="dqdCancel">Close</button>'+
'<span class="msg" id="dqdMsg"></span></div>';

/* ---------- data ---------- */
function loadQueue(){
  state.loading=true;render();
  fetch('/api/disputes/queue',{credentials:'same-origin'})
    .then(function(r){ if(!r.ok) throw new Error(r.status===403?'Not permitted':'Could not load the queue'); return r.json(); })
    .then(function(j){ state.queue=j.queue||[];state.err='';state.loading=false;render(); })
    .catch(function(e){ state.err=e.message;state.loading=false;render(); });
}

function visible(){
  var rows=state.queue;
  if(state.filter==='mine') rows=state.me?rows.filter(function(r){return r.assignedTo===state.me;}):[];
  else if(state.filter==='workable') rows=rows.filter(function(r){return r.workableNow;});
  else if(state.filter==='docs') rows=rows.filter(function(r){return r.status==='ready'&&!r.workableNow;});
  else if(state.filter==='blocked') rows=rows.filter(function(r){return r.status==='blocked';});
  if(state.search){
    var q=state.search.toLowerCase();
    rows=rows.filter(function(r){return String(r.name||'').toLowerCase().indexOf(q)>=0;});
  }
  return rows;
}

/* ---------- queue render ---------- */
// Missing paperwork is the usual reason a round that reads "ready" can't
// actually go out. null means nothing is recorded for this client, which is
// not the same as nothing missing, so it stays blank rather than showing 0.
function docCell(n,tracked){
  // Nobody has ever ticked a document box in this system, so "8 missing" on
  // every row is an empty field being rendered as a blocker. Say it is not
  // tracked rather than implying somebody failed to collect anything.
  if(tracked===false)return '<span style="opacity:.35" title="Document checklist is not being used yet">not tracked</span>';
  if(n===null||n===undefined)return '<span style="opacity:.35">—</span>';
  if(n===0)return '<span class="chip done">all in</span>';
  return '<span class="chip login">'+n+' missing</span>';
}
function chip(st){
  var label={ready:'Ready',login:'Blocked',done:'Filed',none:'—'}[st]||st;
  return '<span class="chip '+esc(st)+'">'+esc(label)+'</span>';
}

function render(){
  var host=document.getElementById('dqBody');if(!host)return;
  var workable=state.queue.filter(function(r){return r.workableNow;}).length;
  var docsWait=state.queue.filter(function(r){return r.status==='ready'&&!r.workableNow;}).length;
  var tracked=state.queue.some(function(r){return r.docsTracked;});
  var docsTab=document.querySelector('.dq-tabs button[data-f="docs"]');
  if(docsTab)docsTab.style.display=tracked?'':'none';
  var docsKpi=document.getElementById('dqKDocs');
  if(docsKpi&&docsKpi.closest('.dq-kpi'))docsKpi.closest('.dq-kpi').style.display=tracked?'':'none';
  var blocked=state.queue.filter(function(r){return r.status==='blocked';}).length;
  var mine=state.me?state.queue.filter(function(r){return r.assignedTo===state.me;}).length:0;
  var set=function(id,v){var e=document.getElementById(id);if(e)e.textContent=v;};
  set('dqKWorkable',workable);set('dqKDocs',docsWait);set('dqKBlocked',blocked);set('dqKMine',mine);

  if(state.loading){host.innerHTML='<div class="empty">Loading…</div>';return;}
  if(state.err){host.innerHTML='<div class="empty">'+esc(state.err)+'</div>';return;}
  var rows=visible();
  if(!rows.length){
    var msg = state.search ? 'No client matches that.'
      : state.filter==='mine' ? (state.me?'Nothing assigned to you.':'Could not tell who you are signed in as.')
      : state.filter==='workable' ? 'Nothing can be filed today \u2014 check Waiting on docs.'
      : state.filter==='docs' ? 'No files are waiting on paperwork.'
      : state.filter==='blocked' ? 'Nothing is blocked on a login.'
      : 'Nothing in this list right now.';
    host.innerHTML='<div class="empty">'+msg+'</div>';
    return;
  }

  var h='<table><thead><tr><th>Client</th><th>Stage</th><th>Round</th><th>TransUnion</th><th>Equifax</th><th>Experian</th><th>Docs</th><th>Assigned</th></tr></thead><tbody>';
  rows.forEach(function(r){
    var stAt=function(b){
      if(r.readyBureaus.indexOf(b)>=0)return 'ready';
      if(r.blockedBureaus.indexOf(b)>=0)return 'login';
      return 'done';
    };
    h+='<tr data-id="'+esc(r.id)+'">'+
      '<td class="nm">'+esc(r.name)+'</td>'+
      '<td>'+esc(r.stage)+'</td>'+
      '<td>'+(r.currentRound||'—')+'</td>'+
      '<td>'+chip(stAt('tu'))+'</td>'+
      '<td>'+chip(stAt('eq'))+'</td>'+
      '<td>'+chip(stAt('ex'))+'</td>'+
      '<td>'+docCell(r.docsMissing,r.docsTracked)+'</td>'+
      '<td>'+(r.assignedTo?esc(r.assignedTo):'<span style="opacity:.45">—</span>')+'</td>'+
    '</tr>';
  });
  h+='</tbody></table>';
  host.innerHTML=h;
  host.querySelectorAll('tbody tr').forEach(function(tr){
    tr.onclick=function(){openRecord(tr.getAttribute('data-id'));};
  });
}

/* ---------- drawer ---------- */
function openRecord(id){
  state.openId=id;state.record=null;
  var d=document.getElementById('dqDrawer'),s=document.getElementById('dqScrim');
  if(d)d.classList.add('on');if(s)s.classList.add('on');
  document.getElementById('dqdName').textContent='Loading…';
  document.getElementById('dqdMeta').textContent='';
  document.getElementById('dqdBody').innerHTML='';
  document.getElementById('dqdMsg').textContent='';
  fetch('/api/disputes/'+encodeURIComponent(id),{credentials:'same-origin'})
    .then(function(r){ if(!r.ok)throw new Error('Could not load this client'); return r.json(); })
    .then(function(j){ state.record=j;renderRecord(); })
    .catch(function(e){ document.getElementById('dqdBody').innerHTML='<div class="empty">'+esc(e.message)+'</div>'; });
}

function closeRecord(){
  state.openId=null;state.record=null;
  var d=document.getElementById('dqDrawer'),s=document.getElementById('dqScrim');
  if(d)d.classList.remove('on');if(s)s.classList.remove('on');
}

function renderRecord(){
  var r=state.record;if(!r)return;
  document.getElementById('dqdName').textContent=r.name||'—';
  document.getElementById('dqdMeta').textContent=r.stage+' · round '+(r.currentRound||0)+' · '+plural(r.days||0,'day')+' in stage'+(r.assignedTo?(' · '+r.assignedTo):'');

  var h='';
  if(state.canAssign){
    var opts=['<option value="">Unassigned</option>'].concat(
      DISPUTERS.concat(r.assignedTo&&DISPUTERS.indexOf(r.assignedTo)<0?[r.assignedTo]:[])
        .map(function(n){return '<option value="'+esc(n)+'"'+(r.assignedTo===n?' selected':'')+'>'+esc(n)+'</option>';})
    ).join('');
    h+='<h4>Assigned to</h4><div class="brow" style="grid-template-columns:1fr">'
      +'<select id="dqdAssign" aria-label="Assigned disputer" style="width:100%">'+opts+'</select>'
      +'</div>';
  } else if(r.assignedTo){
    h+='<h4>Assigned to</h4><div class="brow" style="grid-template-columns:1fr"><b>'+esc(r.assignedTo)+'</b></div>';
  }
  h+='<h4>Bureau status</h4>';
  BUREAUS.forEach(function(b){
    var cur=r.bureaus[b]||{round:0,status:'none'};
    h+='<div class="brow"><b>'+BUREAU_LABEL[b]+'</b>'+
      '<input type="number" min="0" max="20" id="dqr_'+b+'" value="'+(cur.round||0)+'" aria-label="'+BUREAU_LABEL[b]+' round">'+
      '<select id="dqs_'+b+'" aria-label="'+BUREAU_LABEL[b]+' status">'+
        ['ready','done','login','none'].map(function(o){
          var lab={ready:'Ready to file',done:'Filed',login:'Blocked — no login',none:'Not worked'}[o];
          return '<option value="'+o+'"'+(cur.status===o?' selected':'')+'>'+lab+'</option>';
        }).join('')+
      '</select></div>';
  });

  var docKeys=Object.keys(r.docs||{});
  if(docKeys.length){
    h+='<h4>Documents on file</h4><div class="docs">';
    docKeys.forEach(function(k){
      var on=!!r.docs[k];
      h+='<div class="doc'+(on?' y':'')+'">'+(on?'✓':'○')+' '+esc(k)+'</div>';
    });
    h+='</div>';
  }

  var cf=r.cfpb||[];
  h+='<h4>CFPB portal logins</h4>';
  if(!cf.length){ h+='<div style="font-size:12.5px;color:var(--muted)">None recorded yet.</div>'; }
  else{
    cf.forEach(function(c){
      h+='<div class="cf"><div class="r">Round '+esc(c.round!=null?c.round:'—')+(c.date?(' · '+esc(c.date)):'')+'</div>'+
        '<code>'+esc(c.email||'—')+'</code>'+(c.pw?' · <code>'+esc(c.pw)+'</code>':'')+'</div>';
    });
  }

  h+='<h4>Notes</h4>';
  (r.notes||[]).slice().reverse().forEach(function(n){
    h+='<div class="note"><div class="w">'+esc(n.who||'—')+' · '+esc(n.when||'')+'</div>'+esc(n.text||'')+'</div>';
  });
  h+='<textarea id="dqdNote" placeholder="Add a note — what you filed, what you are waiting on…"></textarea>';

  document.getElementById('dqdBody').innerHTML=h;
}

function saveRecord(){
  var r=state.record;if(!r)return;
  var patch={};
  BUREAUS.forEach(function(b){
    var rd=document.getElementById('dqr_'+b),st=document.getElementById('dqs_'+b);
    if(!rd||!st)return;
    var round=parseInt(rd.value,10)||0, status=st.value;
    var cur=r.bureaus[b]||{round:0,status:'none'};
    if(round!==cur.round||status!==cur.status) patch[b]={r:round,st:status};
  });
  var asg=document.getElementById('dqdAssign');
  if(asg){
    var want=asg.value||'';
    var cur=r.assignedTo||'';
    if(want!==cur)patch.va=want;
  }

  var noteEl=document.getElementById('dqdNote');
  var note=noteEl?noteEl.value.trim():'';
  if(note)patch.note=note;

  var msg=document.getElementById('dqdMsg');
  if(!Object.keys(patch).length){ msg.textContent='Nothing changed.'; return; }
  msg.textContent='Saving…';
  fetch('/api/disputes/'+encodeURIComponent(state.openId),{
    method:'PATCH',credentials:'same-origin',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(patch)
  }).then(function(res){
    if(!res.ok)return res.json().then(function(j){throw new Error(j.error||'Save failed');});
    return res.json();
  }).then(function(j){
    state.record=j;renderRecord();
    msg.textContent='Saved.';
    loadQueue();
    setTimeout(function(){ if(msg)msg.textContent=''; },2200);
  }).catch(function(e){ msg.textContent=e.message; });
}

/* ---------- init ---------- */
function initDQ(){
  if(document.getElementById('view-disputes'))return;

  var style=document.createElement('style');style.textContent=css;document.head.appendChild(style);

  var anc=document.getElementById('view-dash');
  var sec=document.createElement('section');
  sec.id='view-disputes';sec.style.display='none';sec.innerHTML=sectionHTML;
  if(anc&&anc.parentNode)anc.parentNode.insertBefore(sec,anc);else document.body.appendChild(sec);

  var scrim=document.createElement('div');scrim.id='dqScrim';document.body.appendChild(scrim);
  var drawer=document.createElement('aside');drawer.id='dqDrawer';drawer.innerHTML=drawerHTML;
  document.body.appendChild(drawer);
  scrim.onclick=closeRecord;
  document.getElementById('dqdClose').onclick=closeRecord;
  document.getElementById('dqdCancel').onclick=closeRecord;
  document.getElementById('dqdSave').onclick=saveRecord;

  var sb=sec.querySelector('#dqSearch');
  if(sb)sb.oninput=function(){ state.search=sb.value.trim(); render(); };
  sec.querySelectorAll('.dq-tabs button').forEach(function(b){
    b.onclick=function(){
      state.filter=b.getAttribute('data-f');
      sec.querySelectorAll('.dq-tabs button').forEach(function(x){x.classList.remove('on');});
      b.classList.add('on');
      render();
    };
  });

  // Same nav host the other self-injecting modules use. The button carries a
  // stable id because role.js gates nav by id (see HANDOFF.md §8) -- renaming
  // it silently breaks gating for everyone else.
  var nav=document.getElementById('navProduction')||document.getElementById('nav');
  if(nav&&!document.getElementById('disputesNavBtn')){
    var b=document.createElement('button');
    b.id='disputesNavBtn';b.setAttribute('onclick',"showView('disputes')");
    b.innerHTML='<span class="ico2"><i class="ri-scales-3-line"></i></span>Dispute Desk';
    nav.appendChild(b);
  }

  if(typeof window.showView==='function'&&!window.__dqWrap){
    window.__dqWrap=true;var _sv=window.showView;
    window.showView=function(id){
      if(id==='disputes'){
        var sv=document.querySelectorAll('.view');
        for(var i=0;i<sv.length;i++){sv[i].classList.remove('on');sv[i].style.display='';}
        ['view-production','view-personal','view-rev','view-mfsn'].forEach(function(x){
          var e=document.getElementById(x);if(e)e.style.display='none';
        });
        var v=document.getElementById('view-disputes');if(v)v.style.display='';
        var nbs=document.querySelectorAll('.navgroup button');
        for(var j=0;j<nbs.length;j++)nbs[j].classList.remove('on');
        var nb=document.getElementById('disputesNavBtn');if(nb)nb.classList.add('on');
        if(window.setNavGroup)window.setNavGroup('pr',false);
        var pt=document.getElementById('pageTitle');if(pt)pt.textContent='Dispute Desk';
        loadQueue();
      } else {
        var v=document.getElementById('view-disputes');if(v)v.style.display='none';
        closeRecord();
        var sv=document.querySelectorAll('.view');
        for(var i=0;i<sv.length;i++)sv[i].style.display='';
        var nb=document.getElementById('disputesNavBtn');if(nb)nb.classList.remove('on');
        _sv(id);
      }
    };
  }

  // A disputer has no dashboard to land on -- the desk is their home screen.
  if(window.__me&&Array.isArray(window.__me.capabilities)
     &&window.__me.capabilities.indexOf('disputes')>=0
     &&window.__me.capabilities.indexOf('revenue')<0){
    setTimeout(function(){ if(window.showView)window.showView('disputes'); },0);
  }
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initDQ);else initDQ();
})();
