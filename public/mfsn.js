/* Credit Monitoring — powered by MyFreeScoreNow (MFSN) affiliate partner portal.
   Sample data until the live pipe is connected. To go live:
   In Zapier, connect the MyFreeScoreNow account and add a Zap:
     Trigger: MyFreeScoreNow (New Enrollment / Login Successful / Enrolled Snapshot Lead)
     Action:  Webhooks by Zapier -> POST to  https://msfs-dashboard.onrender.com/webhooks/mfsn
   The server stores the latest snapshot and exposes GET /api/mfsn, which this view will
   automatically prefer over the sample data below (see loadLive()). No MFSN key ever touches the browser. */
(function(){
var C={blue:'#3563a8',green:'#2e7d54',gold:'#b98a2f',red:'#b3372f',teal:'#2f8f8a',purple:'#6b5bd0',slate:'#6b6256',gray:'#b9b3a8',ink:'#2b2620'};
var PAL=['#3563a8','#2e7d54','#b98a2f','#b3372f','#2f8f8a','#6b5bd0','#c06a2b','#8d8577'];
var charts={}, curSub='overview', memFilter='all', memSearch='', LIVE=false;

/* ---------- sample data (matches MFSN affiliate-portal / Zapier field shapes) ---------- */
/* Fictional sample members for layout only — replaced by live MFSN data once the pipe is connected. */
var MEMBERS=[
 {name:'Jasmine Carter',   email:'jcarter@example.com',   enrolled:'2026-07-22', plan:'Monitoring $24.95', status:'active',    tu:612, eq:598, ex:605, last:'2026-07-27'},
 {name:'Marcus Webb',      email:'mwebb@example.com',     enrolled:'2026-07-20', plan:'Monitoring $24.95', status:'active',    tu:688, eq:701, ex:679, last:'2026-07-26'},
 {name:'Alicia Turner',    email:'aturner@example.com',   enrolled:'2026-07-18', plan:'Monitoring $24.95', status:'active',    tu:534, eq:551, ex:540, last:'2026-07-25'},
 {name:'Devon Price',      email:'dprice@example.com',    enrolled:'2026-07-15', plan:'Monitoring $24.95', status:'trial',     tu:722, eq:715, ex:730, last:'2026-07-27'},
 {name:'Brianna Hughes',   email:'bhughes@example.com',   enrolled:'2026-07-14', plan:'Monitoring $24.95', status:'active',    tu:640, eq:632, ex:648, last:'2026-07-24'},
 {name:'Tyrell Jenkins',   email:'tjenkins@example.com',  enrolled:'2026-07-12', plan:'Monitoring $24.95', status:'active',    tu:571, eq:560, ex:583, last:'2026-07-23'},
 {name:'Simone Bailey',    email:'sbailey@example.com',   enrolled:'2026-07-10', plan:'Monitoring $24.95', status:'canceled',  tu:659, eq:663, ex:651, last:'2026-07-16'},
 {name:'Andre Foster',     email:'afoster@example.com',   enrolled:'2026-07-08', plan:'Monitoring $24.95', status:'active',    tu:705, eq:698, ex:712, last:'2026-07-27'},
 {name:'Kayla Morris',     email:'kmorris@example.com',   enrolled:'2026-07-05', plan:'Monitoring $24.95', status:'active',    tu:618, eq:625, ex:610, last:'2026-07-22'},
 {name:'Elena Vargas',     email:'evargas@example.com',   enrolled:'2026-07-03', plan:'Monitoring $24.95', status:'trial',     tu:749, eq:742, ex:755, last:'2026-07-26'},
 {name:'Chris Coleman',    email:'ccoleman@example.com',  enrolled:'2026-06-29', plan:'Monitoring $24.95', status:'active',    tu:588, eq:576, ex:594, last:'2026-07-21'},
 {name:'Nia Robinson',     email:'nrobinson@example.com', enrolled:'2026-06-25', plan:'Monitoring $24.95', status:'active',    tu:672, eq:681, ex:666, last:'2026-07-25'},
 {name:'Gabriel Ortiz',    email:'gortiz@example.com',    enrolled:'2026-06-22', plan:'Monitoring $24.95', status:'canceled',  tu:601, eq:610, ex:597, last:'2026-07-09'},
 {name:'Destiny Ward',     email:'dward@example.com',     enrolled:'2026-06-18', plan:'Monitoring $24.95', status:'active',    tu:634, eq:640, ex:628, last:'2026-07-24'}
];
/* Portfolio totals — sample scale for the enrolled MFSN book (the full client base is larger; these are the monitoring enrollees). */
var TOTALS={enrolled:428, active:369, trial:41, canceled:18, newThisMonth:63, commissionsMTD:5140, commissionRate:18, avgLoginRate:0.72};
var ENROLL_TREND={ labels:['Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun','Jul'],
  values:[112,138,161,190,214,251,286,318,352,381,404,428] };
var COMM_TREND={ labels:['Feb','Mar','Apr','May','Jun','Jul'], values:[2860,3210,3680,4150,4720,5140] };
/* Score bands across the enrolled book (count of members). */
var BANDS=[
 {label:'Poor (300–579)',   min:300, max:579, n:74,  color:C.red},
 {label:'Fair (580–669)',   min:580, max:669, n:181, color:C.gold},
 {label:'Good (670–739)',   min:670, max:739, n:132, color:C.teal},
 {label:'Very Good (740–799)',min:740,max:799, n:37,  color:C.green},
 {label:'Excellent (800+)', min:800, max:850, n:4,   color:C.blue}
];
/* Recent credit alerts (MFSN "monitoring alert" events). */
var ALERTS=[
 {date:'2026-07-27', member:'Andre Foster',   type:'Score increase', detail:'Experian +18 pts (694 → 712)', sev:'good'},
 {date:'2026-07-27', member:'Jasmine Carter',  type:'New inquiry',     detail:'Hard inquiry — Capital One',   sev:'warn'},
 {date:'2026-07-26', member:'Marcus Webb',     type:'New account',     detail:'New tradeline reported — auto', sev:'info'},
 {date:'2026-07-26', member:'Elena Vargas',    type:'Score increase',  detail:'TransUnion +12 pts (737 → 749)',sev:'good'},
 {date:'2026-07-25', member:'Alicia Turner',   type:'Derogatory',      detail:'Collection reported — medical', sev:'bad'},
 {date:'2026-07-25', member:'Nia Robinson',    type:'Score increase',  detail:'Equifax +9 pts (672 → 681)',    sev:'good'},
 {date:'2026-07-24', member:'Brianna Hughes',  type:'New inquiry',     detail:'Hard inquiry — Synchrony',      sev:'warn'},
 {date:'2026-07-23', member:'Tyrell Jenkins',  type:'Address change',  detail:'New address on file',           sev:'info'}
];

/* ---------- helpers ---------- */
function money0(n){var neg=n<0;return (neg?'-':'')+'$'+Math.abs(Math.round(n)).toLocaleString('en-US');}
function pct(n){return Math.round(n*100)+'%';}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;');}
function dfmt(d){var p=String(d).split('-');return p.length===3?(['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+p[1]-1]+' '+(+p[2])):d;}
function avg(a){if(!a.length)return 0;var s=0;a.forEach(function(x){s+=x;});return Math.round(s/a.length);}
function memAvg(m){return Math.round((m.tu+m.eq+m.ex)/3);}
function scoreColor(s){return s>=740?C.green:s>=670?C.teal:s>=580?C.gold:C.red;}
function bookAvg(){var s=[];MEMBERS.forEach(function(m){s.push(memAvg(m));});return avg(s);}
function bureauAvg(k){var s=[];MEMBERS.forEach(function(m){s.push(m[k]);});return avg(s);}

/* ---------- styles ---------- */
var css=''+
'#view-mfsn{padding:24px 30px 60px}'+
'#view-mfsn .mf-sub{color:var(--muted);font-size:12.5px;margin:2px 0 14px;max-width:1000px;line-height:1.6}'+
'#view-mfsn .mf-badge{display:inline-block;background:var(--gold-soft);color:#8a6516;border-radius:20px;padding:3px 11px;font-size:11px;font-weight:700;margin-left:6px;vertical-align:middle}'+
'#view-mfsn .mf-badge.live{background:var(--green-soft);color:#1f6a45}'+
'#view-mfsn .mf-tabs{display:inline-flex;border:1px solid var(--line);border-radius:9px;overflow:hidden;margin-bottom:16px;flex-wrap:wrap}'+
'#view-mfsn .mf-tabs button{border:none;background:var(--card);padding:8px 18px;font-size:12.5px;font-weight:700;cursor:pointer;color:var(--muted);border-right:1px solid var(--line)}'+
'#view-mfsn .mf-tabs button:last-child{border-right:none}#view-mfsn .mf-tabs button.on{background:var(--ink);color:#fff}'+
'#view-mfsn .mf-kpis{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin-bottom:16px}'+
'#view-mfsn .mf-kpi{background:var(--card);border:1px solid var(--line);border-radius:13px;padding:13px 15px}'+
'#view-mfsn .mf-kpi .l{font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}'+
'#view-mfsn .mf-kpi .v{font-size:22px;font-weight:800;margin-top:6px;letter-spacing:-.5px}'+
'#view-mfsn .mf-kpi .s{font-size:11px;color:var(--muted);margin-top:3px}'+
'#view-mfsn .mf-kpi.good .v{color:var(--green)}#view-mfsn .mf-kpi.bad .v{color:var(--red)}'+
'#view-mfsn .mf-kpi.hero{background:var(--ink)}#view-mfsn .mf-kpi.hero .l{color:#c7c0b4}#view-mfsn .mf-kpi.hero .v{color:#fff}#view-mfsn .mf-kpi.hero .s{color:#a49c8e}'+
'#view-mfsn .mf-grid2{display:grid;grid-template-columns:1.15fr .85fr;gap:16px;margin-bottom:16px}'+
'#view-mfsn .mf-grid11{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}'+
'#view-mfsn .mf-card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px}'+
'#view-mfsn .mf-card h3{margin:0 0 3px;font-size:14px}#view-mfsn .mf-card .cap{color:var(--muted);font-size:12px;margin:0 0 12px}'+
'#view-mfsn .mf-wrap{position:relative;height:250px}#view-mfsn .mf-wrap.sm{height:220px}'+
'#view-mfsn .mf-tablewrap{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:auto}'+
'#view-mfsn table.mf-table{width:100%;border-collapse:collapse;font-size:12.5px}'+
'#view-mfsn .mf-table th{position:sticky;top:0;background:#efe9df;text-align:left;padding:10px 12px;font-size:10.5px;text-transform:uppercase;letter-spacing:.03em;color:var(--muted);border-bottom:1px solid var(--line);white-space:nowrap;z-index:1}'+
'#view-mfsn .mf-table th.r,#view-mfsn .mf-table td.r{text-align:right}'+
'#view-mfsn .mf-table td{padding:9px 12px;border-bottom:1px solid #f0ece3;vertical-align:middle}'+
'#view-mfsn .mf-table tbody tr:hover{background:#faf7f1}'+
'#view-mfsn .mf-pill{display:inline-block;padding:2px 9px;border-radius:20px;font-size:10.5px;font-weight:700;white-space:nowrap}'+
'#view-mfsn .mf-active{background:var(--green-soft);color:#1f6a45}#view-mfsn .mf-trial{background:var(--blue-soft);color:#27508c}#view-mfsn .mf-canceled{background:#efeae0;color:#8d8577}'+
'#view-mfsn .mf-sev{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:7px;vertical-align:middle}'+
'#view-mfsn .mf-score{font-weight:800;font-variant-numeric:tabular-nums}'+
'#view-mfsn .mf-chips{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 12px}'+
'#view-mfsn .mf-chip{cursor:pointer;border:1px solid var(--line);background:var(--card);border-radius:20px;padding:7px 13px;font-size:12.5px;font-weight:600;color:var(--ink)}#view-mfsn .mf-chip.on{background:var(--ink);color:#fff;border-color:var(--ink)}'+
'#view-mfsn .mf-bar{display:flex;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap}#view-mfsn .mf-bar input{flex:1;max-width:320px;padding:9px 13px;border:1px solid var(--line);border-radius:9px;font-size:13px;background:var(--card);color:var(--ink)}'+
'#view-mfsn .mf-brow{display:grid;grid-template-columns:1.5fr 1fr 90px;gap:12px;align-items:center;padding:11px 4px;border-bottom:1px solid #f0ece3}#view-mfsn .mf-brow:last-child{border-bottom:none}'+
'#view-mfsn .mf-brow .bn{font-weight:700;font-size:13px}#view-mfsn .mf-brow .bs{font-size:11px;color:var(--muted);margin-top:2px}'+
'#view-mfsn .mf-prog{height:8px;background:#efe9df;border-radius:6px;overflow:hidden}#view-mfsn .mf-prog>i{display:block;height:100%;border-radius:6px}'+
'#view-mfsn .mf-brem{text-align:right;font-size:12px;font-weight:700;font-variant-numeric:tabular-nums}'+
'#view-mfsn .mf-section-title{font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:#6f6857;margin:4px 0 10px}'+
'#view-mfsn .mf-foot{font-size:11.5px;color:var(--muted);margin-top:14px;line-height:1.6}'+
'#view-mfsn .mf-3{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}'+
'#view-mfsn .mf-bur{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;text-align:center}'+
'#view-mfsn .mf-bur .bl{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}#view-mfsn .mf-bur .bv{font-size:26px;font-weight:800;margin-top:6px}';

/* ---------- section shell ---------- */
var sectionHTML=''+
'<div class="mf-sub"><b>Credit Monitoring.</b> Enrollments, credit scores, monitoring alerts and affiliate commissions from MyFreeScoreNow — the whole book in one place. <span class="mf-badge" id="mfMode">Sample data — connect MyFreeScoreNow in Zapier to go live</span></div>'+
'<div class="mf-tabs">'+
 '<button class="on" data-v="overview">Overview</button>'+
 '<button data-v="members">Members</button>'+
 '<button data-v="scores">Credit Scores</button>'+
 '<button data-v="affiliate">Affiliate</button>'+
 '<button data-v="alerts">Alerts</button>'+
'</div>'+
'<div id="mfBody"></div>';

/* ---------- overview ---------- */
function renderOverview(){
  var html=''+
  '<div class="mf-kpis">'+
   '<div class="mf-kpi hero"><div class="l">Enrolled members</div><div class="v">'+TOTALS.enrolled.toLocaleString()+'</div><div class="s">in MFSN monitoring</div></div>'+
   '<div class="mf-kpi good"><div class="l">Active</div><div class="v">'+TOTALS.active.toLocaleString()+'</div><div class="s">'+pct(TOTALS.active/TOTALS.enrolled)+' of book</div></div>'+
   '<div class="mf-kpi"><div class="l">On trial</div><div class="v">'+TOTALS.trial+'</div><div class="s">7-day trials</div></div>'+
   '<div class="mf-kpi good"><div class="l">New this month</div><div class="v">'+TOTALS.newThisMonth+'</div><div class="s">July enrollments</div></div>'+
   '<div class="mf-kpi"><div class="l">Avg score</div><div class="v">'+bookAvg()+'</div><div class="s">3-bureau average</div></div>'+
   '<div class="mf-kpi good"><div class="l">Commissions MTD</div><div class="v">'+money0(TOTALS.commissionsMTD)+'</div><div class="s">affiliate payouts</div></div>'+
  '</div>'+
  '<div class="mf-grid2">'+
   '<div class="mf-card"><h3>Enrollment growth</h3><div class="cap">Cumulative enrolled members, last 12 months.</div><div class="mf-wrap"><canvas id="mfEnrollChart"></canvas></div></div>'+
   '<div class="mf-card"><h3>Score distribution</h3><div class="cap">Enrolled members by score band.</div><div class="mf-wrap"><canvas id="mfBandChart"></canvas></div></div>'+
  '</div>'+
  '<div class="mf-grid11">'+
   '<div class="mf-card"><h3>Affiliate commissions</h3><div class="cap">Last 6 months.</div><div class="mf-wrap sm"><canvas id="mfCommChart"></canvas></div></div>'+
   '<div class="mf-card"><h3>Recent alerts</h3><div class="cap">Latest monitoring events.</div>'+alertsMini()+'</div>'+
  '</div>'+
  '<div class="mf-foot">Figures shown are sample data for layout. Once the MyFreeScoreNow Zap posts to <b>/webhooks/mfsn</b>, this view pulls live enrollments, scores, alerts and commissions automatically.</div>';
  document.getElementById('mfBody').innerHTML=html;
  drawEnrollChart(); drawBandChart(); drawCommChart();
}
function alertsMini(){
  return ALERTS.slice(0,5).map(function(a){
    var col=a.sev==='good'?C.green:a.sev==='bad'?C.red:a.sev==='warn'?C.gold:C.blue;
    return '<div class="mf-brow" style="grid-template-columns:1fr auto"><div><div class="bn"><span class="mf-sev" style="background:'+col+'"></span>'+esc(a.member)+'</div><div class="bs">'+esc(a.type)+' · '+esc(a.detail)+'</div></div>'+
      '<div class="bs" style="white-space:nowrap">'+dfmt(a.date)+'</div></div>';
  }).join('');
}

/* ---------- members ---------- */
function memRows(){
  return MEMBERS.filter(function(m){
    if(memFilter!=='all'&&m.status!==memFilter)return false;
    if(memSearch){var s=(m.name+' '+m.email).toLowerCase();if(s.indexOf(memSearch)<0)return false;}
    return true;
  });
}
function renderMembers(){
  var chips=[['all','All'],['active','Active'],['trial','Trial'],['canceled','Canceled']];
  var rows=memRows();
  var html=''+
  '<div class="mf-chips" id="mfMemChips">'+chips.map(function(c){return '<span class="mf-chip'+(memFilter===c[0]?' on':'')+'" data-f="'+c[0]+'">'+c[1]+'</span>';}).join('')+'</div>'+
  '<div class="mf-bar"><input id="mfMemSearch" placeholder="Search member name or email…" value="'+esc(memSearch)+'"><span class="cap" style="color:var(--muted);font-size:12px">'+rows.length+' members</span></div>'+
  '<div class="mf-tablewrap"><table class="mf-table"><thead><tr>'+
   '<th>Member</th><th>Enrolled</th><th>Status</th><th class="r">TU</th><th class="r">EQ</th><th class="r">EX</th><th class="r">Avg</th><th>Last login</th>'+
   '</tr></thead><tbody>'+
   rows.map(function(m){
     var a=memAvg(m);
     return '<tr><td style="font-weight:700">'+esc(m.name)+'<div style="font-size:10.5px;color:var(--muted);font-weight:400">'+esc(m.email)+'</div></td>'+
       '<td style="white-space:nowrap;color:var(--muted)">'+dfmt(m.enrolled)+'</td>'+
       '<td><span class="mf-pill mf-'+m.status+'">'+m.status+'</span></td>'+
       '<td class="r mf-score" style="color:'+scoreColor(m.tu)+'">'+m.tu+'</td>'+
       '<td class="r mf-score" style="color:'+scoreColor(m.eq)+'">'+m.eq+'</td>'+
       '<td class="r mf-score" style="color:'+scoreColor(m.ex)+'">'+m.ex+'</td>'+
       '<td class="r mf-score" style="color:'+scoreColor(a)+'">'+a+'</td>'+
       '<td style="white-space:nowrap;color:var(--muted)">'+dfmt(m.last)+'</td></tr>';
   }).join('')+
   '</tbody></table></div>'+
   '<div class="mf-foot">Sample members shown for layout. Live view lists every enrolled MyFreeScoreNow member matched to your client book.</div>';
  document.getElementById('mfBody').innerHTML=html;
  document.getElementById('mfMemSearch').oninput=function(e){memSearch=e.target.value.toLowerCase();var v=e.target.value;renderMembers();var s=document.getElementById('mfMemSearch');s.focus();s.value=v;s.setSelectionRange(v.length,v.length);};
  document.querySelectorAll('#mfMemChips .mf-chip').forEach(function(el){el.onclick=function(){memFilter=el.getAttribute('data-f');renderMembers();};});
}

/* ---------- scores ---------- */
function renderScores(){
  var total=0;BANDS.forEach(function(b){total+=b.n;});
  var html=''+
  '<div class="mf-3" style="margin-bottom:16px">'+
   '<div class="mf-bur"><div class="bl">TransUnion avg</div><div class="bv" style="color:'+scoreColor(bureauAvg('tu'))+'">'+bureauAvg('tu')+'</div></div>'+
   '<div class="mf-bur"><div class="bl">Equifax avg</div><div class="bv" style="color:'+scoreColor(bureauAvg('eq'))+'">'+bureauAvg('eq')+'</div></div>'+
   '<div class="mf-bur"><div class="bl">Experian avg</div><div class="bv" style="color:'+scoreColor(bureauAvg('ex'))+'">'+bureauAvg('ex')+'</div></div>'+
  '</div>'+
  '<div class="mf-grid2">'+
   '<div class="mf-card"><h3>Score bands</h3><div class="cap">Enrolled members by FICO range.</div>'+
    BANDS.map(function(b){
      var p=Math.round(b.n/total*100);
      return '<div class="mf-brow"><div><div class="bn">'+esc(b.label)+'</div><div class="bs">'+b.n+' members</div></div>'+
       '<div class="mf-prog"><i style="width:'+p+'%;background:'+b.color+'"></i></div>'+
       '<div class="mf-brem">'+p+'%</div></div>';
    }).join('')+'</div>'+
   '<div class="mf-card"><h3>Distribution</h3><div class="cap">Share of book by band.</div><div class="mf-wrap"><canvas id="mfScoreChart"></canvas></div></div>'+
  '</div>'+
  '<div class="mf-foot">Scores refresh with each MyFreeScoreNow monitoring pull. Live view tracks month-over-month score movement per member and bureau.</div>';
  document.getElementById('mfBody').innerHTML=html;
  drawScoreChart();
}

/* ---------- affiliate ---------- */
function renderAffiliate(){
  var conv=TOTALS.newThisMonth, perConv=Math.round(TOTALS.commissionsMTD/Math.max(1,conv));
  var html=''+
  '<div class="mf-kpis" style="grid-template-columns:repeat(4,1fr)">'+
   '<div class="mf-kpi good"><div class="l">Commissions MTD</div><div class="v">'+money0(TOTALS.commissionsMTD)+'</div><div class="s">July payouts</div></div>'+
   '<div class="mf-kpi"><div class="l">Conversions</div><div class="v">'+conv+'</div><div class="s">new enrollments</div></div>'+
   '<div class="mf-kpi"><div class="l">Avg per conversion</div><div class="v">'+money0(perConv)+'</div><div class="s">this month</div></div>'+
   '<div class="mf-kpi"><div class="l">Active rate</div><div class="v">'+pct(TOTALS.avgLoginRate)+'</div><div class="s">30-day logins</div></div>'+
  '</div>'+
  '<div class="mf-card"><h3>Commission trend</h3><div class="cap">Monthly affiliate commissions, last 6 months.</div><div class="mf-wrap"><canvas id="mfComm2Chart"></canvas></div></div>'+
  '<div class="mf-foot">Sample commissions shown. Live view reconciles MyFreeScoreNow affiliate payouts against enrollments and retention.</div>';
  document.getElementById('mfBody').innerHTML=html;
  drawComm2Chart();
}

/* ---------- alerts ---------- */
function renderAlerts(){
  var html=''+
  '<div class="mf-tablewrap"><table class="mf-table"><thead><tr>'+
   '<th>Date</th><th>Member</th><th>Alert</th><th>Detail</th>'+
   '</tr></thead><tbody>'+
   ALERTS.map(function(a){
     var col=a.sev==='good'?C.green:a.sev==='bad'?C.red:a.sev==='warn'?C.gold:C.blue;
     return '<tr><td style="white-space:nowrap;color:var(--muted)">'+dfmt(a.date)+'</td>'+
       '<td style="font-weight:700">'+esc(a.member)+'</td>'+
       '<td><span class="mf-sev" style="background:'+col+'"></span>'+esc(a.type)+'</td>'+
       '<td>'+esc(a.detail)+'</td></tr>';
   }).join('')+
   '</tbody></table></div>'+
   '<div class="mf-foot">Monitoring alerts fire from MyFreeScoreNow when a member’s report changes — new inquiries, tradelines, derogatory marks or score swings. Live view streams these in real time.</div>';
  document.getElementById('mfBody').innerHTML=html;
}

/* ---------- charts ---------- */
function killChart(k){if(charts[k]){charts[k].destroy();charts[k]=null;}}
function drawEnrollChart(){
  if(!window.Chart)return;var el=document.getElementById('mfEnrollChart');if(!el)return;killChart('en');
  charts.en=new Chart(el.getContext('2d'),{type:'line',data:{labels:ENROLL_TREND.labels,datasets:[{data:ENROLL_TREND.values,borderColor:C.blue,backgroundColor:'rgba(53,99,168,.10)',fill:true,tension:.35,pointRadius:0,borderWidth:2.5}]},
   options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:function(c){return c.parsed.y+' enrolled';}}}},scales:{y:{ticks:{font:{size:10}},grid:{color:'#efe9df'}},x:{grid:{display:false},ticks:{font:{size:10}}}}}});
}
function drawBandChart(){
  if(!window.Chart)return;var el=document.getElementById('mfBandChart');if(!el)return;killChart('bd');
  charts.bd=new Chart(el.getContext('2d'),{type:'doughnut',data:{labels:BANDS.map(function(b){return b.label;}),datasets:[{data:BANDS.map(function(b){return b.n;}),backgroundColor:BANDS.map(function(b){return b.color;}),borderWidth:2,borderColor:'#fff'}]},
   options:{responsive:true,maintainAspectRatio:false,cutout:'58%',plugins:{legend:{position:'right',labels:{boxWidth:10,font:{size:10},padding:7}},tooltip:{callbacks:{label:function(c){return c.label+': '+c.parsed;}}}}}});
}
function drawCommChart(){
  if(!window.Chart)return;var el=document.getElementById('mfCommChart');if(!el)return;killChart('cm');
  charts.cm=new Chart(el.getContext('2d'),{type:'bar',data:{labels:COMM_TREND.labels,datasets:[{label:'Commissions',data:COMM_TREND.values,backgroundColor:C.green,borderRadius:4}]},
   options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:function(c){return money0(c.parsed.y);}}}},scales:{y:{ticks:{callback:function(v){return '$'+(v/1000)+'k';},font:{size:10}},grid:{color:'#efe9df'}},x:{grid:{display:false},ticks:{font:{size:10}}}}}});
}
function drawComm2Chart(){
  if(!window.Chart)return;var el=document.getElementById('mfComm2Chart');if(!el)return;killChart('cm2');
  charts.cm2=new Chart(el.getContext('2d'),{type:'bar',data:{labels:COMM_TREND.labels,datasets:[{label:'Commissions',data:COMM_TREND.values,backgroundColor:C.green,borderRadius:4}]},
   options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:function(c){return money0(c.parsed.y);}}}},scales:{y:{ticks:{callback:function(v){return '$'+(v/1000)+'k';},font:{size:10}},grid:{color:'#efe9df'}},x:{grid:{display:false},ticks:{font:{size:10}}}}}});
}
function drawScoreChart(){
  if(!window.Chart)return;var el=document.getElementById('mfScoreChart');if(!el)return;killChart('sc');
  charts.sc=new Chart(el.getContext('2d'),{type:'bar',data:{labels:BANDS.map(function(b){return b.label.split(' ')[0];}),datasets:[{data:BANDS.map(function(b){return b.n;}),backgroundColor:BANDS.map(function(b){return b.color;}),borderRadius:4}]},
   options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:function(c){return c.parsed.y+' members';}}}},scales:{y:{ticks:{font:{size:10}},grid:{color:'#efe9df'}},x:{grid:{display:false},ticks:{font:{size:10}}}}}});
}

