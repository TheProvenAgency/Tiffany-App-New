/* The Audit — Tiffany's file-by-file pass over the whole book.
   Self-injecting module (see disputes.js/production.js for the pattern).
   Admin-only: the asset gate refuses this file to worker sessions, so the
   nav button below only ever exists for someone allowed to use it.

   The workflow it serves, from the 8/17 call: start at client #1, open the
   file next to DisputeFox, message the client, then mark what the audit
   found -- Graduated (credit fully finished, upsell material), Completed
   (paid rounds fulfilled, may still need work), Free round (ran out of
   rounds, doing one free to re-engage), or Still in process. A client with
   no mark hasn't been audited -- which is also how clients that arrive
   NEXT month show up as needing one, with no extra bookkeeping. */
(function(){
var state={rows:[],totals:null,filter:'todo',search:'',loading:false,err:''};
var SHOW=100, showCount=SHOW;

var OUT_LABEL={graduated:'Graduated',completed:'Completed',free_round:'Free round',in_progress:'In process'};
var OUT_DESC={
  graduated:'Their credit is fully finished — nothing left to fix',
  completed:'They got everything they paid for — but their credit may still need work',
  free_round:'Out of rounds — giving them one free to bring them back',
  in_progress:'Still working on their credit — keep going as normal'
};
var OUT_COLOR={graduated:'#45B369',completed:'#4F46E5',free_round:'#D97706',in_progress:'#9CA3AF'};

function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

var css=''+
'#view-audit{padding:24px 30px 60px}'+
'#view-audit .au-top{display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-bottom:14px}'+
'#view-audit .au-prog{flex:1;min-width:260px;background:var(--card);border-radius:10px;padding:14px 18px;box-shadow:0 .25rem 1.875rem rgba(46,45,116,.05)}'+
'#view-audit .au-prog b{font-size:24px;letter-spacing:-.5px}'+
'#view-audit .au-bar{height:8px;background:var(--soft);border-radius:999px;margin-top:8px;overflow:hidden}'+
'#view-audit .au-bar i{display:block;height:100%;background:#45B369;border-radius:999px;transition:width .3s}'+
'#view-audit .au-pills{display:flex;gap:8px;flex-wrap:wrap}'+
'#view-audit .au-pill{background:var(--card);border-radius:10px;padding:10px 14px;box-shadow:0 .25rem 1.875rem rgba(46,45,116,.05);font-size:12px;color:var(--muted)}'+
'#view-audit .au-pill b{display:block;font-size:17px;color:var(--ink)}'+
'#view-audit .au-tabs{display:inline-flex;border:1px solid var(--line);border-radius:9px;overflow:hidden;margin:0 10px 12px 0}'+
'#view-audit .au-tabs button{border:none;background:var(--card);padding:8px 14px;font-size:12px;font-weight:700;cursor:pointer;color:var(--muted);border-right:1px solid var(--line)}'+
'#view-audit .au-tabs button:last-child{border-right:none}'+
'#view-audit .au-tabs button.on{background:var(--inverse-bg);color:var(--inverse-ink)}'+
'#view-audit input[type=search]{padding:8px 12px;border:1px solid var(--line);border-radius:9px;font-size:13px;background:var(--card);color:var(--ink);width:250px}'+
'#view-audit table{width:100%;border-collapse:collapse;font-size:13px;background:var(--card);border-radius:10px;overflow:hidden;box-shadow:0 .25rem 1.875rem rgba(46,45,116,.05)}'+
'#view-audit th{text-align:left;padding:11px 12px;font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);background:var(--soft);border-bottom:1px solid var(--line)}'+
'#view-audit td{padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:middle}'+
'#view-audit .au-n{color:var(--muted);font-variant-numeric:tabular-nums;width:52px}'+
'#view-audit .au-nm{font-weight:650;cursor:pointer}'+
'#view-audit .au-nm:hover{text-decoration:underline}'+
'#view-audit .au-sub{font-size:11px;color:var(--muted)}'+
'#view-audit .au-out{display:inline-block;padding:3px 10px;border-radius:999px;font-size:10.5px;font-weight:700;color:#fff}'+
'#view-audit .au-markbtn{border:1px solid var(--line);background:var(--card);color:var(--ink);font-size:11.5px;font-weight:700;padding:5px 12px;border-radius:8px;cursor:pointer}'+
'#view-audit .au-markbtn:hover{background:var(--soft)}'+
'#view-audit .au-menu{position:absolute;right:0;top:100%;margin-top:4px;background:var(--card);border:1px solid var(--line);border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.16);z-index:50;min-width:290px;padding:6px}'+
'#view-audit .au-menu .opt{padding:8px 10px;border-radius:8px;cursor:pointer}'+
'#view-audit .au-menu .opt:hover{background:var(--soft)}'+
'#view-audit .au-menu .opt b{display:block;font-size:12.5px}'+
'#view-audit .au-menu .opt span{font-size:11px;color:var(--muted)}'+
'#view-audit .au-empty{padding:40px;text-align:center;color:var(--muted)}'+
'#view-audit .au-more{padding:12px;text-align:center;color:var(--blue,#4F46E5);font-weight:700;cursor:pointer}'+
'#view-audit .au-pkg{display:inline-block;background:var(--soft);border:1px solid var(--line);border-radius:6px;padding:2px 8px;font-size:10.5px;font-weight:600;margin:2px 4px 0 0;color:var(--ink)}'+
'#view-audit .au-rbar{display:inline-block;vertical-align:middle;width:64px;height:5px;background:var(--soft);border-radius:999px;margin-left:7px;overflow:hidden}'+
'#view-audit .au-rbar i{display:block;height:100%;border-radius:999px}'+
'#view-audit .au-bu{display:inline-block;font-size:10px;color:var(--muted);border:1px solid var(--line);border-radius:5px;padding:1px 6px;margin-right:3px}'+
'#view-audit .au-bu.has{color:var(--ink);border-color:var(--ink)}'+
'#view-audit .au-mfsn{display:inline-block;padding:2px 9px;border-radius:999px;font-size:10.5px;font-weight:700}'+
'#view-audit .au-mfsn.on{background:rgba(69,179,105,.15);color:#2f8a4d}'+
'#view-audit .au-mfsn.off{background:rgba(217,119,6,.14);color:#b45309}'+
'#view-audit .au-saved{color:#2f8a4d;font-weight:700;font-size:11px}'+
'#view-audit .au-replied{display:inline-block;background:#4F46E5;color:#fff;border-radius:999px;font-size:9.5px;font-weight:800;padding:1px 7px;vertical-align:2px}'+
/* the audit drawer: the whole file + their conversation, one panel */
'#auDrawer{position:fixed;top:0;right:0;bottom:0;width:min(640px,94vw);background:var(--card);box-shadow:-8px 0 40px rgba(0,0,0,.16);z-index:1300;display:none;flex-direction:column}'+
'#auDrawer.on{display:flex}'+
'#auDrawer .hd{padding:16px 20px;border-bottom:1px solid var(--line);display:flex;align-items:flex-start;gap:10px}'+
'#auDrawer .hd h3{margin:0;font-size:17px}'+
'#auDrawer .hd .meta{font-size:12px;color:var(--muted);margin-top:2px}'+
'#auDrawer .x{margin-left:auto;border:none;background:transparent;font-size:22px;cursor:pointer;color:var(--muted)}'+
'#auDrawer .bd{padding:14px 20px;overflow:auto;flex:1}'+
'#auDrawer h4{font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:16px 0 8px}'+
'#auDrawer h4:first-child{margin-top:0}'+
'#auDrawer .fact{display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid var(--line);font-size:12.5px}'+
'#auDrawer .fact b{font-weight:650;text-align:right}'+
'#auDrawer .au-outcards{display:grid;grid-template-columns:1fr 1fr;gap:8px}'+
'#auDrawer .au-outcard{border:2px solid var(--line);border-radius:11px;padding:10px 12px;cursor:pointer;transition:border-color .12s}'+
'#auDrawer .au-outcard:hover{border-color:var(--oc)}'+
'#auDrawer .au-outcard.on{border-color:var(--oc);background:color-mix(in srgb,var(--oc) 8%,var(--card))}'+
'#auDrawer .au-outcard b{display:block;font-size:13px;color:var(--oc);margin-bottom:2px}'+
'#auDrawer .au-outcard span{font-size:11px;color:var(--muted);line-height:1.5;display:block}'+
'#auDrawer .au-hint{font-size:9.5px;background:var(--oc);color:#fff;border-radius:999px;padding:1px 7px;vertical-align:2px}'+
'#auDrawer .note{border-left:2px solid var(--line);padding:3px 0 3px 10px;margin-bottom:8px;font-size:12.5px}'+
'#auDrawer .note .w{font-size:10.5px;color:var(--muted)}'+
'#auDrawer .msgs{border:1px solid var(--line);border-radius:10px;max-height:300px;overflow:auto;padding:10px;background:var(--bg)}'+
'#auDrawer .mb{max-width:82%;padding:7px 11px;border-radius:12px;font-size:12.5px;margin-bottom:7px;white-space:pre-wrap;word-break:break-word}'+
'#auDrawer .mb.in{background:var(--card);border:1px solid var(--line)}'+
'#auDrawer .mb.out{background:#4F46E5;color:#fff;margin-left:auto}'+
'#auDrawer .mmeta{font-size:9.5px;opacity:.6;margin-top:2px}'+
'#auDrawer .comp{display:flex;gap:8px;margin-top:8px}'+
'#auDrawer .comp textarea{flex:1;min-height:44px;padding:8px 10px;border:1px solid var(--line);border-radius:9px;font:inherit;font-size:12.5px;resize:vertical;background:var(--card);color:var(--ink)}'+
'#auDrawer .comp button{border:0;border-radius:9px;background:#4F46E5;color:#fff;font-weight:700;padding:0 16px;cursor:pointer}'+
'#auScrim{position:fixed;inset:0;background:rgba(15,18,32,.34);z-index:1299;display:none}'+
'#auScrim.on{display:block}';

var sectionHTML=''+
'<h2 style="margin:0 0 2px;font-size:22px;letter-spacing:-.4px">The Audit</h2>'+
'<div style="background:var(--card);border-radius:10px;padding:12px 16px;margin:0 0 14px;box-shadow:0 .25rem 1.875rem rgba(46,45,116,.05);display:flex;gap:16px;align-items:center;flex-wrap:wrap">'+
' <button id="auStart" style="border:0;border-radius:10px;background:#4F46E5;color:#fff;font-weight:800;font-size:14px;padding:12px 22px;cursor:pointer;flex:none">Start auditing \u2192</button>'+
' <div style="font-size:12.5px;color:var(--muted);line-height:1.7;min-width:240px;flex:1">'+
'  <b style="color:var(--ink)">1.</b> The next un-audited file opens with everything about them &nbsp;'+
'  <b style="color:var(--ink)">2.</b> Check DisputeFox, message them right in the panel &nbsp;'+
'  <b style="color:var(--ink)">3.</b> Pick what you found \u2014 it saves and opens the next file'+
' </div>'+
'</div>'+
'<div class="au-top">'+
' <div class="au-prog"><b id="auDone">—</b> <span class="au-sub" id="auOf"></span><div class="au-bar"><i id="auBarFill" style="width:0%"></i></div></div>'+
' <div class="au-pills" id="auPills"></div>'+
'</div>'+
'<div style="display:flex;align-items:center;flex-wrap:wrap;gap:0 10px">'+
'<div class="au-tabs" id="auTabs">'+
' <button data-f="todo" class="on">Not audited</button>'+
' <button data-f="graduated">Graduated</button>'+
' <button data-f="completed">Completed</button>'+
' <button data-f="free_round">Free round</button>'+
' <button data-f="in_progress">In process</button>'+
' <button data-f="replied">Replied</button>'+
' <button data-f="all">All</button>'+
'</div>'+
'<input id="auSearch" type="search" placeholder="Find a client…" autocomplete="off">'+
'</div>'+
'<div id="auBody" style="margin-top:10px"><div class="au-empty">Loading…</div></div>';

function load(){
  state.loading=true;render();
  fetch('/api/audit',{credentials:'same-origin'})
    .then(function(r){if(!r.ok)throw new Error(r.status===403?'Not permitted':'Could not load');return r.json();})
    .then(function(d){state.rows=d.rows||[];state.totals=d.totals||null;state.err='';state.loading=false;render();})
    .catch(function(e){state.err=e.message;state.loading=false;render();});
}

function visible(){
  var rows=state.rows;
  if(state.filter==='todo')rows=rows.filter(function(r){return !r.audit;});
  else if(state.filter==='replied')rows=rows.filter(function(r){return r.replied;});
  else if(state.filter!=='all')rows=rows.filter(function(r){return r.audit&&r.audit.outcome===state.filter;});
  if(state.search){
    var q=state.search.toLowerCase();
    rows=rows.filter(function(r){return String(r.name||'').toLowerCase().indexOf(q)>=0;});
  }
  return rows;
}

// Each comma-separated segment of the package field is a separate thing
// they bought (the field accumulates purchases) -- so show each purchase
// as its own chip instead of one truncated string nobody can read.
function pkgChips(pkg){
  var parts=String(pkg||'').split(',').map(function(x){return x.trim();}).filter(Boolean);
  // "Upgrade to Unlimited" and "funding" segments confuse the pass (they
  // presume tags she hasn't made yet), so they don't render as chips. The
  // data is untouched: the rounds math still honors the unlimited upgrade,
  // and the full package string is on the full profile.
  var shown=parts.filter(function(pp){return !/upgrade to unlimited/i.test(pp)&&!/funding/i.test(pp);});
  if(!parts.length)return '<span class="au-sub">no package recorded</span>';
  if(!shown.length)return '<span class="au-sub">see full profile</span>';
  return shown.map(function(pp){return '<span class="au-pkg">'+esc(pp)+'</span>';}).join('');
}
function roundsBar(r){
  if(r.unlimited)return '<span class="au-sub"><b style="color:var(--ink)">'+(r.roundsUsed||0)+'</b> used \u00b7 no round limit</span>';
  if(r.roundsIncluded==null)return '<span class="au-sub"><b style="color:var(--ink)">'+(r.roundsUsed||0)+'</b> used \u00b7 package unclear</span>';
  var used=r.roundsUsed||0, inc=r.roundsIncluded||0;
  var pct=inc?Math.min(100,Math.round(used/inc*100)):0;
  return '<span class="au-sub"><b style="color:var(--ink)">'+used+'</b> of <b style="color:var(--ink)">'+inc+'</b> rounds</span>'
    +'<span class="au-rbar"><i style="width:'+pct+'%;background:'+(used>=inc?'#45B369':'#4F46E5')+'"></i></span>';
}
function bureauCell(r){
  return [['TU',r.tu],['EQ',r.eq],['EX',r.ex]].map(function(p){
    var rd=(p[1]&&p[1].r)||0;
    return '<span class="au-bu'+(rd?' has':'')+'">'+p[0]+' <b>R'+rd+'</b></span>';
  }).join('');
}

function render(){
  var host=document.getElementById('auBody');if(!host)return;
  var t=state.totals;
  if(t){
    document.getElementById('auDone').textContent=t.audited.toLocaleString();
    document.getElementById('auOf').textContent='of '+t.clients.toLocaleString()+' audited · '+t.remaining.toLocaleString()+' to go';
    document.getElementById('auBarFill').style.width=(t.clients?Math.round(t.audited/t.clients*100):0)+'%';
    document.getElementById('auPills').innerHTML=['graduated','completed','free_round','in_progress'].map(function(k){
      return '<div class="au-pill"><b style="color:'+OUT_COLOR[k]+'">'+(t[k]||0).toLocaleString()+'</b>'+OUT_LABEL[k]+'</div>';
    }).join('')
    // the after-the-audit part: did the outreach work?
    +(t.audited?'<div class="au-pill"><b style="color:#2f8a4d">'+(t.auditedMfsnOn||0).toLocaleString()+'</b>of audited: MFSN on</div>'
      +'<div class="au-pill"><b style="color:#4F46E5">'+(t.auditedReplied||0).toLocaleString()+'</b>of audited: replied</div>':'');
  }
  if(state.loading){host.innerHTML='<div class="au-empty">Loading…</div>';return;}
  if(state.err){host.innerHTML='<div class="au-empty">'+esc(state.err)+'</div>';return;}
  var rows=visible();
  if(!rows.length){
    host.innerHTML='<div class="au-empty">'+(state.search?'No client matches that.'
      :state.filter==='todo'?'Every file has been audited. New clients will appear here as they come in.':'Nobody marked '+(OUT_LABEL[state.filter]||'that')+' yet.')+'</div>';
    return;
  }
  var h='<table><thead><tr><th>#</th><th>Client &amp; what they bought</th><th>Rounds</th><th>By bureau</th><th>MFSN</th><th>Last paid</th><th>Audit</th></tr></thead><tbody>';
  rows.slice(0,showCount).forEach(function(r){
    var a=r.audit;
    h+='<tr data-id="'+esc(r.id)+'">'+
      '<td class="au-n">'+r.n+'</td>'+
      '<td style="max-width:340px"><span class="au-nm" data-open="'+esc(r.id)+'">'+esc(r.name)+'</span>'
        +(r.replied?' <span class="au-replied" title="They sent the last message \u2014 waiting on you">replied</span>':'')
        +' <span class="au-sub">'+esc(r.stage||'')+(r.va?(' \u00b7 '+esc(r.va)):'')+'</span>'
        +'<div>'+pkgChips(r.pkg)+'</div></td>'+
      '<td style="white-space:nowrap">'+roundsBar(r)+'</td>'+
      '<td style="white-space:nowrap">'+bureauCell(r)+'</td>'+
      '<td>'+(r.mfsn==='affiliate'?'<span class="au-mfsn on">On</span>':'<span class="au-mfsn off">Off</span>')+'</td>'+
      '<td class="au-sub" style="white-space:nowrap">'+(r.lastPaid?String(r.lastPaid).slice(0,10):'\u2014')+'</td>'+
      '<td style="position:relative;white-space:nowrap">'+
        (a?'<span class="au-out" style="background:'+OUT_COLOR[a.outcome]+'">'+OUT_LABEL[a.outcome]+'</span>'
           +'<div class="au-sub">'+esc(a.who)+' · '+String(a.at).slice(0,10)+' <span class="au-saved">saved \u2713</span></div>'
           +'<a href="#" class="au-sub" data-clear="'+esc(r.id)+'">undo</a>'
          :'<button class="au-markbtn" data-mark="'+esc(r.id)+'">Mark audited</button>')+
      '</td>'+
    '</tr>';
  });
  h+='</tbody></table>';
  if(rows.length>showCount)h+='<div class="au-more" id="auMore">Show '+Math.min(SHOW,rows.length-showCount)+' more ('+(rows.length-showCount).toLocaleString()+' left)</div>';
  host.innerHTML=h;

  Array.prototype.forEach.call(host.querySelectorAll('[data-open]'),function(el){
    el.onclick=function(){openFile(el.dataset.open);};
  });
  Array.prototype.forEach.call(host.querySelectorAll('[data-mark]'),function(btn){
    btn.onclick=function(ev){
      ev.stopPropagation();
      closeMenus();
      var cell=btn.parentNode;
      var m=document.createElement('div');m.className='au-menu';
      m.innerHTML=Object.keys(OUT_LABEL).map(function(k){
        return '<div class="opt" data-o="'+k+'"><b style="color:'+OUT_COLOR[k]+'">'+OUT_LABEL[k]+'</b><span>'+OUT_DESC[k]+'</span></div>';
      }).join('');
      cell.appendChild(m);
      Array.prototype.forEach.call(m.querySelectorAll('.opt'),function(o){
        o.onclick=function(e){e.stopPropagation();mark(btn.dataset.mark,o.dataset.o);};
      });
    };
  });
  Array.prototype.forEach.call(host.querySelectorAll('[data-clear]'),function(el){
    el.onclick=function(ev){ev.preventDefault();ev.stopPropagation();mark(el.dataset.clear,null);};
  });
  var more=document.getElementById('auMore');
  if(more)more.onclick=function(){showCount+=SHOW;render();};
}
function closeMenus(){Array.prototype.forEach.call(document.querySelectorAll('#view-audit .au-menu'),function(m){m.remove();});}
document.addEventListener('click',closeMenus);

function mark(id,outcome){
  fetch('/api/audit/'+encodeURIComponent(id),{
    method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({outcome:outcome})
  }).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||'Could not save');return j;});})
  .then(function(j){
    var row=state.rows.filter(function(x){return String(x.id)===String(id);})[0];
    if(row)row.audit=j.audit;
    // recompute totals locally -- no refetch needed for one tick
    var t={clients:state.rows.length,audited:0,remaining:0,graduated:0,completed:0,free_round:0,in_progress:0};
    state.rows.forEach(function(x){if(x.audit){t.audited++;if(t[x.audit.outcome]!=null)t[x.audit.outcome]++;}});
    t.remaining=t.clients-t.audited;
    state.totals=t;
    render();
  }).catch(function(e){alert(e.message);});
}

