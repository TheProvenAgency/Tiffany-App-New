/* Credit Monitoring — MyFreeScoreNow affiliate book. Figures from the affiliate portal (Jul 28 2026). */
(function(){
var C={ink:'#1F2937',blue:'#3b82f6',green:'#45B369',gold:'#FF9F29',red:'#EF4A00',teal:'#00B8F2',purple:'#8252E9',orange:'#F86624',pink:'#DE3ACE'};
var PAL=['#144BD6','#45B369','#F4941E','#E30A0A','#00B8F2','#7F27FF','#F86624','#DE3ACE','#16A34A','#6B7280'];
var charts={}, curSub='overview';

/* ---------- real figures (MyFreeScoreNow affiliate portal) ---------- */
var M={ enrolled:1493, active:203, upgraded:420, toUpgrade:1073, newActives:736, targetActives:1226,
        latestMonth:17192, ytd:107780 };
// Commission summary — most recent 10 months (Commission + Referral + One-Time Bonus + Target Incentive).
var COMM=[
 {mo:'June 2026',      comm:15636.20, ref:1455.35, bonus:100,  target:0,       total:17191.55},
 {mo:'May 2026',       comm:16974.45, ref:1524.55, bonus:500,  target:0,       total:18999.00},
 {mo:'April 2026',     comm:17634.08, ref:1268.00, bonus:100,  target:0,       total:19002.08},
 {mo:'March 2026',     comm:17538.30, ref:1061.45, bonus:500,  target:0,       total:19099.75},
 {mo:'February 2026',  comm:15984.10, ref:930.85,  bonus:0,    target:0,       total:16914.95},
 {mo:'January 2026',   comm:15554.50, ref:818.59,  bonus:200,  target:0,       total:16573.09},
 {mo:'December 2025',  comm:15722.00, ref:750.14,  bonus:100,  target:0,       total:16572.14},
 {mo:'November 2025',  comm:16211.25, ref:724.85,  bonus:300,  target:0,       total:17236.10},
 {mo:'October 2025',   comm:16057.00, ref:724.89,  bonus:200,  target:0,       total:16981.89},
 {mo:'September 2025', comm:12026.75, ref:604.96,  bonus:400,  target:3006.69, total:16038.40}
];
var COMM_TREND={ labels:['Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun'],
  vals:[16038,16982,17236,16572,16573,16915,19100,19002,18999,17192] };

/* ---------- helpers ---------- */
function money0(n){var neg=n<0;return (neg?'-':'')+'$'+Math.abs(Math.round(n)).toLocaleString('en-US');}
function money2(n){return '$'+Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
function moneyK(n){return '$'+(Math.round(n/100)/10)+'k';}
function pct(a,b){return Math.round(a/b*100);}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;');}

/* ---------- styles ---------- */
var css=''+
'#view-mfsn{padding:24px 30px 60px}'+
'#view-mfsn .mf-sub{color:var(--muted);font-size:12.5px;margin:2px 0 14px;max-width:1000px;line-height:1.6}'+
'#view-mfsn .mf-tabs{display:inline-flex;border:1px solid var(--line);border-radius:9px;overflow:hidden;margin-bottom:16px;flex-wrap:wrap}'+
'#view-mfsn .mf-tabs button{border:none;background:var(--card);padding:8px 18px;font-size:12.5px;font-weight:700;cursor:pointer;color:var(--muted);border-right:1px solid var(--line)}'+
'#view-mfsn .mf-tabs button:last-child{border-right:none}#view-mfsn .mf-tabs button.on{background:var(--ink);color:#fff}'+
'#view-mfsn .mf-kpis{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin-bottom:16px}'+
'#view-mfsn .mf-kpi{background:var(--card);border:1px solid var(--line);border-radius:13px;padding:13px 15px;border-top:3px solid var(--line)}'+
'#view-mfsn .mf-kpi .l{font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}'+
'#view-mfsn .mf-kpi .v{font-size:22px;font-weight:800;margin-top:6px;letter-spacing:-.5px}'+
'#view-mfsn .mf-kpi .s{font-size:11px;color:var(--muted);margin-top:3px}'+
'#view-mfsn .mf-kpi.hero{background:var(--ink);border-top-color:#45B369}#view-mfsn .mf-kpi.hero .l{color:#D1D5DB}#view-mfsn .mf-kpi.hero .v{color:#fff}#view-mfsn .mf-kpi.hero .s{color:#9CA3AF}'+
'#view-mfsn .mf-grid2{display:grid;grid-template-columns:1.25fr .75fr;gap:16px;margin-bottom:16px}'+
'#view-mfsn .mf-card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px}'+
'#view-mfsn .mf-card h3{margin:0 0 3px;font-size:14px}#view-mfsn .mf-card .cap{color:var(--muted);font-size:12px;margin:0 0 12px}'+
'#view-mfsn .mf-wrap{position:relative;height:260px}'+
'#view-mfsn .mf-tablewrap{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:auto}'+
'#view-mfsn table.mf-table{width:100%;border-collapse:collapse;font-size:12.5px}'+
'#view-mfsn .mf-table th{position:sticky;top:0;background:var(--tile-bg);text-align:left;padding:10px 12px;font-size:10.5px;text-transform:uppercase;letter-spacing:.03em;color:var(--muted);border-bottom:1px solid var(--line);white-space:nowrap}'+
'#view-mfsn .mf-table th.r,#view-mfsn .mf-table td.r{text-align:right}'+
'#view-mfsn .mf-table td{padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:middle;font-variant-numeric:tabular-nums}'+
'#view-mfsn .mf-table tbody tr:hover{background:var(--bg)}#view-mfsn .mf-table tfoot td{font-weight:800;border-top:2px solid var(--line);background:var(--bg)}'+
'#view-mfsn .mf-brow{display:grid;grid-template-columns:1.3fr 1fr 74px;gap:12px;align-items:center;padding:11px 4px;border-bottom:1px solid var(--line)}#view-mfsn .mf-brow:last-child{border-bottom:none}'+
'#view-mfsn .mf-dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:8px;vertical-align:middle}'+
'#view-mfsn .mf-bn{font-weight:700;font-size:13px}#view-mfsn .mf-ba{text-align:right;font-weight:800;font-variant-numeric:tabular-nums}'+
'#view-mfsn .mf-prog{height:9px;background:var(--tile-bg);border-radius:6px;overflow:hidden}#view-mfsn .mf-prog>i{display:block;height:100%;border-radius:6px}'+
'#view-mfsn .mf-foot{font-size:11.5px;color:var(--muted);margin-top:14px;line-height:1.6}';

/* ---------- shell ---------- */
var sectionHTML=''+
'<div class="mf-sub"><b>Credit Monitoring.</b> The MyFreeScoreNow affiliate book — enrolled members, platform migration and monthly affiliate commissions.</div>'+
'<div class="mf-tabs">'+
 '<button class="on" data-v="overview">Overview</button>'+
 '<button data-v="commissions">Commissions</button>'+
 '<button data-v="members">Members</button>'+
'</div>'+
'<div id="mfBody"></div>';

/* ---------- overview ---------- */
function renderOverview(){
  var html=''+
  '<div class="mf-kpis">'+
   '<div class="mf-kpi hero"><div class="l">Commissions · YTD</div><div class="v">'+money0(M.ytd)+'</div><div class="s">2026 affiliate income</div></div>'+
   '<div class="mf-kpi" style="border-top-color:'+C.gold+'"><div class="l">Latest month</div><div class="v">'+money0(M.latestMonth)+'</div><div class="s">most recent payout</div></div>'+
   '<div class="mf-kpi" style="border-top-color:'+C.blue+'"><div class="l">Enrolled</div><div class="v">'+M.enrolled.toLocaleString()+'</div><div class="s">total members</div></div>'+
   '<div class="mf-kpi" style="border-top-color:'+C.green+'"><div class="l">Active</div><div class="v">'+M.active+'</div><div class="s">active monitoring</div></div>'+
   '<div class="mf-kpi" style="border-top-color:'+C.teal+'"><div class="l">Upgraded</div><div class="v">'+M.upgraded+'</div><div class="s">'+pct(M.upgraded,M.enrolled)+'% of book</div></div>'+
   '<div class="mf-kpi" style="border-top-color:'+C.purple+'"><div class="l">New actives</div><div class="v">'+M.newActives+'</div><div class="s">of '+M.targetActives+' target</div></div>'+
  '</div>'+
  '<div class="mf-grid2">'+
   '<div class="mf-card"><h3>Affiliate commissions by month</h3><div class="cap">Total monthly payout, last 10 months.</div><div class="mf-wrap"><canvas id="mfComm"></canvas></div></div>'+
   '<div class="mf-card"><h3>Member upgrade progress</h3><div class="cap">Migrating the book to the new platform.</div>'+
     '<div class="mf-brow"><div class="mf-bn"><span class="mf-dot" style="background:'+C.green+'"></span>Upgraded</div><div class="mf-prog"><i style="width:'+pct(M.upgraded,M.enrolled)+'%;background:'+C.green+'"></i></div><div class="mf-ba">'+M.upgraded+'</div></div>'+
     '<div class="mf-brow"><div class="mf-bn"><span class="mf-dot" style="background:'+C.gold+'"></span>Need upgrade</div><div class="mf-prog"><i style="width:'+pct(M.toUpgrade,M.enrolled)+'%;background:'+C.gold+'"></i></div><div class="mf-ba">'+M.toUpgrade.toLocaleString()+'</div></div>'+
     '<div class="mf-brow"><div class="mf-bn"><span class="mf-dot" style="background:'+C.blue+'"></span>Active members</div><div class="mf-prog"><i style="width:'+pct(M.active,M.enrolled)+'%;background:'+C.blue+'"></i></div><div class="mf-ba">'+M.active+'</div></div>'+
     '<div style="margin-top:12px;font-size:12px;color:var(--muted)">'+pct(M.upgraded,M.enrolled)+'% of '+M.enrolled.toLocaleString()+' members migrated to the new platform.</div>'+
   '</div>'+
  '</div>'+
  '<div class="mf-foot">Affiliate figures from the MyFreeScoreNow partner portal, updated Jul 28, 2026.</div>';
  document.getElementById('mfBody').innerHTML=html;
  drawComm();
}

/* ---------- commissions ---------- */
function renderCommissions(){
  var t={comm:0,ref:0,bonus:0,target:0,total:0};
  COMM.forEach(function(r){t.comm+=r.comm;t.ref+=r.ref;t.bonus+=r.bonus;t.target+=r.target;t.total+=r.total;});
  var html=''+
  '<div class="mf-tablewrap"><table class="mf-table"><thead><tr>'+
   '<th>Month</th><th class="r">Commission</th><th class="r">Referral</th><th class="r">Bonus</th><th class="r">Target incentive</th><th class="r">Total</th>'+
   '</tr></thead><tbody>'+
   COMM.map(function(r){return '<tr><td style="font-weight:700">'+esc(r.mo)+'</td>'+
     '<td class="r">'+money2(r.comm)+'</td><td class="r">'+money2(r.ref)+'</td><td class="r">'+money2(r.bonus)+'</td><td class="r">'+money2(r.target)+'</td>'+
     '<td class="r" style="font-weight:800">'+money2(r.total)+'</td></tr>';}).join('')+
   '</tbody><tfoot><tr><td>10-month total</td><td class="r">'+money2(t.comm)+'</td><td class="r">'+money2(t.ref)+'</td><td class="r">'+money2(t.bonus)+'</td><td class="r">'+money2(t.target)+'</td><td class="r">'+money2(t.total)+'</td></tr></tfoot>'+
   '</table></div>'+
  '<div class="mf-foot">Monthly affiliate payouts from the MyFreeScoreNow partner portal.</div>';
  document.getElementById('mfBody').innerHTML=html;
}

/* ---------- members ---------- */
function renderMembers(){
  var rows=[
   {k:'Total enrolled members', v:M.enrolled, c:C.blue},
   {k:'Active monitoring', v:M.active, c:C.green},
   {k:'Upgraded to new platform', v:M.upgraded, c:C.teal},
   {k:'Still to be upgraded', v:M.toUpgrade, c:C.gold},
   {k:'New portal actives (bonus tier)', v:M.newActives, c:C.purple}
  ];
  var html=''+
  '<div class="mf-grid2">'+
   '<div class="mf-card"><h3>Member breakdown</h3><div class="cap">Where the affiliate book stands.</div>'+
     rows.map(function(r){return '<div class="mf-brow" style="grid-template-columns:1fr auto"><div class="mf-bn"><span class="mf-dot" style="background:'+r.c+'"></span>'+esc(r.k)+'</div><div class="mf-ba">'+r.v.toLocaleString()+'</div></div>';}).join('')+
   '</div>'+
   '<div class="mf-card"><h3>Platform migration</h3><div class="cap">Old platform → new MyFreeScoreNow.</div><div class="mf-wrap"><canvas id="mfMig"></canvas></div></div>'+
  '</div>'+
  '<div class="mf-foot">Bonus tier: '+M.newActives+' of '+M.targetActives+' new portal actives toward the current promotion.</div>';
  document.getElementById('mfBody').innerHTML=html;
  drawMig();
}

/* ---------- charts ---------- */
function killChart(k){if(charts[k]){charts[k].destroy();charts[k]=null;}}
function drawComm(){
  if(!window.Chart)return;var el=document.getElementById('mfComm');if(!el)return;killChart('cm');
  charts.cm=new Chart(el.getContext('2d'),{type:'bar',data:{labels:COMM_TREND.labels,datasets:[{data:COMM_TREND.vals,backgroundColor:COMM_TREND.labels.map(function(_,i){return PAL[i%PAL.length];}),borderRadius:4}]},
   options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:function(c){return money0(c.parsed.y);}}}},scales:{y:{ticks:{callback:function(v){return moneyK(v);},font:{size:10}},grid:{color:'#F3F4F6'}},x:{grid:{display:false},ticks:{font:{size:10}}}}}});
}
function drawMig(){
  if(!window.Chart)return;var el=document.getElementById('mfMig');if(!el)return;killChart('mg');
  charts.mg=new Chart(el.getContext('2d'),{type:'doughnut',data:{labels:['Upgraded','Need upgrade'],datasets:[{data:[M.upgraded,M.toUpgrade],backgroundColor:[C.green,C.gold],borderWidth:2,borderColor:'#fff'}]},
   options:{responsive:true,maintainAspectRatio:false,cutout:'60%',plugins:{legend:{position:'bottom',labels:{boxWidth:10,font:{size:11},padding:10}},tooltip:{callbacks:{label:function(c){return c.label+': '+c.parsed.toLocaleString();}}}}}});
}

