/* MSFS Team Dashboard — the Employee home view. Same self-injecting-module
pattern as production.js/messages.js: own <section>, own nav button, wraps
window.showView. Reads the exact same /api/production feed production.js
uses (no new endpoint), and only activates for an employee session -- real
or an Admin previewing as one (see GET /api/me in server.js, whose `role`
field is the EFFECTIVE role) -- so a real Admin load is a no-op here. */
(function(){
var DOCS=['SSC','DL','POA','FTC','Data breach','Affidavit','Perm. purpose','Experian letter'];
var CLIENTS=[], loaded=false, active=false;

/* ---------- styles (own scope, doesn't touch anything else) ---------- */
var css=''+
'#view-team .tm-sub{color:var(--muted);font-size:12.5px;margin:2px 0 16px;max-width:820px}'+
'#view-team .tm-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px}'+
'@media(max-width:1100px){#view-team .tm-grid{grid-template-columns:1fr}}'+
'#view-team .tm-card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px;display:flex;flex-direction:column;min-height:0}'+
'#view-team .tm-card h3{margin:0;font-size:14px;display:flex;justify-content:space-between;align-items:baseline}'+
'#view-team .tm-card h3 .n{font-size:20px;font-weight:800;color:var(--ink)}'+
'#view-team .tm-cap{color:var(--muted);font-size:11.5px;margin:3px 0 12px}'+
'#view-team .tm-sec{font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:700;margin:12px 0 6px}'+
'#view-team .tm-sec:first-of-type{margin-top:0}'+
'#view-team .tm-row{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--line);cursor:pointer}'+
'#view-team .tm-row:last-child{border-bottom:none}'+
'#view-team .tm-row:hover{background:var(--bg)}'+
'#view-team .tm-nm{font-weight:700;font-size:12.5px}'+
'#view-team .tm-pkg{color:var(--muted);font-size:11px;margin-top:1px}'+
'#view-team .tm-tag{font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:20px;white-space:nowrap;flex:none}'+
'#view-team .tag-blue{background:var(--blue-soft);color:var(--blue-ink)}'+
'#view-team .tag-gold{background:var(--gold-soft);color:var(--gold-ink)}'+
'#view-team .tag-red{background:var(--red-soft);color:var(--red-ink)}'+
'#view-team .tag-green{background:var(--green-soft);color:var(--green-ink)}'+
'#view-team .tm-empty{color:var(--muted);font-size:12px;padding:10px 0}'+
'#view-team .tm-more{color:var(--muted);font-size:11px;padding-top:8px;text-align:center}'+
'#view-team .tm-note{background:var(--gold-soft);color:var(--gold-ink);border-radius:9px;padding:9px 12px;font-size:11.5px;margin-top:14px}';

/* ---------- helpers (duplicated from production.js on purpose -- each
   module in this app owns its own small pure helpers rather than sharing a
   module, same as mfsn.js/messages.js already do) ---------- */
function bureaus(c){return [c.tu,c.eq,c.ex];}
function anyLogin(c){return bureaus(c).some(function(b){return b&&b.st==='login';});}
function anyReady(c){for(var i=0;i<3;i++){var b=bureaus(c)[i];if(b&&b.st==='ready')return b;}return null;}
function docCount(c){var n=0;for(var d=0;d<DOCS.length;d++)if(c.docs&&c.docs[DOCS[d]])n++;return n;}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(ch){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];});}
function fmt(n){return n.toLocaleString();}
function row(c,tagHtml,sub){
  return '<div class="tm-row" onclick="'+(window.pvOpenClient?"pvOpenClient('"+c.id+"')":'')+'">'+
    '<div><div class="tm-nm">'+esc(c.name)+'</div><div class="tm-pkg">'+esc(c.pkg||'—')+(sub?' · '+sub:'')+'</div></div>'+
    tagHtml+'</div>';
}
function list(items,limit,renderRow,emptyText){
  if(!items.length)return '<div class="tm-empty">'+emptyText+'</div>';
  var shown=items.slice(0,limit);
  return shown.map(renderRow).join('')+(items.length>limit?'<div class="tm-more">+'+fmt(items.length-limit)+' more — see Pipeline</div>':'');
}

/* ---------- markup ---------- */
var sectionHTML=''+
'<div class="tm-sub"><b>Your daily worklist.</b> New signups to onboard, active clients moving through rounds, and files that need a note or a document before they can move — pulled live from Deal Production. No dollar figures live on this page.</div>'+
'<div class="tm-grid">'+
 '<div class="tm-card"><h3>New Clients <span class="n" id="tmNewCount">0</span></h3><p class="tm-cap">Just enrolled, awaiting documents, or cleared for Round 1.</p><div id="tmNewBody"></div></div>'+
 '<div class="tm-card"><h3>Active Clients <span class="n" id="tmActiveCount">0</span></h3><p class="tm-cap">In rounds — due to submit next, or waiting on the bureau.</p><div id="tmActiveBody"></div></div>'+
 '<div class="tm-card"><h3>Compliance <span class="n" id="tmComplianceCount">0</span></h3><p class="tm-cap">Files missing a document or a note.</p><div id="tmComplianceBody">'+
   '<div class="tm-note">Missing-dispute-copy tracking isn\'t built into Deal Production yet — this card can only check for missing documents and missing notes today.</div>'+
 '</div></div>'+
'</div>';

