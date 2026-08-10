/* Today — the one screen that says what to do, rather than how big the backlog is.
   Self-injecting module, same pattern as production.js / disputes.js. */
(function(){
var C={ink:'#1F2937',blue:'#4F46E5',green:'#16A34A',gold:'#F59E0B',red:'#DC2626',muted:'#6B7280'};
var DATA=null, filter='all', busy=false;

var css=''
+'#view-actions{padding:0 4px 40px}'
+'.ac-head{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;justify-content:space-between;margin:6px 0 16px}'
+'.ac-h1{font-size:22px;font-weight:800;color:'+C.ink+';margin:0}'
+'.ac-sub{font-size:13px;color:'+C.muted+';margin-top:3px;max-width:60ch}'
+'.ac-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:18px}'
+'.ac-kpi{background:#fff;border:1px solid #E5E7EB;border-radius:14px;padding:16px 18px}'
+'.ac-kpi .l{font-size:11.5px;letter-spacing:.04em;text-transform:uppercase;color:'+C.muted+';font-weight:700}'
+'.ac-kpi .v{font-size:26px;font-weight:800;color:'+C.ink+';margin-top:6px;line-height:1.1}'
+'.ac-kpi .s{font-size:12px;color:'+C.muted+';margin-top:4px}'
+'.ac-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}'
+'.ac-tabs button{border:1px solid #E5E7EB;background:#fff;border-radius:999px;padding:7px 14px;font-size:13px;font-weight:600;color:'+C.muted+';cursor:pointer}'
+'.ac-tabs button.on{background:'+C.ink+';border-color:'+C.ink+';color:#fff}'
+'.ac-list{display:flex;flex-direction:column;gap:10px}'
+'.ac-row{background:#fff;border:1px solid #E5E7EB;border-radius:14px;padding:14px 16px;display:grid;grid-template-columns:auto 1fr auto;gap:14px;align-items:center}'
+'.ac-row.done{opacity:.45}'
+'.ac-chk{width:22px;height:22px;border-radius:7px;border:2px solid #D1D5DB;background:#fff;cursor:pointer;display:grid;place-items:center;padding:0;font-size:13px;color:#fff;line-height:1}'
+'.ac-chk.on{background:'+C.green+';border-color:'+C.green+'}'
+'.ac-name{font-weight:700;color:'+C.ink+';font-size:15px}'
+'.ac-why{font-size:12.5px;color:'+C.muted+';margin-top:3px}'
+'.ac-meta{display:flex;gap:8px;flex-wrap:wrap;margin-top:7px}'
+'.ac-pill{font-size:11.5px;font-weight:600;padding:3px 9px;border-radius:999px;background:#F3F4F6;color:'+C.muted+'}'
+'.ac-pill a{color:'+C.blue+';text-decoration:none}'
+'.ac-right{text-align:right;min-width:96px}'
+'.ac-val{font-weight:800;color:'+C.green+';font-size:15px}'
+'.ac-valsub{font-size:11px;color:'+C.muted+'}'
+'.ac-do{font-size:12px;font-weight:700;color:'+C.blue+'}'
+'.ac-empty{background:#fff;border:1px dashed #D1D5DB;border-radius:14px;padding:34px;text-align:center;color:'+C.muted+';font-size:14px}'
+'.ac-note{font-size:12px;color:'+C.muted+';margin-top:16px;font-style:italic;max-width:75ch}'
+'@media(max-width:640px){'
+'  .ac-row{grid-template-columns:auto 1fr;gap:10px}'
+'  .ac-right{grid-column:2;text-align:left;min-width:0;display:flex;gap:10px;align-items:baseline}'
+'  .ac-kpi .v{font-size:22px}'
+'}';

function money(n){ return '$'+(Math.round((n||0)*100)/100).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); }
function money0(n){ return '$'+Math.round(n||0).toLocaleString(); }
function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
function telHref(p){ var d=String(p||'').replace(/[^\d+]/g,''); return d?'tel:'+d:null; }

function render(){
  var el=document.getElementById('view-actions'); if(!el||!DATA) return;
  var t=DATA.totals||{}, items=DATA.items||[];
  var showMoney = t.monthlyValue!==undefined;

  var kpis='';
  if(showMoney){
    kpis+=''
    +'<div class="ac-kpi"><div class="l">On this list</div><div class="v">'+money0(t.monthlyValue)+'<span style="font-size:14px;color:'+C.muted+'">/mo</span></div>'
    +'<div class="s">if every enrolment below lands</div></div>'
    +'<div class="ac-kpi"><div class="l">Whole backlog</div><div class="v">'+money0(t.backlogMonthlyValue)+'<span style="font-size:14px;color:'+C.muted+'">/mo</span></div>'
    +'<div class="s">'+(t.enrollAvailable||0).toLocaleString()+' clients with no monitoring</div></div>';
  }
  kpis+='<div class="ac-kpi"><div class="l">Rounds waiting</div><div class="v">'+(t.roundsAvailable||0).toLocaleString()+'</div>'
    +'<div class="s">dispute work already paid for</div></div>';

  var counts={all:items.length,enroll:0,round:0};
  items.forEach(function(i){ counts[i.type]=(counts[i.type]||0)+1; });
  var tabs='<div class="ac-tabs">'
    +'<button data-f="all" class="'+(filter==='all'?'on':'')+'">Everything ('+counts.all+')</button>'
    +(showMoney?'<button data-f="enroll" class="'+(filter==='enroll'?'on':'')+'">Enrol ('+(counts.enroll||0)+')</button>':'')
    +'<button data-f="round" class="'+(filter==='round'?'on':'')+'">Rounds ('+(counts.round||0)+')</button>'
    +'</div>';

  var shown=items.filter(function(i){ return filter==='all'||i.type===filter; });
  var rows=shown.map(function(i){
    var contact=[];
    var tel=telHref(i.phone);
    if(tel) contact.push('<span class="ac-pill"><a href="'+tel+'">'+esc(i.phone)+'</a></span>');
    if(i.email) contact.push('<span class="ac-pill"><a href="mailto:'+esc(i.email)+'">'+esc(i.email)+'</a></span>');
    if(!contact.length && i.type==='enroll') contact.push('<span class="ac-pill" style="color:'+C.red+'">no contact on file</span>');
    if(i.type==='round'){
      if(i.stage) contact.push('<span class="ac-pill">'+esc(i.stage)+'</span>');
      (i.blockedBureaus||[]).forEach(function(b){ contact.push('<span class="ac-pill" style="color:'+C.red+'">'+esc(b.toUpperCase())+' blocked</span>'); });
      (i.readyBureaus||[]).forEach(function(b){ contact.push('<span class="ac-pill" style="color:'+C.green+'">'+esc(b.toUpperCase())+' ready</span>'); });
    }
    var right = i.type==='enroll' && showMoney
      ? '<div class="ac-val">'+money(i.monthlyValue)+'</div><div class="ac-valsub">per month</div>'
      : '<div class="ac-do">'+esc(i.action)+'</div>';
    return '<div class="ac-row" data-key="'+esc(i.key)+'">'
      +'<button class="ac-chk" data-key="'+esc(i.key)+'" title="Mark done"></button>'
      +'<div><div class="ac-name">'+esc(i.name)+'</div>'
        +'<div class="ac-why">'+esc(i.why)+'</div>'
        +'<div class="ac-meta">'+contact.join('')+'</div></div>'
      +'<div class="ac-right">'+right+'</div>'
      +'</div>';
  }).join('');

  el.innerHTML=''
   +'<div class="ac-head"><div>'
   +'<h1 class="ac-h1">Today</h1>'
   +'<div class="ac-sub">Ranked by who you can actually reach and who is warmest, not by who is worth most '
   +'&mdash; the commission spread between clients is only a few dollars, so recency matters more.</div>'
   +'</div></div>'
   +'<div class="ac-kpis">'+kpis+'</div>'
   +tabs
   +'<div class="ac-list">'+(rows||'<div class="ac-empty">Nothing left in this list. That is the good outcome.</div>')+'</div>'
   +(showMoney?'<div class="ac-note">Dispute rounds carry no dollar figure on purpose. A round is work that has already been paid for, not new recurring revenue, and pricing it would inflate the total above with money that does not exist.</div>':'');

  el.querySelectorAll('.ac-tabs button').forEach(function(b){
    b.onclick=function(){ filter=b.getAttribute('data-f'); render(); };
  });
  el.querySelectorAll('.ac-chk').forEach(function(b){
    b.onclick=function(){ markDone(b.getAttribute('data-key'), b); };
  });
}

function markDone(key, btn){
  if(busy) return; busy=true;
  btn.classList.add('on'); btn.textContent='✓';
  var row=btn.closest('.ac-row'); if(row) row.classList.add('done');
  fetch('/api/actions/done',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key:key})})
    .then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); })
    .catch(function(e){
      // Put it back rather than leaving a tick that didn't save.
      btn.classList.remove('on'); btn.textContent='';
      if(row) row.classList.remove('done');
      console.error('Could not save that:', e);
    })
    .finally(function(){ busy=false; });
}