/* ---------- view switching ---------- */
function renderSub(){
  if(curSub==='overview')renderOverview();
  else if(curSub==='commissions')renderCommissions();
  else if(curSub==='members')renderMembers();
}
function setSub(v){
  curSub=v;
  var btns=document.querySelectorAll('#view-mfsn .mf-tabs button');
  for(var i=0;i<btns.length;i++)btns[i].classList.toggle('on',btns[i].getAttribute('data-v')===v);
  renderSub();
}

/* ---------- Dashboard KPI band (index.html gs-id="mf-kpi-*") ----------
   The same Overview figures above, mirrored onto the main Dashboard as 5
   independently movable/resizable grid-stack-items (matching the income
   row's treatment). Real M/COMM_TREND data, not re-typed numbers -- if the
   affiliate portal figures at the top of this file change, these change
   with them. Only the two commission cards (which have an actual monthly
   history) get a sparkline; Enrolled/Upgraded/New actives are point-in-time
   counts with no time series behind them, so they stay plain. */
function sparkTooltipEl(){
  var el=document.getElementById('rvkTooltip');
  if(!el){
    el=document.createElement('div');
    el.id='rvkTooltip';
    el.style.cssText='position:fixed;pointer-events:none;z-index:9999;background:#1F2937;color:#fff;'+
      'font-size:11.5px;line-height:1.45;padding:7px 11px;border-radius:9px;box-shadow:0 8px 22px rgba(0,0,0,.28);'+
      'opacity:0;transition:opacity .08s ease;white-space:nowrap;transform:translate(-50%,-100%)';
    document.body.appendChild(el);
  }
  return el;
}
function mfSparkOpts(period){
  return {responsive:true,maintainAspectRatio:false,animation:false,
    interaction:{mode:'index',intersect:false},
    plugins:{legend:{display:false},tooltip:{enabled:false,external:function(ctx){
      var el=sparkTooltipEl(), tt=ctx.tooltip;
      if(!tt||tt.opacity===0){ el.style.opacity=0; return; }
      var dp=tt.dataPoints&&tt.dataPoints[0];
      if(dp){
        var y=dp.parsed&&(dp.parsed.y!=null?dp.parsed.y:dp.parsed);
        el.innerHTML='<div style="opacity:.65;font-size:10px;letter-spacing:.03em;text-transform:uppercase">'+dp.label+' &middot; '+period+'</div>'+
          '<div style="font-weight:800;font-size:13px;margin-top:1px">'+money0(y)+'</div>';
      }
      var rect=ctx.chart.canvas.getBoundingClientRect();
      el.style.left=(rect.left+tt.caretX)+'px';
      el.style.top=(rect.top+tt.caretY-8)+'px';
      el.style.opacity=1;
    }}},
    scales:{x:{display:false},y:{display:false}},
    elements:{point:{radius:0,hoverRadius:4,hitRadius:12}}};
}
function mfDonutOpts(){
  return {responsive:true,maintainAspectRatio:false,animation:false,cutout:'60%',
    plugins:{legend:{display:false},tooltip:{enabled:false,external:function(ctx){
      var el=sparkTooltipEl(), tt=ctx.tooltip;
      if(!tt||tt.opacity===0){ el.style.opacity=0; return; }
      var dp=tt.dataPoints&&tt.dataPoints[0];
      if(dp){
        var data=dp.dataset.data, total=data.reduce(function(a,b){return a+b;},0);
        var val=dp.parsed, pct=total?Math.round(val/total*100):0;
        el.innerHTML='<div style="opacity:.65;font-size:10px;letter-spacing:.03em;text-transform:uppercase">'+dp.label+'</div>'+
          '<div style="font-weight:800;font-size:13px;margin-top:1px">'+val.toLocaleString()+' &middot; '+pct+'%</div>';
      }
      var rect=ctx.chart.canvas.getBoundingClientRect();
      el.style.left=(rect.left+tt.caretX)+'px';
      el.style.top=(rect.top+tt.caretY-8)+'px';
      el.style.opacity=1;
    }}}};
}
function mfTrendBadge(vals){
  if(!vals||vals.length<2)return null;
  var end=vals.length-1;
  while(end>0 && !vals[end]) end--;
  var first=vals[0], last=vals[end];
  if(!first || end<1)return null;
  var pct2=((last-first)/Math.abs(first))*100;
  var up=pct2>=0;
  return {text:(up?'▲ ':'▼ ')+Math.abs(pct2).toFixed(0)+'%', up:up};
}
// Renders a share (real numerator/denominator, not a fabricated
// week-over-week change) in the same icon+colored-text language as
// Admina's own KPI trend rows -- a small glyph followed by plain colored
// text, no pill/badge background. Color is honest, threshold-based: green
// once most of the book has cleared the bar, gold while it's still
// mid-way, red if the share is genuinely low.
function mfShareRow(num, den, label){
  var pct = den > 0 ? Math.round((num/den)*100) : 0;
  var cls = pct>=66 ? 'up' : (pct>=33 ? 'caution' : 'down');
  var glyph = pct>=66 ? '▲' : (pct>=33 ? '●' : '▼');
  return '<span class="rvktrend '+cls+'"><i>'+glyph+'</i>'+pct+'% '+label+'</span>';
}
function initMFDashKpis(){
  if(!document.getElementById('mfkEnrolled'))return;
  document.getElementById('mfkEnrolled').textContent=M.enrolled.toLocaleString();
  document.getElementById('mfkEnrolledSub').innerHTML=mfShareRow(M.active, M.enrolled, 'active monitoring');
  document.getElementById('mfkUpgraded').textContent=M.upgraded.toLocaleString();
  document.getElementById('mfkUpgradedSub').innerHTML=mfShareRow(M.upgraded, M.upgraded+M.toUpgrade, 'on new platform');
  document.getElementById('mfkNewActives').textContent=M.newActives.toLocaleString();
  document.getElementById('mfkNewActivesSub').innerHTML=mfShareRow(M.newActives, M.targetActives, 'of bonus target');
  if(!window.Chart)return;
  // Enrolled/Upgraded/New-actives don't have a monthly history to spark --
  // they're a portal snapshot, not a series -- but each one IS really two
  // real numbers (the headline count plus its natural complement), so a
  // small hoverable donut shows the actual breakdown instead of a bare
  // number sitting there with nothing to interact with.
  var donuts=[
    {id:'mfkDonutEnrolled', labels:['Active monitoring','Not yet active'], vals:[M.active, Math.max(M.enrolled-M.active,0)], colors:[C.blue,'#DFE0E2']},
    {id:'mfkDonutUpgraded', labels:['Upgraded','Need upgrade'], vals:[M.upgraded, M.toUpgrade], colors:[C.teal,'#FFEBA6']},
    {id:'mfkDonutNewActives', labels:['New actives','Remaining to target'], vals:[M.newActives, Math.max(M.targetActives-M.newActives,0)], colors:[C.purple,'#DFE0E2']}
  ];
  donuts.forEach(function(d){
    var el=document.getElementById(d.id); if(!el)return;
    killChart(d.id);
    charts[d.id]=new Chart(el.getContext('2d'),{type:'doughnut',
      data:{labels:d.labels,datasets:[{data:d.vals,backgroundColor:d.colors,borderWidth:2,borderColor:'#fff'}]},
      options:mfDonutOpts()});
  });
}

