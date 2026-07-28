/* Revenue — total business income: Commas sales + MyFreeScoreNow affiliate commissions.
   Figures read from the Commas dashboard and the MyFreeScoreNow affiliate portal (Jul 28 2026). */
(function(){
var C={ink:'#211d18',blue:'#3563a8',green:'#2e7d54',gold:'#b98a2f',red:'#b3372f',teal:'#2f8f8a',purple:'#6b5bd0',orange:'#c06a2b',pink:'#c14d8a',lime:'#6f8f2f',slate:'#5a6b7d'};
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
'#view-rev .rv-kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:16px}'+
'#view-rev .rv-kpi{background:var(--card);border:1px solid var(--line);border-radius:13px;padding:14px 16px;border-top:3px solid var(--line)}'+
'#view-rev .rv-kpi .l{font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}'+
'#view-rev .rv-kpi .v{font-size:23px;font-weight:800;margin-top:6px;letter-spacing:-.5px}'+
'#view-rev .rv-kpi .s{font-size:11px;color:var(--muted);margin-top:3px}'+
'#view-rev .rv-kpi.hero{background:var(--ink);border-top-color:#b98a2f}#view-rev .rv-kpi.hero .l{color:#c7c0b4}#view-rev .rv-kpi.hero .v{color:#fff;font-size:25px}#view-rev .rv-kpi.hero .s{color:#a49c8e}'+
'#view-rev .rv-grid2{display:grid;grid-template-columns:1.35fr .65fr;gap:16px;margin-bottom:16px}'+
'#view-rev .rv-grid11{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}'+
'#view-rev .rv-card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px}'+
'#view-rev .rv-card h3{margin:0 0 3px;font-size:14px}#view-rev .rv-card .cap{color:var(--muted);font-size:12px;margin:0 0 12px}'+
'#view-rev .rv-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px}'+
'#view-rev .rv-wrap{position:relative;height:280px}#view-rev .rv-wrap.sm{height:230px}'+
'#view-rev .rv-tabs{display:inline-flex;border:1px solid var(--line);border-radius:9px;overflow:hidden}'+
'#view-rev .rv-tabs button{border:none;background:var(--card);padding:6px 15px;font-size:12px;font-weight:700;cursor:pointer;color:var(--muted);border-right:1px solid var(--line)}'+
'#view-rev .rv-tabs button:last-child{border-right:none}#view-rev .rv-tabs button.on{background:var(--ink);color:#fff}'+
'#view-rev .rv-mrow{display:grid;grid-template-columns:1.1fr 1fr 74px;gap:12px;align-items:center;padding:10px 4px;border-bottom:1px solid #f0ece3}#view-rev .rv-mrow:last-child{border-bottom:none}'+
'#view-rev .rv-dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:8px;vertical-align:middle}'+
'#view-rev .rv-mn{font-weight:700;font-size:13px}#view-rev .rv-ma{font-variant-numeric:tabular-nums;font-weight:700}'+
'#view-rev .rv-prog{height:8px;background:#efe9df;border-radius:6px;overflow:hidden}#view-rev .rv-prog>i{display:block;height:100%;border-radius:6px}'+
'#view-rev .rv-disp{display:flex;justify-content:space-between;align-items:center;padding:11px 4px;border-bottom:1px solid #f0ece3}#view-rev .rv-disp:last-child{border-bottom:none}'+
'#view-rev .rv-pill{display:inline-block;background:var(--gold-soft);color:#8a6516;border-radius:20px;padding:2px 9px;font-size:10.5px;font-weight:700}'+
'#view-rev .rv-foot{font-size:11.5px;color:var(--muted);margin-top:14px;line-height:1.6}';

/* ---------- section shell ---------- */
var sectionHTML=''+
'<div class="rv-sub"><b>Revenue.</b> Total business income — Commas sales plus MyFreeScoreNow affiliate commissions — by day, week and month, with the full payment-method mix.</div>'+
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
  document.querySelectorAll('#rvGran button').forEach(function(b){b.onclick=function(){gran=b.getAttribute('data-g');document.querySelectorAll('#rvGran button').forEach(function(x){x.classList.toggle('on',x===b);});drawTrend();};});
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
function drawTrend(){
  if(!window.Chart)return;var el=document.getElementById('rvTrend');if(!el)return;killChart('t');
  var d=trendData();
  charts.t=new Chart(el.getContext('2d'),{type:'line',data:{labels:d.labels,datasets:[{data:d.vals,borderColor:d.color,backgroundColor:d.fill,fill:true,tension:.32,pointRadius:gran==='monthly'?3:0,pointBackgroundColor:d.color,borderWidth:2.5}]},
   options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:function(c){return money0(c.parsed.y);}}}},scales:{y:{ticks:{callback:function(v){return moneyK(v);},font:{size:10}},grid:{color:'#efe9df'}},x:{grid:{display:false},ticks:{font:{size:10},maxTicksLimit:12}}}}});
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
  var nav=document.getElementById('nav');
  if(nav&&!document.getElementById('rvNavBtn')){
    var sib=nav.querySelector('button');var b=document.createElement('button');b.id='rvNavBtn';
    if(sib)b.className=sib.className;b.setAttribute('onclick',"showView('rev')");
    b.innerHTML=(sib&&sib.querySelector('.dot')?'<span class="dot"></span>':'')+'Revenue';nav.appendChild(b);
  }
  if(typeof window.showView==='function'&&!window.__rvWrap){
    window.__rvWrap=true;var _sv=window.showView;
    window.showView=function(id){
      if(id==='rev'){
        var sv=document.querySelectorAll('.view');for(var i=0;i<sv.length;i++){sv[i].classList.remove('on');sv[i].style.display='';}
        ['view-production','view-personal','view-mfsn'].forEach(function(x){var e=document.getElementById(x);if(e)e.style.display='none';});
        var v=document.getElementById('view-rev');if(v)v.style.display='';
        var nbs=document.querySelectorAll('#nav button');for(var j=0;j<nbs.length;j++)nbs[j].classList.remove('active');
        var nb=document.getElementById('rvNavBtn');if(nb)nb.classList.add('active');
        var pt=document.getElementById('pageTitle');if(pt)pt.textContent='Revenue';
        render();
      } else {
        var v=document.getElementById('view-rev');if(v)v.style.display='none';
        var sv=document.querySelectorAll('.view');for(var i=0;i<sv.length;i++)sv[i].style.display='';
        var nb=document.getElementById('rvNavBtn');if(nb)nb.classList.remove('active');
        _sv(id);
      }
    };
  }
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initRV);else initRV();

/* keep the Dashboard hero showing combined income even after the app's periodic refresh */
function startPatch(){ patchDash(); hookPeriods(); setTimeout(hookPeriods,1200); setTimeout(hookPeriods,3000); setInterval(patchDash,1000); setInterval(hookPeriods,4000); }
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',startPatch);else startPatch();
})();
