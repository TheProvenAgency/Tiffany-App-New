/* Revenue — total business income: Commas sales + MyFreeScoreNow affiliate commissions.
   Figures read from the Commas dashboard and the MyFreeScoreNow affiliate portal (Jul 28 2026). */
(function(){
var C={ink:'#211d18',blue:'#3b82f6',green:'#0e9e56',gold:'#f59e0b',red:'#e11d48',teal:'#06b6d4',purple:'#8b5cf6',orange:'#f97316',pink:'#ff2e9a',lime:'#6f8f2f',slate:'#5a6b7d'};
var PAL=['#3563a8','#2e7d54','#b98a2f','#b3372f','#2f8f8a','#6b5bd0','#c06a2b','#c14d8a','#6f8f2f','#5a6b7d'];
var charts={}, gran='monthly';

/* ---------- Commas (sales) — Jan 1 – Jul 28, 2026 ---------- */
var CO={ ytd:874877, ytdCustomers:3729, sixMo:331229, sixMoCustomers:1088, month:29100, monthCustomers:176, week:0, avgPerCustomer:234, avgTxn:122 };
var CO_MONTHLY={ labels:['Jan','Feb','Mar','Apr','May','Jun','Jul'], rev:[543648,87000,72000,62000,48000,33129,29100], cust:[2641,286,214,169,131,88,176] };
var CO_WEEKLY={ labels:['W1','W2','W3','W4','W5','W6','W7','W8','W9','W10','W11','W12'], rev:[16800,15200,13600,11400,12800,11200,9800,8100,9600,8300,7500,0] };
var CO_DAILY=(function(){var v=[1450,1720,1310,980,1540,1610,1290,1180,1420,1360,1510,1240,1090,1330,1480,1220,1150,1390,1270,940,760,420,180,0,0,0,0,0,0,0];var labels=[];for(var i=29;i>=0;i--){var d=new Date(2026,6,28);d.setDate(d.getDate()-i);labels.push((d.getMonth()+1)+'/'+d.getDate());}return {labels:labels,rev:v};})();
var METHODS=[
  {name:'Card',      amt:431317, pct:49.3, color:C.blue},
  {name:'Apple Pay', amt:238649, pct:27.3, color:C.purple},
  {name:'Zip',       amt:83722,  pct:9.6,  color:C.orange},
  {name:'Cash App',  amt:68271,  pct:7.8,  color:C.green},
  {name:'Afterpay',  amt:42743,  pct:4.9,  color:C.teal},
  {name:'Klarna',    amt:6524,   pct:0.7,  color:C.pink}
];

/* ---------- MyFreeScoreNow (affiliate) — from the affiliate portal ---------- */
var MF={ ytd:107780, latestMonth:17192, active:203, enrolled:1493, upgraded:420, toUpgrade:1073, newActives:736 };
// Total monthly affiliate earnings (commission + referral + bonuses), most recent 10 months.
var MF_MONTHLY={ labels:['Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun'],
  vals:[16038,16982,17236,16572,16573,16915,19100,19002,18999,17192] };

var TOTAL_YTD = CO.ytd + MF.ytd; // combined business income YTD

/* ---------- Total income card: real month-by-month Commas/MFSN split ----------
   Same two source snapshots as above, just keyed to actual calendar months
   so the Total income card can sum whichever months fall inside whatever
   date range is currently selected (Today/7D/30D/90D/YTD/All, or a custom
   range) instead of always showing a fixed "YTD" figure. Commas is tracked
   Jan-Jul 2026 (CO_MONTHLY); MFSN commissions are tracked back further,
   Sep 2025-Jun 2026 (MF_MONTHLY) -- both real monthly totals already pulled
   from each platform, just not (yet) reported for the current month. */
var CO_YM=['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06','2026-07'];
var MF_YM=['2025-09','2025-10','2025-11','2025-12','2026-01','2026-02','2026-03','2026-04','2026-05','2026-06'];
var INCOME_BY_MONTH=(function(){
  var m={};
  CO_YM.forEach(function(ym,i){ m[ym]=m[ym]||{co:0,mf:0}; m[ym].co=CO_MONTHLY.rev[i]; });
  MF_YM.forEach(function(ym,i){ m[ym]=m[ym]||{co:0,mf:0}; m[ym].mf=MF_MONTHLY.vals[i]; });
  return m;
})();
var INCOME_YMS=Object.keys(INCOME_BY_MONTH).sort();
function parseYMD(s){ if(!s)return null; var p=String(s).split('-'); return new Date(+p[0],+p[1]-1,+(p[2]||1)); }
// Sums whichever tracked months overlap [fromStr,toStr] (either bound can be
// null/omitted, meaning "open ended" -- that's how the "All" preset works).
// Whole-month granularity is the honest limit of the data itself (MFSN
// commissions are only ever reported per month, not per day), so a month
// counts if any part of it falls in range, same as any monthly statement.
function incomeForRange(fromStr,toStr){
  var fromD=parseYMD(fromStr), toD=parseYMD(toStr);
  var co=0,mf=0,months=[];
  INCOME_YMS.forEach(function(ym){
    var y=+ym.slice(0,4), mo=+ym.slice(5,7);
    var monthStart=new Date(y,mo-1,1), monthEnd=new Date(y,mo,0);
    if((!fromD||monthEnd>=fromD)&&(!toD||monthStart<=toD)){
      co+=INCOME_BY_MONTH[ym].co||0; mf+=INCOME_BY_MONTH[ym].mf||0; months.push(ym);
    }
  });
  return {co:co,mf:mf,total:co+mf,months:months};
}
var MONTH_ABBR=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
// Redraws the Total income card (#rvkTotalV/#rvkTotalSub/#rvkSplitLegend +
// the stacked bar in #rvkSparkTotal) for whatever range is currently
// selected on the Dashboard -- called once on load and again every time
// loadDashboard() runs (see the window.loadDashboard wrap in initRV, below),
// so it always tracks the Today/7D/30D/90D/YTD/All/custom picker up top.
function updateTotalIncomeCard(){
  var v=document.getElementById('rvkTotalV'); if(!v)return;
  var f=(typeof from!=='undefined')?from:null, t=(typeof to!=='undefined')?to:null;
  var r=incomeForRange(f,t);
  var lbl=(typeof rangeLabel==='function')?rangeLabel():'';
  document.getElementById('rvkTotalL').textContent='Total income'+(lbl?' · '+lbl:'');
  v.textContent=money0(r.total);
  var sub=document.getElementById('rvkTotalSub');
  if(sub) sub.textContent=r.months.length?('Commas '+money0(r.co)+' + MFSN '+money0(r.mf)):'No tracked months in this range yet';
  var lc=document.getElementById('rvkSplitCommas'); if(lc)lc.textContent=money0(r.co);
  var lm=document.getElementById('rvkSplitMfsn'); if(lm)lm.textContent=money0(r.mf);
  var cv=document.getElementById('rvkSparkTotal'); if(!cv||!window.Chart)return;
  killChart('rvkSparkTotal');
  var labels=r.months.map(function(ym){ return MONTH_ABBR[+ym.slice(5,7)-1]+' '+ym.slice(2,4); });
  var coVals=r.months.map(function(ym){return INCOME_BY_MONTH[ym].co||0;});
  var mfVals=r.months.map(function(ym){return INCOME_BY_MONTH[ym].mf||0;});
  // Chart draws on its own white panel (see .rvk-split-wrap) so tick labels
  // get normal dark/gray colors instead of fighting the green card
  // background. Two plain side-by-side bars per month -- no stacking, no
  // trend line -- Commas and MFSN each get their own bar so the two are
  // directly comparable at a glance, not just a color-coded slice of one bar.
  charts.rvkSparkTotal=new Chart(cv.getContext('2d'),{type:'bar',
    data:{labels:labels,datasets:[
      {label:'Commas',data:coVals,backgroundColor:C.blue,borderRadius:4,borderSkipped:false},
      {label:'MFSN',data:mfVals,backgroundColor:C.green,borderRadius:4,borderSkipped:false}
    ]},
    options:{responsive:true,maintainAspectRatio:false,animation:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:function(c){return c.dataset.label+': '+money0(c.parsed.y);}}}},
      scales:{
        x:{grid:{display:false},ticks:{color:'#6b7280',font:{size:10.5,weight:'600'}}},
        y:{ticks:{color:'#6b7280',callback:function(x){return moneyK(x);},font:{size:10}},grid:{color:'#eef0f4'}}
      }}});
}

