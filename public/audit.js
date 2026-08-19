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
  graduated:'Credit fully finished — ready for funding / mentorship upsell',
  completed:'Paid rounds fulfilled — may still need monitoring or an upsell',
  free_round:'Out of rounds — doing one free to re-engage them',
  in_progress:'Still in repair — keep working'
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
'#view-audit .au-more{padding:12px;text-align:center;color:var(--blue,#4F46E5);font-weight:700;cursor:pointer}';

var sectionHTML=''+
'<h2 style="margin:0 0 2px;font-size:22px;letter-spacing:-.4px">The Audit</h2>'+
'<div class="au-sub" style="color:var(--muted);font-size:12.5px;margin:0 0 14px">Touch every file. Open a client, check DisputeFox beside it, message them, then mark what you found. Anyone without a mark still needs a pass — including clients who arrive after today.</div>'+
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
  else if(state.filter!=='all')rows=rows.filter(function(r){return r.audit&&r.audit.outcome===state.filter;});
  if(state.search){
    var q=state.search.toLowerCase();
    rows=rows.filter(function(r){return String(r.name||'').toLowerCase().indexOf(q)>=0;});
  }
  return rows;
}

function roundsCell(r){
  if(r.unlimited)return 'unltd';
  if(r.roundsIncluded==null)return (r.roundsUsed||0)+'/?';
  return (r.roundsUsed||0)+'/'+r.roundsIncluded;
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
    }).join('');
  }
  if(state.loading){host.innerHTML='<div class="au-empty">Loading…</div>';return;}
  if(state.err){host.innerHTML='<div class="au-empty">'+esc(state.err)+'</div>';return;}
  var rows=visible();
  if(!rows.length){
    host.innerHTML='<div class="au-empty">'+(state.search?'No client matches that.'
      :state.filter==='todo'?'Every file has been audited. New clients will appear here as they come in.':'Nobody marked '+(OUT_LABEL[state.filter]||'that')+' yet.')+'</div>';
    return;
  }
  var h='<table><thead><tr><th>#</th><th>Client</th><th>Stage</th><th>Rounds</th><th>MFSN</th><th>Assigned</th><th>Audit</th></tr></thead><tbody>';
  rows.slice(0,showCount).forEach(function(r){
    var a=r.audit;
    h+='<tr data-id="'+esc(r.id)+'">'+
      '<td class="au-n">'+r.n+'</td>'+
      '<td><span class="au-nm" data-open="'+esc(r.id)+'">'+esc(r.name)+'</span><div class="au-sub">'+esc(String(r.pkg||'').split(',')[0])+'</div></td>'+
      '<td>'+esc(r.stage||'—')+'</td>'+
      '<td class="au-sub">'+roundsCell(r)+'</td>'+
      '<td>'+(r.mfsn==='affiliate'?'<span style="color:#2f8a4d;font-weight:700;font-size:11.5px">On</span>':'<span style="color:#c98a00;font-weight:700;font-size:11.5px">Off</span>')+'</td>'+
      '<td class="au-sub">'+esc(r.va||'—')+'</td>'+
      '<td style="position:relative;white-space:nowrap">'+
        (a?'<span class="au-out" style="background:'+OUT_COLOR[a.outcome]+'">'+OUT_LABEL[a.outcome]+'</span>'
           +'<div class="au-sub">'+esc(a.who)+' · '+String(a.at).slice(0,10)+'</div>'
           +'<a href="#" class="au-sub" data-clear="'+esc(r.id)+'">undo</a>'
          :'<button class="au-markbtn" data-mark="'+esc(r.id)+'">Mark audited</button>')+
      '</td>'+
    '</tr>';
  });
  h+='</tbody></table>';
  if(rows.length>showCount)h+='<div class="au-more" id="auMore">Show '+Math.min(SHOW,rows.length-showCount)+' more ('+(rows.length-showCount).toLocaleString()+' left)</div>';
  host.innerHTML=h;

  Array.prototype.forEach.call(host.querySelectorAll('[data-open]'),function(el){
    el.onclick=function(){if(window.pvOpenClient)window.pvOpenClient(el.dataset.open);};
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

/* ---------- init ---------- */
function initAudit(){
  if(document.getElementById('view-audit'))return;
  var style=document.createElement('style');style.textContent=css;document.head.appendChild(style);
  var anc=document.getElementById('view-dash');
  var sec=document.createElement('section');
  sec.id='view-audit';sec.style.display='none';sec.innerHTML=sectionHTML;
  if(anc&&anc.parentNode)anc.parentNode.insertBefore(sec,anc);else document.body.appendChild(sec);

  sec.querySelectorAll('#auTabs button').forEach(function(b){
    b.onclick=function(){
      state.filter=b.dataset.f;showCount=SHOW;
      sec.querySelectorAll('#auTabs button').forEach(function(x){x.classList.remove('on');});
      b.classList.add('on');render();
    };
  });
  var sb=sec.querySelector('#auSearch');
  if(sb)sb.oninput=function(){state.search=sb.value.trim();showCount=SHOW;render();};

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
        ['view-production','view-personal','view-rev','view-mfsn','view-messages','view-disputes'].forEach(function(x){
          var e=document.getElementById(x);if(e)e.style.display='none';
        });
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
