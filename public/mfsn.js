/* Credit Monitoring — MyFreeScoreNow affiliate book. Figures from the affiliate portal (Jul 28 2026). */
(function(){
var C={ink:'#211d18',blue:'#3563a8',green:'#0e9e56',gold:'#b98a2f',red:'#b3372f',teal:'#2f8f8a',purple:'#6b5bd0',orange:'#c06a2b',pink:'#c14d8a'};
var PAL=['#3563a8','#2e7d54','#b98a2f','#b3372f','#2f8f8a','#6b5bd0','#c06a2b','#c14d8a','#6f8f2f','#5a6b7d'];
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
'#view-mfsn .mf-kpi.hero{background:var(--ink);border-top-color:#2e7d54}#view-mfsn .mf-kpi.hero .l{color:#c7c0b4}#view-mfsn .mf-kpi.hero .v{color:#fff}#view-mfsn .mf-kpi.hero .s{color:#a49c8e}'+
'#view-mfsn .mf-grid2{display:grid;grid-template-columns:1.25fr .75fr;gap:16px;margin-bottom:16px}'+
'#view-mfsn .mf-card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px}'+
'#view-mfsn .mf-card h3{margin:0 0 3px;font-size:14px}#view-mfsn .mf-card .cap{color:var(--muted);font-size:12px;margin:0 0 12px}'+
'#view-mfsn .mf-wrap{position:relative;height:260px}'+
'#view-mfsn .mf-tablewrap{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:auto}'+
'#view-mfsn table.mf-table{width:100%;border-collapse:collapse;font-size:12.5px}'+
'#view-mfsn .mf-table th{position:sticky;top:0;background:#efe9df;text-align:left;padding:10px 12px;font-size:10.5px;text-transform:uppercase;letter-spacing:.03em;color:var(--muted);border-bottom:1px solid var(--line);white-space:nowrap}'+
'#view-mfsn .mf-table th.r,#view-mfsn .mf-table td.r{text-align:right}'+
'#view-mfsn .mf-table td{padding:9px 12px;border-bottom:1px solid #f0ece3;vertical-align:middle;font-variant-numeric:tabular-nums}'+
'#view-mfsn .mf-table tbody tr:hover{background:#faf7f1}#view-mfsn .mf-table tfoot td{font-weight:800;border-top:2px solid var(--line);background:#faf7f1}'+
'#view-mfsn .mf-brow{display:grid;grid-template-columns:1.3fr 1fr 74px;gap:12px;align-items:center;padding:11px 4px;border-bottom:1px solid #f0ece3}#view-mfsn .mf-brow:last-child{border-bottom:none}'+
'#view-mfsn .mf-dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:8px;vertical-align:middle}'+
'#view-mfsn .mf-bn{font-weight:700;font-size:13px}#view-mfsn .mf-ba{text-align:right;font-weight:800;font-variant-numeric:tabular-nums}'+
'#view-mfsn .mf-prog{height:9px;background:#efe9df;border-radius:6px;overflow:hidden}#view-mfsn .mf-prog>i{display:block;height:100%;border-radius:6px}'+
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
   options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:function(c){return money0(c.parsed.y);}}}},scales:{y:{ticks:{callback:function(v){return moneyK(v);},font:{size:10}},grid:{color:'#efe9df'}},x:{grid:{display:false},ticks:{font:{size:10}}}}}});
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

/* ---------- init ---------- */
function initMF(){
  if(document.getElementById('view-mfsn'))return;
  var style=document.createElement('style');style.textContent=css;document.head.appendChild(style);
  var anc=document.getElementById('view-dash');
  var sec=document.createElement('section');sec.id='view-mfsn';sec.style.display='none';sec.innerHTML=sectionHTML;
  if(anc&&anc.parentNode)anc.parentNode.insertBefore(sec,anc); else document.body.appendChild(sec);
  sec.querySelectorAll('.mf-tabs button').forEach(function(b){b.onclick=function(){setSub(b.getAttribute('data-v'));};});
  var nav=document.getElementById('nav');
  if(nav&&!document.getElementById('mfNavBtn')){
    var sib=nav.querySelector('button');var b=document.createElement('button');b.id='mfNavBtn';
    if(sib)b.className=sib.className;b.setAttribute('onclick',"showView('mfsn')");
    b.innerHTML=(sib&&sib.querySelector('.dot')?'<span class="dot"></span>':'')+'Credit Monitoring';nav.appendChild(b);
  }
  if(typeof window.showView==='function'&&!window.__mfWrap){
    window.__mfWrap=true;var _sv=window.showView;
    window.showView=function(id){
      if(id==='mfsn'){
        var sv=document.querySelectorAll('.view');for(var i=0;i<sv.length;i++){sv[i].classList.remove('on');sv[i].style.display='';}
        ['view-production','view-personal','view-rev'].forEach(function(x){var e=document.getElementById(x);if(e)e.style.display='none';});
        var v=document.getElementById('view-mfsn');if(v)v.style.display='';
        var nbs=document.querySelectorAll('#nav button');for(var j=0;j<nbs.length;j++)nbs[j].classList.remove('on');
        var nb=document.getElementById('mfNavBtn');if(nb)nb.classList.add('on');
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
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initMF);else initMF();
})();