var DISPUTES=[
  {amt:100, kind:'General', due:'6 days to respond'},
  {amt:100, kind:'General', due:'11 days to respond'},
  {amt:250, kind:'Product not received', due:'25 days to respond'}
];

/* ---------- helpers ---------- */
function money0(n){var neg=n<0;return (neg?'-':'')+'$'+Math.abs(Math.round(n)).toLocaleString('en-US');}
function moneyK(n){return '$'+(Math.round(n/100)/10)+'k';}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;');}

/* ---------- patch the main Dashboard hero to show combined (Commas + MFSN) income ---------- */
function _dlabels(n){var l=[];for(var i=n-1;i>=0;i--){var d=new Date(2026,6,28);d.setDate(d.getDate()-i);l.push((d.getMonth()+1)+'/'+d.getDate());}return l;}
var HERO_DAILY={labels:_dlabels(30),vals:[2023,2293,1883,1553,2113,2183,1863,1753,1993,1933,2083,1813,1663,1903,2053,1793,1723,1963,1843,1513,1333,993,753,573,1490,1560,1470,1600,1520,1631]};
var HERO_WEEK={labels:_dlabels(7),vals:[1620,1490,1550,1410,1600,1500,1631]};
var HERO_MONTH={labels:['Jan','Feb','Mar','Apr','May','Jun','Jul'],vals:[560221,103915,91100,81002,66999,50321,46292]};
/* combined (Commas + MyFreeScoreNow) totals per time window */
var PERIODS={
 'Today':{amt:'$1,543', label:'TOTAL COLLECTED · TODAY',        note:'Commas $970 + MyFreeScoreNow $573 · today',                          chart:HERO_WEEK},
 '7D':   {amt:'$10,801',label:'TOTAL COLLECTED · LAST 7 DAYS',  note:'Commas $6,790 + MyFreeScoreNow $4,011 · last 7 days',                chart:HERO_WEEK},
 '30D':  {amt:'$46,292',label:'TOTAL COLLECTED · LAST 30 DAYS', note:'Commas sales $29,100 + MyFreeScoreNow commissions $17,192 · last 30 days', chart:HERO_DAILY},
 '90D':  {amt:'$161,805',label:'TOTAL COLLECTED · LAST 90 DAYS',note:'Commas $110,229 + MyFreeScoreNow $51,576 · last 90 days',            chart:HERO_MONTH},
 'YTD':  {amt:'$982,657',label:'TOTAL COLLECTED · YEAR TO DATE',note:'Commas $874,877 + MyFreeScoreNow $107,780 · year to date',           chart:HERO_MONTH},
 'All':  {amt:'$982,657',label:'TOTAL COLLECTED · ALL TIME',    note:'Commas $874,877 + MyFreeScoreNow $107,780 · all time',               chart:HERO_MONTH}
};
var curPeriod='30D';
function _setTxt(id,v){var e=document.getElementById(id);if(e)e.textContent=v;}
function hideSyncAlert(){
  var els=document.querySelectorAll('.view *, section *');
  for(var i=0;i<els.length;i++){var e=els[i];
   if(e.children.length===0 && /Payment sync (quiet|down)/i.test(e.textContent)){
     var row=e.parentElement;
     for(var k=0;k<5&&row;k++){ if(row.querySelector&&row.querySelector('button')&&row.textContent.length<170){row.style.display='none';return;} row=row.parentElement; }
     return;
   }
  }
}
function drawHeroChart(){
  if(!window.Chart)return;var cv=document.getElementById('chHero');if(!cv)return;
  try{var ex=Chart.getChart(cv);if(ex)ex.destroy();}catch(e){}
  var hd=(PERIODS[curPeriod]||PERIODS['30D']).chart;
  charts.hero=new Chart(cv.getContext('2d'),{type:'line',data:{labels:hd.labels,datasets:[{data:hd.vals,borderColor:C.green,backgroundColor:'rgba(46,125,84,.10)',fill:true,tension:.32,pointRadius:0,borderWidth:2.5}]},
   options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:function(c){return money0(c.parsed.y);}}}},scales:{y:{ticks:{callback:function(v){return money0(v);},font:{size:10}},grid:{color:'#efe9df'}},x:{grid:{display:false},ticks:{font:{size:10},maxTicksLimit:8}}}}});
}
function patchDash(){
  // idempotent + cheap — run every tick so the badge/alert stay hidden even when the app re-renders
  var b=document.getElementById('heroBadge');if(b)b.style.display='none';
  hideSyncAlert();
  var hero=document.getElementById('heroAmt');if(!hero)return;
  var P=PERIODS[curPeriod]||PERIODS['30D'];
  if(hero.textContent===P.amt)return; // already showing the right figure for this window
  _setTxt('heroLabel',P.label);
  _setTxt('heroAmt',P.amt);
  _setTxt('heroNote',P.note);
  _setTxt('railLifetime','$982,657');
  _setTxt('railLifetimeSub','Lifetime · Commas $874,877 + MFSN $107,780');
  _setTxt('railAvg','$234');
  _setTxt('railLtv','$263');
  drawHeroChart();
}
/* make the Today / 7D / 30D / 90D / YTD / All buttons re-point the combined hero */
function hookPeriods(){
  var wanted={'Today':1,'7D':1,'30D':1,'90D':1,'YTD':1,'All':1};
  var els=document.querySelectorAll('button, a');
  for(var i=0;i<els.length;i++){var el=els[i];var t=(el.textContent||'').trim();
    if(wanted[t] && el.children.length===0 && !el.__mfp){ el.__mfp=1;
      (function(txt){el.addEventListener('click',function(){curPeriod=txt;setTimeout(patchDash,100);setTimeout(patchDash,400);setTimeout(patchDash,900);});})(t);
    }
  }
}