/* ---------- the audit drawer: everything about one person ---------- */
function nextTodo(afterId){
  var rows=state.rows, start=0;
  if(afterId!=null){
    var i=rows.findIndex(function(x){return String(x.id)===String(afterId);});
    if(i>=0)start=i+1;
  }
  for(var k=start;k<rows.length;k++)if(!rows[k].audit)return rows[k];
  for(var k2=0;k2<start;k2++)if(!rows[k2].audit)return rows[k2];
  return null;
}
// One plain sentence that reads the file FOR her, plus which outcome it
// usually means -- so the decision starts made and she only corrects it.
function readFile(r){
  var first=(r.name||'This client').split(' ')[0];
  var bits=[], suggest=null, why='';
  if(r.unlimited){
    bits.push(first+'\u2019s package has <b>no round limit</b> \u2014 they\u2019ve used '+(r.roundsUsed||0)+' rounds so far');
    suggest='in_progress'; why='this package keeps going until their credit is done';
  }else if(r.roundsIncluded==null){
    bits.push(first+'\u2019s package can\u2019t be read automatically ('+esc(String(r.pkg||'').slice(0,40))+'\u2026)');
    suggest=null; why='';
  }else if((r.roundsUsed||0)>=r.roundsIncluded){
    bits.push(first+' paid for <b>'+r.roundsIncluded+'</b> round'+(r.roundsIncluded===1?'':'s')+' and used <b>all of them</b>');
    suggest='completed'; why='they got everything they paid for \u2014 usually Completed. If their credit is fully finished, pick Graduated instead.';
  }else{
    bits.push(first+' paid for <b>'+r.roundsIncluded+'</b> round'+(r.roundsIncluded===1?'':'s')+' and has <b>'+(r.roundsIncluded-(r.roundsUsed||0))+' left</b>');
    suggest='in_progress'; why='rounds are still owed \u2014 usually still In process';
  }
  bits.push('monitoring is '+(r.mfsn==='affiliate'?'<b style="color:#2f8a4d">ON</b>':'<b style="color:#b45309">OFF</b>'));
  if(r.lastPaid){
    var d=Math.round((Date.now()-new Date(r.lastPaid).getTime())/86400000);
    if(isFinite(d))bits.push('last paid <b>'+String(r.lastPaid).slice(0,10)+'</b>'+(d>=0?' ('+d+'d ago)':''));
  }
  return {text:bits.join(' \u00b7 '), suggest:suggest, why:why};
}
var openId=null;
function when(d){if(!d)return '\u2014';var t=new Date(d);return isFinite(t)?t.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}):'\u2014';}
function fact(l,v){return '<div class="fact"><span>'+l+'</span><b>'+v+'</b></div>';}
function openFile(id){
  openId=id;
  var row=state.rows.filter(function(x){return String(x.id)===String(id);})[0];
  document.getElementById('auScrim').classList.add('on');
  document.getElementById('auDrawer').classList.add('on');
  document.getElementById('audName').textContent=row?row.name:'Loading\u2026';
  document.getElementById('audMeta').textContent=row?('#'+row.n+' \u00b7 '+(row.stage||'')):'';
  document.getElementById('audBody').innerHTML='<div class="au-empty">Loading\u2026</div>';
  // two fetches in parallel: the full record (notes, docs, logins) and
  // their conversation -- the drawer paints facts first, thread when ready
  Promise.all([
    fetch('/api/production/'+encodeURIComponent(id)).then(function(r){return r.json();}).catch(function(){return {};}),
    fetch('/api/audit/'+encodeURIComponent(id)+'/thread').then(function(r){return r.json();}).catch(function(){return {conversation:null,messages:[]};})
  ]).then(function(res){
    if(String(openId)!==String(id))return; // they moved on
    renderFile(row,res[0].client||{},res[1]);
  });
}
function closeFile(){
  openId=null;
  document.getElementById('auScrim').classList.remove('on');
  document.getElementById('auDrawer').classList.remove('on');
}
function renderFile(row,full,thread){
  var r=row||{};var body=document.getElementById('audBody');
  var a=r.audit;
  var read=readFile(r);
  var h='';
  // ---- the file, read out loud: one sentence that does the thinking ----
  h+='<div style="background:var(--soft);border-radius:10px;padding:11px 14px;font-size:13px;line-height:1.7">'+read.text+'</div>';
  if(read.why)h+='<div class="au-sub" style="margin:7px 2px 0">'+read.why+'</div>';

  // ---- the decision: four big labeled cards, click = saved + next file ----
  h+='<h4>'+(a?'Audited \u2014 change it?':'What did you find? \u2014 pick one, it saves and opens the next file')+'</h4>'
    +(a?'<div class="au-sub" style="margin-bottom:6px">Marked <b style="color:'+OUT_COLOR[a.outcome]+'">'+OUT_LABEL[a.outcome]+'</b> by '+esc(a.who)+' \u00b7 '+String(a.at).slice(0,10)+' <span class="au-saved">saved \u2713</span></div>':'')
    +'<div class="au-outcards">'
    +Object.keys(OUT_LABEL).map(function(k){
      var on=a&&a.outcome===k;
      var hint=!a&&read.suggest===k?'<span class="au-hint">likely this one</span>':'';
      return '<div class="au-outcard'+(on?' on':'')+'" data-out="'+k+'" style="--oc:'+OUT_COLOR[k]+'">'
        +'<b>'+OUT_LABEL[k]+' '+hint+'</b><span>'+esc(OUT_DESC[k])+'</span></div>';
    }).join('')
    +'</div>'
    +(a?'<div style="margin-top:6px"><a href="#" class="au-sub" data-out="">undo this mark</a></div>':'')
    +'<div style="display:flex;gap:8px;margin-top:10px">'
    +'<button id="audSkip" class="au-markbtn">Skip for now \u2192 next file</button>'
    +'</div>';

  // ---- everything about them ----
  var rounds=[['TransUnion',r.tu],['Equifax',r.eq],['Experian',r.ex]]
    .map(function(p){return p[0].slice(0,2)+' R'+((p[1]&&p[1].r)||0);}).join(' \u00b7 ');
  var allowance=r.unlimited?'no limit':(r.roundsIncluded==null?'?':r.roundsIncluded);
  h+='<h4>What they bought</h4>'
    +'<div style="margin:2px 0 4px">'+pkgChips(r.pkg)+'</div>'
    +'<h4>The file</h4>'
    +fact('Rounds used',(r.roundsUsed||0)+' of '+allowance+(r.finished?' \u00b7 finished':''))
    +fact('Round by bureau',esc(rounds))
    +fact('Stage',esc(r.stage||'\u2014')+(r.days!=null?' ('+r.days+'d)':''))
    +fact('MyFreeScoreNow',(r.mfsn==='affiliate'?'<span style="color:#2f8a4d">On</span>':'<span style="color:#c98a00">Off</span>')
      +(r.mfsnOverride?' <span class="au-sub">(by hand)</span>':'')
      +' <button class="au-markbtn" data-mfsn="'+(r.mfsn==='affiliate'?'not_on_mfsn':'affiliate')+'" style="margin-left:6px;padding:2px 8px;font-size:10.5px">mark '+(r.mfsn==='affiliate'?'off':'on')+'</button>')
    +fact('First paid',when(r.firstPaid))
    +fact('Last paid',when(r.lastPaid))
    +(r.paymentCount?fact('Purchases on record',String(r.paymentCount)):'')
    +fact('Assigned',esc(r.va||'\u2014'))
    +(r.email?fact('Email','<a href="mailto:'+esc(r.email)+'">'+esc(r.email)+'</a>'):'')
    +(r.phone?fact('Phone','<a href="tel:'+esc(String(r.phone).replace(/[^0-9+]/g,''))+'">'+esc(r.phone)+'</a>'):'')
    +'<div class="au-sub" style="margin-top:6px"><a href="#" id="audFull">Open full profile \u2192</a> <span style="opacity:.6">(edit package, docs, logins, assign)</span></div>';

  // ---- notes from the record ----
  var notes=(full&&full.notes)||[];
  h+='<h4>Notes</h4>';
  h+=notes.length?notes.slice().reverse().slice(0,8).map(function(n){
    return '<div class="note"><div class="w">'+esc(n.who||'\u2014')+' \u00b7 '+esc(n.when||'')+'</div>'+esc(n.text||'')+'</div>';
  }).join(''):'<div class="au-sub">No notes yet.</div>';

  // ---- their conversation, right here ----
  h+='<h4>Messages</h4>';
  if(thread&&thread.conversation){
    var ms=thread.messages||[];
    h+='<div class="msgs" id="audMsgs">'+(ms.length?ms.map(function(m){
      var dir=m.direction==='outbound'?'out':'in';
      return '<div class="mb '+dir+'">'+esc(m.body||'(no content)')
        +'<div class="mmeta">'+esc(m.channel||'')+' \u00b7 '+(m.at?new Date(m.at).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'')+'</div></div>';
    }).join(''):'<div class="au-sub">No messages in this thread yet.</div>')+'</div>'
    +'<div class="comp"><textarea id="audReply" placeholder="Message '+esc((r.name||'').split(' ')[0])+'\u2026"></textarea><button id="audSend">Send</button></div>';
  }else{
    h+='<div class="au-sub">No conversation found for this client (no email or phone match in the inbox).</div>';
  }
  body.innerHTML=h;
  var mbox=document.getElementById('audMsgs');if(mbox)mbox.scrollTop=mbox.scrollHeight;

  // wiring: picking an outcome saves it and opens the next un-audited file
  // -- the whole pass becomes click, read, message, pick, repeat. Undo and
  // changing an existing mark stay on the same file.
  Array.prototype.forEach.call(body.querySelectorAll('[data-out]'),function(b){
    b.onclick=function(ev){
      ev.preventDefault();
      var out=b.dataset.out||null;
      var wasUnaudited=!r.audit;
      mark(r.id,out);
      if(out&&wasUnaudited){
        var nx=nextTodo(r.id);
        setTimeout(function(){ if(nx)openFile(nx.id); else {closeFile();render();} },200);
      }else{
        setTimeout(function(){if(String(openId)===String(r.id))openFile(r.id);},250);
      }
    };
  });
  var skip=document.getElementById('audSkip');
  if(skip)skip.onclick=function(){
    var nx=nextTodo(r.id);
    if(nx)openFile(nx.id); else closeFile();
  };
  var mf=body.querySelector('[data-mfsn]');
  if(mf)mf.onclick=function(){
    mf.disabled=true;
    fetch('/api/production/'+encodeURIComponent(r.id)+'/mfsn',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({status:mf.dataset.mfsn})
    }).then(function(res){return res.json();}).then(function(j){
      if(j.error){alert(j.error);mf.disabled=false;return;}
      r.mfsn=j.mfsn;r.mfsnOverride=j.override;
      renderFile(r,full,thread);render();
    }).catch(function(){mf.disabled=false;});
  };
  var fullLink=document.getElementById('audFull');
  if(fullLink)fullLink.onclick=function(e){e.preventDefault();closeFile();if(window.pvOpenClient)window.pvOpenClient(r.id);};
  var send=document.getElementById('audSend');
  if(send)send.onclick=function(){
    var ta=document.getElementById('audReply');
    var text=(ta.value||'').trim();if(!text)return;
    send.disabled=true;ta.disabled=true;
    fetch('/api/messages/'+encodeURIComponent(thread.conversation.id)+'/reply',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({contactId:thread.conversation.contactId,type:thread.conversation.channelKey||'SMS',message:text})
    }).then(function(res){return res.json().then(function(j){return {ok:res.ok,j:j};});})
    .then(function(o){
      send.disabled=false;ta.disabled=false;
      if(!o.ok||o.j.error){alert(o.j.error||'Could not send');return;}
      ta.value='';
      var mb=document.getElementById('audMsgs');
      if(mb){mb.insertAdjacentHTML('beforeend','<div class="mb out">'+esc(text)+'</div>');mb.scrollTop=mb.scrollHeight;}
    }).catch(function(){send.disabled=false;ta.disabled=false;alert('Network error');});
  };
}