function load(){
  return fetch('/api/actions')
    .then(function(r){ return r.ok?r.json():Promise.reject(new Error('HTTP '+r.status)); })
    .then(function(d){ DATA=d; render(); })
    .catch(function(e){
      var el=document.getElementById('view-actions');
      if(el) el.innerHTML='<div class="ac-empty">Could not load the queue. '+esc(e.message)+'</div>';
    });
}

function init(){
  if(document.getElementById('view-actions')) return;
  var style=document.createElement('style'); style.textContent=css; document.head.appendChild(style);
  var sec=document.createElement('section'); sec.id='view-actions'; sec.style.display='none';
  var anc=document.getElementById('view-dash');
  if(anc&&anc.parentNode) anc.parentNode.insertBefore(sec,anc); else document.body.appendChild(sec);

  var nav=document.getElementById('nav')||document.getElementById('navFinance');
  if(nav&&!document.getElementById('acNavBtn')){
    var b=document.createElement('button'); b.id='acNavBtn'; b.setAttribute('onclick',"showView('actions')");
    b.innerHTML='<span class="ico2"><i class="ri-checkbox-circle-line"></i></span>Today';
    nav.insertBefore(b, nav.firstChild);
  }
  if(typeof window.showView==='function'&&!window.__acWrap){
    window.__acWrap=true; var _sv=window.showView;
    window.showView=function(id){
      if(id==='actions'){
        var vs=document.querySelectorAll('.view'); for(var i=0;i<vs.length;i++){vs[i].classList.remove('on');vs[i].style.display='';}
        ['view-production','view-personal','view-mfsn','view-rev','view-disputes'].forEach(function(x){var e=document.getElementById(x); if(e)e.style.display='none';});
        var v=document.getElementById('view-actions'); if(v)v.style.display='';
        var nbs=document.querySelectorAll('.navgroup button'); for(var j=0;j<nbs.length;j++)nbs[j].classList.remove('on');
        var nb=document.getElementById('acNavBtn'); if(nb)nb.classList.add('on');
        var pt=document.getElementById('pageTitle'); if(pt)pt.textContent='Today';
        load();
      } else {
        var v2=document.getElementById('view-actions'); if(v2)v2.style.display='none';
        var nb2=document.getElementById('acNavBtn'); if(nb2)nb2.classList.remove('on');
        var vs2=document.querySelectorAll('.view'); for(var k=0;k<vs2.length;k++)vs2[k].style.display='';
        _sv(id);
      }
    };
  }
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