/* ---------- styles ---------- */
var css=''+
'#view-rev{padding:24px 30px 60px}'+
'#view-rev .rv-sub{color:var(--muted);font-size:12.5px;margin:2px 0 16px;max-width:1000px;line-height:1.6}'+
'#view-rev .rv-band{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#6f6857;margin:22px 0 12px;display:flex;align-items:center;gap:9px}'+
'#view-rev .rv-band .ic{width:20px;height:20px;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:11px}'+
/* .rv-kpi/.rv-card/.rv-head/.rv-wrap/.rv-tabs are left unscoped (no
   "#view-rev " prefix) on purpose -- the Sales-trend card and the income
   KPI band now also render as Dashboard grid-stack cards (see index.html
   #dashGrid, gs-id="rev-kpis"/"rev-trend"), so the same rules have to
   apply outside #view-rev too. */
'.rv-kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:16px}'+
'.rv-kpi{background:var(--card);border:1px solid var(--line);border-radius:13px;padding:14px 16px;border-top:3px solid var(--line)}'+
'.rv-kpi .l{font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}'+
'.rv-kpi .v{font-size:23px;font-weight:800;margin-top:6px;letter-spacing:-.5px}'+
'.rv-kpi .s{font-size:11px;color:var(--muted);margin-top:3px}'+
'.rv-kpi.hero{background:var(--card);border-top-color:var(--green)}.rv-kpi.hero .l{color:var(--green)}.rv-kpi.hero .v{color:var(--ink);font-size:25px}.rv-kpi.hero .s{color:var(--muted)}'+
'#view-rev .rv-grid2{display:grid;grid-template-columns:1.35fr .65fr;gap:16px;margin-bottom:16px}'+
'#view-rev .rv-grid11{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}'+
'.rv-card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px}'+
'.rv-card h3{margin:0 0 3px;font-size:14px}.rv-card .cap{color:var(--muted);font-size:12px;margin:0 0 12px}'+
'.rv-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px}'+
'.rv-wrap{position:relative;height:280px}.rv-wrap.sm{height:230px}'+
'.rv-tabs{display:inline-flex;border:1px solid var(--line);border-radius:9px;overflow:hidden}'+
'.rv-tabs button{border:none;background:var(--card);padding:6px 15px;font-size:12px;font-weight:700;cursor:pointer;color:var(--muted);border-right:1px solid var(--line)}'+
'.rv-tabs button:last-child{border-right:none}.rv-tabs button.on{background:var(--ink);color:#fff}'+
'#view-rev .rv-mrow{display:grid;grid-template-columns:1.1fr 1fr 74px;gap:12px;align-items:center;padding:10px 4px;border-bottom:1px solid #f0ece3}#view-rev .rv-mrow:last-child{border-bottom:none}'+
'#view-rev .rv-dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:8px;vertical-align:middle}'+
'#view-rev .rv-mn{font-weight:700;font-size:13px}#view-rev .rv-ma{font-variant-numeric:tabular-nums;font-weight:700}'+
'#view-rev .rv-prog{height:8px;background:#efe9df;border-radius:6px;overflow:hidden}#view-rev .rv-prog>i{display:block;height:100%;border-radius:6px}'+
'#view-rev .rv-disp{display:flex;justify-content:space-between;align-items:center;padding:11px 4px;border-bottom:1px solid #f0ece3}#view-rev .rv-disp:last-child{border-bottom:none}'+
'#view-rev .rv-pill{display:inline-block;background:var(--gold-soft);color:#8a6516;border-radius:20px;padding:2px 9px;font-size:10.5px;font-weight:700}'+
'#view-rev .rv-foot{font-size:11.5px;color:var(--muted);margin-top:14px;line-height:1.6}'+
// sizing for the two cards when they live inside a GridStack item on the
// Dashboard instead of the free-flowing Revenue page
'.grid-stack-item-content>.rv-card{height:100%;box-sizing:border-box;overflow:auto;display:flex;flex-direction:column}'+
'.grid-stack-item-content>.rv-card>.rv-wrap{flex:1 1 auto;min-height:0;height:auto!important}'+
'.grid-stack-item-content>.rv-kpis{height:100%}'+
// the Lifetime collected / Avg payment / LTV / New clients KPI rail, moved
// here from the Dashboard -- .kpi/.spark/.miniring are all global classes
// (defined in index.html, not scoped to #view-dash), so they render fine
// here too; this just lays the four out in a row.
'.kpi-row{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px}'+
// the relocated "Total collected" hero card (moved out of #dashGrid, see
// index.html) needs the flex rule that used to key off
// .grid-stack-item-content>.card.hero -- it's a plain block on the Revenue
// page now, so give it an equivalent here instead.
'#view-rev .card.hero{margin-bottom:16px}';