/* ---------- init ---------- */
function initMF(){
  if(document.getElementById('view-mfsn'))return;
  var style=document.createElement('style');style.textContent=css;document.head.appendChild(style);
  var anc=document.getElementById('view-dash');
  var sec=document.createElement('section');sec.id='view-mfsn';sec.style.display='none';sec.innerHTML=sectionHTML;
  if(anc&&anc.parentNode)anc.parentNode.insertBefore(sec,anc); else document.body.appendChild(sec);
  sec.querySelectorAll('.mf-tabs button').forEach(function(b){b.onclick=function(){setSub(b.getAttribute('data-v'));};});
  var nav=document.getElementById('navProduction')||document.getElementById('nav');
  if(nav&&!document.getElementById('mfNavBtn')){
    var b=document.createElement('button');b.id='mfNavBtn';b.setAttribute('onclick',"showView('mfsn')");
    b.innerHTML='<span class="ico2"><i class="ri-shield-check-line"></i></span>Credit Monitoring';nav.appendChild(b);
  }
  if(typeof window.showView==='function'&&!window.__mfWrap){
    window.__mfWrap=true;var _sv=window.showView;
    window.showView=function(id){
      if(id==='mfsn'){
        var sv=document.querySelectorAll('.view');for(var i=0;i<sv.length;i++){sv[i].classList.remove('on');sv[i].style.display='';}
        ['view-production','view-personal','view-rev'].forEach(function(x){var e=document.getElementById(x);if(e)e.style.display='none';});
        var v=document.getElementById('view-mfsn');if(v)v.style.display='';
        var nbs=document.querySelectorAll('.navgroup button');for(var j=0;j<nbs.length;j++)nbs[j].classList.remove('on');
        var nb=document.getElementById('mfNavBtn');if(nb)nb.classList.add('on');
        if(window.setNavGroup)window.setNavGroup('pr',false);
        var pt=document.getElementById('pageTitle');if(pt)pt.textContent='Credit Monitoring';
        renderSub();
      } else {
        var v=document.getElementById('view-mfsn');if(v)v.style.display='none';
        var sv=document.querySelectorAll('.view');for(var i=0;i<sv.length;i++)sv[i].style.display='';
        var nb=document.getElementById('mfNavBtn');if(nb)nb.classList.remove('on');
        _sv(id);
      }
    };
  }
}
function initMFAll(){
  initMF();
  // Dashboard's mf-kpi-* cards are static HTML in index.html itself (not
  // built by this file the way the Credit Monitoring page's own band is),
  // so they need filling in once up front regardless of which page loads
  // first -- unlike the guarded initMF() above, this has no "already ran"
  // early return to worry about.
  initMFDashKpis();
  // Chain onto the shared resize hook (see revenue.js) so these two
  // sparklines get re-measured after a GridStack drag/resize too, no
  // matter which of mfsn.js/revenue.js's init runs first.
  var _prev=window.__resizeExtraCharts;
  var _dashKeys={mfkDonutEnrolled:1,mfkDonutUpgraded:1,mfkDonutNewActives:1};
  window.__resizeExtraCharts=function(){ if(_prev)_prev(); for(var k in charts){ if(charts[k]&&_dashKeys[k]) charts[k].resize(); } };
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initMFAll);else initMFAll();
})();