/* ---------- view switching ---------- */
function renderSub(){
  if(curSub==='overview')renderOverview();
  else if(curSub==='members')renderMembers();
  else if(curSub==='scores')renderScores();
  else if(curSub==='affiliate')renderAffiliate();
  else if(curSub==='alerts')renderAlerts();
}
function setSub(v){
  curSub=v;
  var btns=document.querySelectorAll('#view-mfsn .mf-tabs button');
  for(var i=0;i<btns.length;i++)btns[i].classList.toggle('on',btns[i].getAttribute('data-v')===v);
  renderSub();
}

/* ---------- live data (prefers server /api/mfsn if present) ---------- */
function applyLive(d){
  try{
    if(d.totals)TOTALS=Object.assign({},TOTALS,d.totals);
    if(Array.isArray(d.members)&&d.members.length)MEMBERS=d.members;
    if(Array.isArray(d.alerts)&&d.alerts.length)ALERTS=d.alerts;
    if(d.enrollTrend&&d.enrollTrend.values)ENROLL_TREND=d.enrollTrend;
    if(d.commTrend&&d.commTrend.values)COMM_TREND=d.commTrend;
    if(Array.isArray(d.bands)&&d.bands.length)BANDS=d.bands;
    LIVE=true;
    var badge=document.getElementById('mfMode');
    if(badge){badge.textContent='Live — MyFreeScoreNow connected';badge.className='mf-badge live';}
  }catch(e){}
}
function loadLive(){
  try{
    fetch('/api/mfsn',{headers:{'Accept':'application/json'}}).then(function(r){return r.ok?r.json():null;}).then(function(d){
      if(d&&(d.members||d.totals)){applyLive(d);renderSub();}
    }).catch(function(){});
  }catch(e){}
}

/* ---------- init (mirrors production.js / personal-finances.js integration) ---------- */
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
        var pd=document.getElementById('view-production');if(pd)pd.style.display='none';
        var pf=document.getElementById('view-personal');if(pf)pf.style.display='none';
        var v=document.getElementById('view-mfsn');if(v)v.style.display='';
        var nbs=document.querySelectorAll('#nav button');for(var j=0;j<nbs.length;j++)nbs[j].classList.remove('active');
        var nb=document.getElementById('mfNavBtn');if(nb)nb.classList.add('active');
        var pt=document.getElementById('pageTitle');if(pt)pt.textContent='Credit Monitoring';
        renderSub();
      } else {
        var v=document.getElementById('view-mfsn');if(v)v.style.display='none';
        var sv=document.querySelectorAll('.view');for(var i=0;i<sv.length;i++)sv[i].style.display='';
        var nb=document.getElementById('mfNavBtn');if(nb)nb.classList.remove('active');
        _sv(id);
      }
    };
  }
  loadLive();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initMF);else initMF();
})();