/* ---------- section shell ----------
   The "Total collected" hero card used to live on the Dashboard
   (#dashGrid, gs-id="hero"); it's moved here, under the Revenue page's own
   heading, per request. Its ids (heroLabel/heroBadge/heroAmt/heroNote/
   chHero) are unchanged, so index.html's loadDashboard() -- which runs on
   a timer regardless of which view is showing, see its boot section --
   still finds and fills it in exactly as before. */
var sectionHTML=''+
'<div class="rv-sub"><b>Revenue.</b> Total business income — Commas sales plus MyFreeScoreNow affiliate commissions — by day, week and month, with the full payment-method mix.</div>'+
'<div class="kpi-row">'+
  '<div class="kpi g1"><div><div class="ico">◈</div><span class="l" id="railLifetimeSub">Lifetime collected</span><b id="railLifetime">—</b><span class="delta" id="railLifetimeDelta"></span></div><canvas class="spark" id="sparkLifetime"></canvas></div>'+
  '<div class="kpi g2"><div><div class="ico">▤</div><span class="l">Avg payment · per transaction</span><b id="railAvg">—</b><span class="delta" id="railAvgDelta"></span></div><canvas class="spark" id="sparkAvg"></canvas></div>'+
  '<div class="kpi g3"><div><div class="ico">◎</div><span class="l">LTV · per paying client</span><b id="railLtv">—</b><span class="delta" id="railLtvDelta"></span></div><div class="miniring" id="ltvRing" style="--pct:0"><div class="hole"><b id="ltvRingPct">0%</b></div></div></div>'+
  '<div class="kpi g4"><div><div class="ico">✚</div><span class="l">New clients · joined in period</span><b id="railNew">—</b><span class="delta" id="railNewDelta"></span></div><canvas class="spark" id="sparkNew"></canvas></div>'+