/* ---------- data + render ---------- */
function loadThen(cb){
  fetch('/api/production').then(function(r){return r.json();}).then(function(d){
    CLIENTS=(d&&Array.isArray(d.clients))?d.clients:[]; loaded=true; cb();
  }).catch(function(){ CLIENTS=[]; loaded=true; cb(); });
}
function render(){
  if(!active||!document.getElementById('tmNewBody'))return;
  if(!loaded){ loadThen(render); return; }

  var onboarding=CLIENTS.filter(function(c){return c.stage==='Onboarding';})
    .sort(function(a,b){return (a.days||0)-(b.days||0);});
  document.getElementById('tmNewCount').textContent=fmt(onboarding.length);
  document.getElementById('tmNewBody').innerHTML=list(onboarding,10,function(c){
    var ready=!anyLogin(c)&&!!anyReady(c);
    var tag=ready?'<span class="tm-tag tag-green">Ready R1</span>'
      :docCount(c)<DOCS.length?'<span class="tm-tag tag-gold">Awaiting docs</span>'
      :'<span class="tm-tag tag-blue">Onboarding</span>';
    return row(c,tag,(c.days||0)+'d in onboarding');
  },'No one in onboarding right now.');

  var inRounds=CLIENTS.filter(function(c){return c.stage==='In rounds';});
  var dueNext=inRounds.filter(function(c){return !anyLogin(c)&&!!anyReady(c);});
  var waiting=inRounds.filter(function(c){return anyLogin(c)||!anyReady(c);});
  document.getElementById('tmActiveCount').textContent=fmt(inRounds.length);
  document.getElementById('tmActiveBody').innerHTML=
    '<div class="tm-sec">Due for next round ('+fmt(dueNext.length)+')</div>'+
    list(dueNext,6,function(c){var r=anyReady(c);return row(c,'<span class="tm-tag tag-green">Submit R'+(r?r.r:'?')+'</span>');},'None ready to submit.')+
    '<div class="tm-sec">Waiting on the bureau ('+fmt(waiting.length)+')</div>'+
    list(waiting,6,function(c){
      var tag=anyLogin(c)?'<span class="tm-tag tag-red">Login blocked</span>':'<span class="tm-tag tag-gold">Awaiting window</span>';
      return row(c,tag);
    },'Nothing waiting right now.');

  var open=CLIENTS.filter(function(c){return c.stage!=='Completed';});
  var missingDocs=open.filter(function(c){return docCount(c)<DOCS.length;});
  var missingNotes=open.filter(function(c){return !(c.notes&&c.notes.length);});
  var complianceTotal=new Set(missingDocs.concat(missingNotes).map(function(c){return c.id;})).size;
  document.getElementById('tmComplianceCount').textContent=fmt(complianceTotal);
  document.getElementById('tmComplianceBody').innerHTML=
    '<div class="tm-sec">Missing documents ('+fmt(missingDocs.length)+')</div>'+
    list(missingDocs,6,function(c){return row(c,'<span class="tm-tag tag-gold">'+docCount(c)+'/'+DOCS.length+'</span>');},'All caught up.')+
    '<div class="tm-sec">No notes on file ('+fmt(missingNotes.length)+')</div>'+
    list(missingNotes,6,function(c){return row(c,'<span class="tm-tag tag-red">0 notes</span>');},'All caught up.')+
    '<div class="tm-note">Missing-dispute-copy tracking isn\'t built into Deal Production yet — this card can only check for missing documents and missing notes today.</div>';
}

/* ---------- init ---------- */
function initTeam(){
  if(document.getElementById('view-team'))return;
  var style=document.createElement('style');style.textContent=css;document.head.appendChild(style);
  var anc=document.getElementById('view-dash');
  // class="view" (same as the standard dash/pipeline/clients/etc. sections,
  // unlike production.js/messages.js/mfsn.js/revenue.js's own custom-layout
  // sections) so every other module's generic `.view` sweep in their own
  // showView wrapper hides this one for free -- no need to teach each of
  // them about 'view-team' by name.
  var sec=document.createElement('section');sec.className='view';sec.id='view-team';sec.style.display='none';
  sec.innerHTML='<h2 style="margin:0 0 3px;font-size:20px">Team Dashboard</h2>'+sectionHTML;
  if(anc&&anc.parentNode)anc.parentNode.insertBefore(sec,anc); else document.body.appendChild(sec);

  fetch('/api/me').then(function(r){return r.json();}).then(function(m){
    if(!m||m.role!=='employee')return; // real Admin (not previewing): no-op, nothing changes for them
    active=true;
    var nav=document.getElementById('nav'); // the Overview group's container -- currently just "Dashboard"
    if(nav&&!document.getElementById('teamNavBtn')){
      var b=document.createElement('button');b.id='teamNavBtn';b.setAttribute('onclick',"showView('team')");
      b.innerHTML='<span class="ico2"><i class="ri-home-5-line"></i></span>Team Dashboard';nav.appendChild(b);
    }
    if(typeof window.showView==='function'&&!window.__tmWrap){
      window.__tmWrap=true;var _sv=window.showView;
      window.showView=function(id){
        if(id==='team'){
          var sv=document.querySelectorAll('.view');for(var i=0;i<sv.length;i++){sv[i].classList.remove('on');sv[i].style.display='';}
          ['view-production','view-personal','view-rev','view-mfsn','view-messages'].forEach(function(x){var e=document.getElementById(x);if(e)e.style.display='none';});
          var v=document.getElementById('view-team');if(v){v.style.display='';v.classList.add('on');}
          var nbs=document.querySelectorAll('.navgroup button');for(var j=0;j<nbs.length;j++)nbs[j].classList.remove('on');
          var nb=document.getElementById('teamNavBtn');if(nb)nb.classList.add('on');
          if(window.setNavGroup)window.setNavGroup('ov',false);
          var pt=document.getElementById('pageTitle');if(pt)pt.textContent='Team Dashboard';
          render();
        } else {
          var v2=document.getElementById('view-team');if(v2)v2.style.display='none';
          _sv(id);
        }
      };
    }
  }).catch(function(){});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initTeam);else initTeam();
})();