/* ---------- init ---------- */
function initAudit(){
  if(document.getElementById('view-audit'))return;
  var style=document.createElement('style');style.textContent=css;document.head.appendChild(style);
  var anc=document.getElementById('view-dash');
  var sec=document.createElement('section');
  sec.id='view-audit';sec.style.display='none';sec.innerHTML=sectionHTML;
  if(anc&&anc.parentNode)anc.parentNode.insertBefore(sec,anc);else document.body.appendChild(sec);

  var scrim=document.createElement('div');scrim.id='auScrim';document.body.appendChild(scrim);
  var dr=document.createElement('aside');dr.id='auDrawer';
  dr.innerHTML='<div class="hd"><div><h3 id="audName">\u2014</h3><div class="meta" id="audMeta"></div></div>'
    +'<button class="x" id="audClose" aria-label="Close">&times;</button></div>'
    +'<div class="bd" id="audBody"></div>';
  document.body.appendChild(dr);
  scrim.onclick=closeFile;
  dr.querySelector('#audClose').onclick=closeFile;

  sec.querySelectorAll('#auTabs button').forEach(function(b){
    b.onclick=function(){
      state.filter=b.dataset.f;showCount=SHOW;
      sec.querySelectorAll('#auTabs button').forEach(function(x){x.classList.remove('on');});
      b.classList.add('on');render();
    };
  });
  var sb=sec.querySelector('#auSearch');
  if(sb)sb.oninput=function(){state.search=sb.value.trim();showCount=SHOW;render();};
  var st=sec.querySelector('#auStart');
  if(st)st.onclick=function(){
    var nx=nextTodo(null);
    if(nx)openFile(nx.id);
    else alert('Every file has been audited.');
  };

  var nav=document.getElementById('navProduction')||document.getElementById('nav');
  if(nav&&!document.getElementById('auditNavBtn')){
    var b=document.createElement('button');
    b.id='auditNavBtn';b.setAttribute('onclick',"showView('audit')");
    b.innerHTML='<span class="ico2"><i class="ri-checkbox-multiple-line"></i></span>The Audit';
    nav.appendChild(b);
  }
  if(typeof window.showView==='function'&&!window.__auWrap){
    window.__auWrap=true;var _sv=window.showView;
    window.showView=function(id){
      if(id==='audit'){
        var sv=document.querySelectorAll('.view');
        for(var i=0;i<sv.length;i++){sv[i].classList.remove('on');sv[i].style.display='';}
        // generic: hide every injected module view except this one (a
        // hand-written list goes stale the day the next module ships)
        var mods=document.querySelectorAll('section[id^="view-"]');
        for(var mi=0;mi<mods.length;mi++)if(mods[mi].id!=='view-audit')mods[mi].style.display='none';
        var v=document.getElementById('view-audit');if(v)v.style.display='';
        var nbs=document.querySelectorAll('.navgroup button');
        for(var j=0;j<nbs.length;j++)nbs[j].classList.remove('on');
        var nb=document.getElementById('auditNavBtn');if(nb)nb.classList.add('on');
        if(window.setNavGroup)window.setNavGroup('cl',false);
        var pt=document.getElementById('pageTitle');if(pt)pt.textContent='The Audit';
        load();
      } else {
        var v=document.getElementById('view-audit');if(v)v.style.display='none';
        var sv=document.querySelectorAll('.view');
        for(var i=0;i<sv.length;i++)sv[i].style.display='';
        var nb=document.getElementById('auditNavBtn');if(nb)nb.classList.remove('on');
        _sv(id);
      }
    };
  }
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initAudit);else initAudit();
})();