'</div>'+
'<div class="card hero thin">'+
  '<div>'+
    '<div style="display:flex;gap:10px;align-items:center">'+
      '<span class="eyebrow" id="heroLabel">COLLECTED</span>'+
      '<span class="badge-soft badge-ok" id="heroBadge">FANBASIS LIVE</span>'+
    '</div>'+
    '<div class="big" id="heroAmt"><sup>$</sup>0</div>'+
    '<div class="note" id="heroNote">—</div>'+
    '<div class="cwrap"><canvas id="chHero"></canvas></div>'+
  '</div>'+
'</div>'+
'<div id="rvBody"></div>';

function render(){
  var html=''+
  // ---- combined headline ----
  '<div class="rv-kpis">'+
   '<div class="rv-kpi hero"><div class="l">Total income · YTD</div><div class="v">'+money0(TOTAL_YTD)+'</div><div class="s">Commas sales + MFSN commissions</div></div>'+
   '<div class="rv-kpi" style="border-top-color:'+C.blue+'"><div class="l">Commas sales · YTD</div><div class="v">'+money0(CO.ytd)+'</div><div class="s">'+CO.ytdCustomers.toLocaleString()+' paying customers</div></div>'+
   '<div class="rv-kpi" style="border-top-color:'+C.green+'"><div class="l">MFSN commissions · YTD</div><div class="v">'+money0(MF.ytd)+'</div><div class="s">'+MF.active+' active members</div></div>'+
   '<div class="rv-kpi" style="border-top-color:'+C.teal+'"><div class="l">Commas · this month</div><div class="v">'+money0(CO.month)+'</div><div class="s">'+CO.monthCustomers+' new customers</div></div>'+
   '<div class="rv-kpi" style="border-top-color:'+C.purple+'"><div class="l">MFSN · latest month</div><div class="v">'+money0(MF.latestMonth)+'</div><div class="s">recurring affiliate income</div></div>'+
  '</div>'+
  // ---- Commas band ----
  '<div class="rv-band"><span class="ic" style="background:'+C.blue+'">$</span>Commas — sales</div>'+
  '<div class="rv-grid2">'+
   '<div class="rv-card"><div class="rv-head"><div><h3>Sales trend</h3><div class="cap" style="margin:0">Gross collected. Switch the grain: day, week or month.</div></div>'+
     '<div class="rv-tabs" id="rvGran">'+
      '<button data-g="daily"'+(gran==='daily'?' class="on"':'')+'>Daily</button>'+
      '<button data-g="weekly"'+(gran==='weekly'?' class="on"':'')+'>Weekly</button>'+
      '<button data-g="monthly"'+(gran==='monthly'?' class="on"':'')+'>Monthly</button>'+
     '</div></div>'+
     '<div class="rv-wrap"><canvas id="rvTrend"></canvas></div></div>'+
   '<div class="rv-card"><h3>Payment methods</h3><div class="cap">Share of collections, all-time.</div><div class="rv-wrap sm"><canvas id="rvMethods"></canvas></div></div>'+
  '</div>'+
  '<div class="rv-grid11">'+
   '<div class="rv-card"><h3>New customers by month</h3><div class="cap">Paying customers acquired.</div><div class="rv-wrap sm"><canvas id="rvCust"></canvas></div></div>'+
   '<div class="rv-card"><h3>Payment method breakdown</h3><div class="cap">Dollars collected per method, all-time.</div>'+methodRows()+'</div>'+
  '</div>'+
  // ---- MyFreeScoreNow band ----
  '<div class="rv-band"><span class="ic" style="background:'+C.green+'">◎</span>MyFreeScoreNow — affiliate income</div>'+
  '<div class="rv-kpis" style="grid-template-columns:repeat(5,1fr)">'+
   '<div class="rv-kpi" style="border-top-color:'+C.green+'"><div class="l">Commissions · YTD</div><div class="v">'+money0(MF.ytd)+'</div><div class="s">2026 to date</div></div>'+
   '<div class="rv-kpi" style="border-top-color:'+C.gold+'"><div class="l">Latest month</div><div class="v">'+money0(MF.latestMonth)+'</div><div class="s">most recent payout</div></div>'+
   '<div class="rv-kpi" style="border-top-color:'+C.blue+'"><div class="l">Enrolled members</div><div class="v">'+MF.enrolled.toLocaleString()+'</div><div class="s">'+MF.active+' active</div></div>'+
   '<div class="rv-kpi" style="border-top-color:'+C.teal+'"><div class="l">Upgraded</div><div class="v">'+MF.upgraded+'</div><div class="s">to new platform</div></div>'+
   '<div class="rv-kpi" style="border-top-color:'+C.purple+'"><div class="l">New portal actives</div><div class="v">'+MF.newActives+'</div><div class="s">bonus tier progress</div></div>'+
  '</div>'+
  '<div class="rv-grid2">'+
   '<div class="rv-card"><h3>Affiliate commissions by month</h3><div class="cap">Total monthly payout (commission + referral + bonuses).</div><div class="rv-wrap"><canvas id="rvMf"></canvas></div></div>'+
   '<div class="rv-card"><h3>Member upgrade progress</h3><div class="cap">Migrating the book to the new platform.</div>'+
     '<div class="rv-mrow"><div class="rv-mn"><span class="rv-dot" style="background:'+C.green+'"></span>Upgraded</div><div class="rv-prog"><i style="width:'+Math.round(MF.upgraded/MF.enrolled*100)+'%;background:'+C.green+'"></i></div><div class="rv-ma" style="text-align:right">'+MF.upgraded+'</div></div>'+
     '<div class="rv-mrow"><div class="rv-mn"><span class="rv-dot" style="background:'+C.gold+'"></span>Need upgrade</div><div class="rv-prog"><i style="width:'+Math.round(MF.toUpgrade/MF.enrolled*100)+'%;background:'+C.gold+'"></i></div><div class="rv-ma" style="text-align:right">'+MF.toUpgrade.toLocaleString()+'</div></div>'+
     '<div class="rv-mrow"><div class="rv-mn"><span class="rv-dot" style="background:'+C.blue+'"></span>Active members</div><div class="rv-prog"><i style="width:'+Math.round(MF.active/MF.enrolled*100)+'%;background:'+C.blue+'"></i></div><div class="rv-ma" style="text-align:right">'+MF.active+'</div></div>'+
     '<div style="margin-top:12px;font-size:12px;color:var(--muted)">'+Math.round(MF.upgraded/MF.enrolled*100)+'% of '+MF.enrolled.toLocaleString()+' members migrated.</div>'+
   '</div>'+
  '</div>'+
  // ---- disputes ----
  '<div class="rv-grid11">'+
   '<div class="rv-card"><h3>Revenue by period</h3><div class="cap">Commas sales across windows.</div><div class="rv-wrap sm"><canvas id="rvPeriods"></canvas></div></div>'+
   '<div class="rv-card"><h3>Open disputes</h3><div class="cap">Chargebacks needing a response.</div>'+
     DISPUTES.map(function(d){return '<div class="rv-disp"><div><b>'+money0(d.amt)+'</b> <span style="color:var(--muted);font-size:12px">· '+esc(d.kind)+'</span></div><span class="rv-pill">'+esc(d.due)+'</span></div>';}).join('')+
   '</div>'+
  '</div>'+
  '<div class="rv-foot">Commas sales and MyFreeScoreNow affiliate commissions, updated Jul 28, 2026.</div>';
  document.getElementById('rvBody').innerHTML=html;
  drawTrend(); drawMethods(); drawCust(); drawMf(); drawPeriods();
  wireGranTabs('rvGran');
}
function methodRows(){
  return METHODS.map(function(m){
    return '<div class="rv-mrow"><div class="rv-mn"><span class="rv-dot" style="background:'+m.color+'"></span>'+esc(m.name)+'</div>'+
      '<div class="rv-prog"><i style="width:'+m.pct+'%;background:'+m.color+'"></i></div>'+
      '<div class="rv-ma" style="text-align:right">'+money0(m.amt)+'</div></div>';
  }).join('');
}

/* ---------- charts ---------- */
function killChart(k){if(charts[k]){charts[k].destroy();charts[k]=null;}}
function trendData(){
  if(gran==='daily')return {labels:CO_DAILY.labels,vals:CO_DAILY.rev,color:C.teal,fill:'rgba(47,143,138,.12)'};
  if(gran==='weekly')return {labels:CO_WEEKLY.labels,vals:CO_WEEKLY.rev,color:C.purple,fill:'rgba(107,91,208,.12)'};
  return {labels:CO_MONTHLY.labels,vals:CO_MONTHLY.rev,color:C.blue,fill:'rgba(53,99,168,.12)'};
}
// targetId lets the same Sales-trend chart draw into either the Revenue
// page's own canvas (#rvTrend) or the copy that now also lives on the
// Dashboard (#dashTrend, see index.html gs-id="rev-trend") -- whichever of
// the two is present and asked for.
function drawTrend(targetId){
  targetId=targetId||'rvTrend';
  if(!window.Chart)return;var el=document.getElementById(targetId);if(!el)return;killChart(targetId);
  var d=trendData();
  charts[targetId]=new Chart(el.getContext('2d'),{type:'line',data:{labels:d.labels,datasets:[{data:d.vals,borderColor:d.color,backgroundColor:d.fill,fill:true,tension:.32,pointRadius:gran==='monthly'?3:0,pointBackgroundColor:d.color,borderWidth:2.5}]},
   options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:function(c){return money0(c.parsed.y);}}}},scales:{y:{ticks:{callback:function(v){return moneyK(v);},font:{size:10}},grid:{color:'#efe9df'}},x:{grid:{display:false},ticks:{font:{size:10},maxTicksLimit:12}}}}});
}
// redraws whichever of the two Sales-trend canvases currently exist in the
// document -- the Revenue page's isn't in the DOM unless that view has
// been rendered at least once, the Dashboard's is always there.
function redrawAllTrends(){
  ['rvTrend','dashTrend'].forEach(function(id){ if(document.getElementById(id)) drawTrend(id); });
}
// wires a set of Daily/Weekly/Monthly tab buttons (there are now two --
// one on the Revenue page, one on the Dashboard card); clicking either
// updates the single shared `gran`, syncs the .on state across BOTH tab
// sets, and redraws both trend charts, so the two copies never disagree.
function wireGranTabs(containerId){
  var c=document.getElementById(containerId); if(!c)return;
  c.querySelectorAll('button').forEach(function(b){
    b.onclick=function(){
      gran=b.getAttribute('data-g');
      document.querySelectorAll('.rv-tabs button').forEach(function(x){x.classList.toggle('on',x.getAttribute('data-g')===gran);});
      redrawAllTrends();
    };
  });
}
function drawMethods(){
  if(!window.Chart)return;var el=document.getElementById('rvMethods');if(!el)return;killChart('m');
  charts.m=new Chart(el.getContext('2d'),{type:'doughnut',data:{labels:METHODS.map(function(m){return m.name;}),datasets:[{data:METHODS.map(function(m){return m.amt;}),backgroundColor:METHODS.map(function(m){return m.color;}),borderWidth:2,borderColor:'#fff'}]},
   options:{responsive:true,maintainAspectRatio:false,cutout:'56%',plugins:{legend:{position:'right',labels:{boxWidth:10,font:{size:10.5},padding:7}},tooltip:{callbacks:{label:function(c){return c.label+': '+money0(c.parsed);}}}}}});
}
function drawCust(){
  if(!window.Chart)return;var el=document.getElementById('rvCust');if(!el)return;killChart('c');
  charts.c=new Chart(el.getContext('2d'),{type:'bar',data:{labels:CO_MONTHLY.labels,datasets:[{data:CO_MONTHLY.cust,backgroundColor:PAL,borderRadius:4}]},
   options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:function(c){return c.parsed.y+' new customers';}}}},scales:{y:{ticks:{font:{size:10}},grid:{color:'#efe9df'}},x:{grid:{display:false},ticks:{font:{size:10}}}}}});
}
function drawMf(){
  if(!window.Chart)return;var el=document.getElementById('rvMf');if(!el)return;killChart('mf');
  charts.mf=new Chart(el.getContext('2d'),{type:'bar',data:{labels:MF_MONTHLY.labels,datasets:[{data:MF_MONTHLY.vals,backgroundColor:MF_MONTHLY.labels.map(function(_,i){return PAL[i%PAL.length];}),borderRadius:4}]},
   options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:function(c){return money0(c.parsed.y);}}}},scales:{y:{ticks:{callback:function(v){return moneyK(v);},font:{size:10}},grid:{color:'#efe9df'}},x:{grid:{display:false},ticks:{font:{size:10}}}}}});
}
// small trend chart in the corner of each Dashboard income KPI tile (see
// index.html gs-id="rev-kpi-*", .rvkspark canvases). Built from the same
// real figures already on the page -- the combined-total monthly series
// for the hero tile, Commas' own monthly/daily series, MFSN's own monthly
// series -- not fabricated placeholder data.
// A single shared HTML tooltip (not the canvas-drawn kind) so it can float
// outside each tiny sparkline's own clipped card instead of getting cut off
// at ~60px square. Positioned with position:fixed against the real cursor
// point Chart.js hands us, so it works no matter how the card is resized.
function sparkTooltipEl(){
  var el=document.getElementById('rvkTooltip');
  if(!el){
    el=document.createElement('div');
    el.id='rvkTooltip';
    el.style.cssText='position:fixed;pointer-events:none;z-index:9999;background:#20222b;color:#fff;'+
      'font-size:11.5px;line-height:1.45;padding:7px 11px;border-radius:9px;box-shadow:0 8px 22px rgba(0,0,0,.28);'+
      'opacity:0;transition:opacity .08s ease;white-space:nowrap;transform:translate(-50%,-100%)';
    document.body.appendChild(el);
  }
  return el;
}
function sparkOpts(period){
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
function trendBadge(vals){
  if(!vals||vals.length<2)return null;
  // Trailing zeros mean "no data yet" (e.g. days later this month), not a
  // real drop to $0 -- walk back to the last actual reported value.
  var end=vals.length-1;
  while(end>0 && !vals[end]) end--;
  var first=vals[0], last=vals[end];
  if(!first || end<1)return null;
  var pct=((last-first)/Math.abs(first))*100;
  var up=pct>=0;
  return {text:(up?'▲ ':'▼ ')+Math.abs(pct).toFixed(0)+'%', up:up};
}
// Kept as a thin wrapper (rather than renaming every call site) -- the 4
// separate Commas/MFSN KPI tiles this used to redraw sparklines for are
// gone; the one remaining Total income tile now gets a real range-aware
// stacked bar from updateTotalIncomeCard() instead of a fixed sparkline.
function drawKpiSparklines(){ updateTotalIncomeCard(); }
function drawPeriods(){
  if(!window.Chart)return;var el=document.getElementById('rvPeriods');if(!el)return;killChart('p');
  var labels=['This week','This month','Last 6 mo','Year to date'];
  var vals=[CO.week,CO.month,CO.sixMo,CO.ytd];
  var cols=[C.purple,C.green,C.blue,C.gold];
  charts.p=new Chart(el.getContext('2d'),{type:'bar',data:{labels:labels,datasets:[{data:vals,backgroundColor:cols,borderRadius:4}]},
   options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:function(c){return money0(c.parsed.y);}}}},scales:{y:{ticks:{callback:function(v){return moneyK(v);},font:{size:10}},grid:{color:'#efe9df'}},x:{grid:{display:false},ticks:{font:{size:10}}}}}});
}

/* ---------- init ---------- */
function initRV(){
  if(document.getElementById('view-rev'))return;
  var style=document.createElement('style');style.textContent=css;document.head.appendChild(style);
  var anc=document.getElementById('view-dash');
  var sec=document.createElement('section');sec.id='view-rev';sec.style.display='none';sec.innerHTML=sectionHTML;
  if(anc&&anc.parentNode)anc.parentNode.insertBefore(sec,anc); else document.body.appendChild(sec);
  var nav=document.getElementById('navFinance')||document.getElementById('nav');
  if(nav&&!document.getElementById('rvNavBtn')){
    var b=document.createElement('button');b.id='rvNavBtn';b.setAttribute('onclick',"showView('rev')");
    b.innerHTML='<span class="ico2">$</span>Revenue';nav.appendChild(b);
  }
  if(typeof window.showView==='function'&&!window.__rvWrap){
    window.__rvWrap=true;var _sv=window.showView;
    window.showView=function(id){
      if(id==='rev'){
        var sv=document.querySelectorAll('.view');for(var i=0;i<sv.length;i++){sv[i].classList.remove('on');sv[i].style.display='';}
        ['view-production','view-personal','view-mfsn'].forEach(function(x){var e=document.getElementById(x);if(e)e.style.display='none';});
        var v=document.getElementById('view-rev');if(v)v.style.display='';
        var nbs=document.querySelectorAll('.navgroup button');for(var j=0;j<nbs.length;j++)nbs[j].classList.remove('on');
        var nb=document.getElementById('rvNavBtn');if(nb)nb.classList.add('on');
        if(window.setNavGroup)window.setNavGroup('fi',false);
        var pt=document.getElementById('pageTitle');if(pt)pt.textContent='Revenue';
        render();
      } else {
        var v=document.getElementById('view-rev');if(v)v.style.display='none';
        var sv=document.querySelectorAll('.view');for(var i=0;i<sv.length;i++)sv[i].style.display='';
        var nb=document.getElementById('rvNavBtn');if(nb)nb.classList.remove('on');
        _sv(id);
      }
    };
  }
  // #dashTrend (Sales trend, moved onto the Dashboard grid -- see
  // index.html gs-id="rev-trend") is static HTML present from page load,
  // not something render() builds, so it needs its own one-time draw +
  // tab wiring here instead of waiting for the Revenue view to be opened.
  drawTrend('dashTrend');
  drawKpiSparklines();
  wireGranTabs('rvGranDash');
  // Total income card needs to redraw every time the Today/7D/30D/90D/YTD/
  // All picker (or a custom Apply) changes the selected range -- every one
  // of those routes through loadDashboard() (see index.html setPreset/
  // applyCustom), so wrap it once here, the same pattern already used above
  // for window.showView. Guarded against double-wrapping if initRV somehow
  // runs twice.
  if(typeof window.loadDashboard==='function'&&!window.__rvLoadWrap){
    window.__rvLoadWrap=true;var _ld=window.loadDashboard;
    window.loadDashboard=function(){
      var p=_ld.apply(this,arguments);
      if(p&&typeof p.then==='function') p.then(updateTotalIncomeCard); else updateTotalIncomeCard();
      return p;
    };
  }
  // resizeDashCharts() in index.html only knows about its own chart
  // registry; this lets it also nudge every chart this file owns (the
  // Sales-trend copy and the 5 KPI sparklines) after a GridStack
  // drag/resize, so they don't stay stretched/squished from whatever size
  // they were created at.
  // Chain rather than overwrite: mfsn.js (loaded before this file, see
  // index.html's script order) sets this same hook for its own Dashboard
  // sparklines, and a straight assignment here would clobber that.
  var _prevResizeExtra=window.__resizeExtraCharts;
  window.__resizeExtraCharts=function(){ if(_prevResizeExtra)_prevResizeExtra(); for(var k in charts){ if(charts[k]) charts[k].resize(); } };
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initRV);else initRV();

/* NOTE: this used to force-patch the main Dashboard's hero/KPI rail with a
   hardcoded Jul 28 2026 snapshot every second (startPatch below), from back
   before the dashboard pulled real numbers itself. Now that the KPI rail
   computes real figures from live data (and has its own mini-charts on
   every card), that patch does nothing but fight the real numbers -- it
   was overwriting Avg Payment/LTV with stale $234/$263 forever and
   re-drawing #chHero with fake data once a second, which is exactly why a
   redesign of those cards looked like "nothing changed." Left disabled,
   not deleted, in case Revenue-page-only pieces of this file are still
   wanted later. */
// function startPatch(){ patchDash(); hookPeriods(); setTimeout(hookPeriods,1200); setTimeout(hookPeriods,3000); setInterval(patchDash,1000); setInterval(hookPeriods,4000); }
// if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',startPatch);else startPatch();
})();
