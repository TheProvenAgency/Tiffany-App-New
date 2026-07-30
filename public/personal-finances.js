/* Personal Finances — powered by Lunch Money (lunchmoney.dev v1 shapes). Sample data until API key is connected.
   To go live: replace LM.fetchAll() with server-proxied calls to /api/lunchmoney/* (keep the API key server-side, never in the browser).
   Endpoints that map to this view: GET /v1/assets + /v1/plaid_accounts (Accounts), /v1/transactions (Transactions),
   /v1/budgets (Budget), /v1/recurring_items (Recurring), /v1/me (currency). */
(function(){
var C={blue:'#3b82f6',green:'#0e9e56',gold:'#f59e0b',red:'#e11d48',teal:'#06b6d4',purple:'#8b5cf6',slate:'#6b6256',gray:'#c9c3e0'};
var PAL=['#3563a8','#2e7d54','#b98a2f','#b3372f','#2f8f8a','#6b5bd0','#c06a2b','#8d8577','#4a7db5','#5a9e6f'];
var charts={}, curSub='overview', txFilter='all', txSearch='';

/* ---------- sample data (matches Lunch Money v1 response shapes) ---------- */
var ACCOUNTS=[
 // source: 'plaid' = auto-synced, 'manual' = manually-managed asset. balance is positive; sign derived from type.
 {id:1, source:'plaid',  type:'checking',   name:'Total Checking',        institution:'Chase',            mask:'4021', balance:8432.19,  as_of:'2026-07-21', status:'active'},
 {id:2, source:'plaid',  type:'savings',    name:'Online Savings',        institution:'Ally Bank',        mask:'8890', balance:32540.00, as_of:'2026-07-21', status:'active'},
 {id:3, source:'manual', type:'cash',       name:'Cash Wallet',           institution:null,               mask:null,   balance:600.00,   as_of:'2026-07-19', status:'active'},
 {id:4, source:'plaid',  type:'credit',     name:'Sapphire Reserve',      institution:'Chase',            mask:'6299', balance:2145.66,  as_of:'2026-07-21', status:'active'},
 {id:5, source:'plaid',  type:'credit',     name:'Amex Gold',             institution:'American Express', mask:'1005', balance:1203.42,  as_of:'2026-07-21', status:'active'},
 {id:6, source:'plaid',  type:'credit',     name:'Apple Card',            institution:'Goldman Sachs',    mask:'3317', balance:412.10,   as_of:'2026-07-20', status:'active'},
 {id:7, source:'plaid',  type:'investment', name:'Brokerage',             institution:'Fidelity',         mask:'7742', balance:84210.55, as_of:'2026-07-21', status:'active'},
 {id:8, source:'manual', type:'retirement', name:'401(k)',                institution:'Vanguard',         mask:null,   balance:96300.00, as_of:'2026-07-18', status:'active'},
 {id:9, source:'manual', type:'retirement', name:'Roth IRA',              institution:'Vanguard',         mask:null,   balance:28940.12, as_of:'2026-07-18', status:'active'},
 {id:10,source:'manual', type:'real estate',name:'Primary Residence',     institution:null,               mask:null,   balance:420000.00,as_of:'2026-07-01', status:'active'},
 {id:11,source:'manual', type:'vehicle',    name:'2022 Tesla Model 3',    institution:null,               mask:null,   balance:31500.00, as_of:'2026-07-01', status:'active'},
 {id:12,source:'manual', type:'cryptocurrency',name:'Coinbase',           institution:'Coinbase',         mask:null,   balance:6820.44,  as_of:'2026-07-21', status:'active'},
 {id:13,source:'manual', type:'loan',       name:'Home Mortgage',         institution:'Rocket Mortgage',  mask:null,   balance:318500.00,as_of:'2026-07-15', status:'active'},
 {id:14,source:'manual', type:'loan',       name:'Auto Loan',             institution:'Tesla Finance',    mask:null,   balance:14220.00, as_of:'2026-07-15', status:'active'}
];
var TX=[
 {date:'2026-07-21', payee:'Payroll — MSFS',      cat:'Paycheck',        grp:'Income',            acct:'Total Checking',  amount:7100.00,  status:'cleared',   tags:['Income']},
 {date:'2026-07-20', payee:'Whole Foods Market',  cat:'Groceries',       grp:'Food & Drink',      acct:'Amex Gold',       amount:-142.87,  status:'cleared',   tags:['Groceries']},
 {date:'2026-07-19', payee:'Shell',               cat:'Gas',             grp:'Transportation',    acct:'Sapphire Reserve',amount:-58.40,   status:'cleared',   tags:[]},
 {date:'2026-07-19', payee:'Netflix',             cat:'Streaming',       grp:'Entertainment',     acct:'Apple Card',      amount:-15.49,   status:'cleared',   tags:['Subscription']},
 {date:'2026-07-18', payee:'Amazon',              cat:'Shopping',        grp:'Shopping',          acct:'Amex Gold',       amount:-86.24,   status:'cleared',   tags:[]},
 {date:'2026-07-18', payee:'Starbucks',           cat:'Coffee Shops',    grp:'Food & Drink',      acct:'Apple Card',      amount:-6.75,    status:'cleared',   tags:[]},
 {date:'2026-07-17', payee:'Costco',              cat:'Groceries',       grp:'Food & Drink',      acct:'Sapphire Reserve',amount:-214.55,  status:'cleared',   tags:['Groceries']},
 {date:'2026-07-17', payee:'Comcast Xfinity',     cat:'Internet',        grp:'Bills & Utilities', acct:'Total Checking',  amount:-89.00,   status:'cleared',   tags:['Recurring']},
 {date:'2026-07-16', payee:'Delta Air Lines',     cat:'Airfare',         grp:'Travel',            acct:'Sapphire Reserve',amount:-412.30,  status:'uncleared', tags:['Travel']},
 {date:'2026-07-16', payee:'Uber',                cat:'Rideshare',       grp:'Transportation',    acct:'Apple Card',      amount:-23.80,   status:'cleared',   tags:[]},
 {date:'2026-07-15', payee:'Home Mortgage',       cat:'Mortgage',        grp:'Housing',           acct:'Total Checking',  amount:-2400.00, status:'cleared',   tags:['Recurring']},
 {date:'2026-07-15', payee:'Target',              cat:'Household',       grp:'Shopping',          acct:'Amex Gold',       amount:-134.19,  status:'cleared',   tags:[]},
 {date:'2026-07-14', payee:'Spotify',             cat:'Streaming',       grp:'Entertainment',     acct:'Apple Card',      amount:-10.99,   status:'cleared',   tags:['Subscription']},
 {date:'2026-07-14', payee:'Chipotle',            cat:'Restaurants',     grp:'Food & Drink',      acct:'Apple Card',      amount:-14.60,   status:'cleared',   tags:[]},
 {date:'2026-07-13', payee:'AT&T',                cat:'Phone',           grp:'Bills & Utilities', acct:'Total Checking',  amount:-75.00,   status:'cleared',   tags:['Recurring']},
 {date:'2026-07-12', payee:'Adobe',               cat:'Software',        grp:'Business',          acct:'Sapphire Reserve',amount:-54.99,   status:'cleared',   tags:['Business']},
 {date:'2026-07-12', payee:'Transfer to Savings', cat:'Transfer',        grp:'Transfers',         acct:'Online Savings',  amount:1500.00,  status:'cleared',   tags:[], xfer:true},
 {date:'2026-07-11', payee:'Whole Foods Market',  cat:'Groceries',       grp:'Food & Drink',      acct:'Amex Gold',       amount:-78.42,   status:'cleared',   tags:['Groceries']},
 {date:'2026-07-10', payee:'Apple',               cat:'Electronics',     grp:'Shopping',          acct:'Apple Card',      amount:-129.00,  status:'pending',   tags:[]},
 {date:'2026-07-09', payee:'Geico',               cat:'Insurance',       grp:'Bills & Utilities', acct:'Total Checking',  amount:-145.00,  status:'cleared',   tags:['Recurring']},
 {date:'2026-07-08', payee:"Trader Joe's",        cat:'Groceries',       grp:'Food & Drink',      acct:'Amex Gold',       amount:-63.28,   status:'cleared',   tags:['Groceries']},
 {date:'2026-07-08', payee:'LA Fitness',          cat:'Gym',             grp:'Health',            acct:'Apple Card',      amount:-45.00,   status:'cleared',   tags:['Recurring']},
 {date:'2026-07-07', payee:'Airbnb',              cat:'Lodging',         grp:'Travel',            acct:'Sapphire Reserve',amount:-320.00,  status:'cleared',   tags:['Travel']},
 {date:'2026-07-06', payee:'Payroll — MSFS',      cat:'Paycheck',        grp:'Income',            acct:'Total Checking',  amount:7100.00,  status:'cleared',   tags:['Income']},
 {date:'2026-07-05', payee:'Doordash',            cat:'Restaurants',     grp:'Food & Drink',      acct:'Apple Card',      amount:-38.75,   status:'cleared',   tags:[]},
 {date:'2026-07-04', payee:'Amazon',              cat:'Shopping',        grp:'Shopping',          acct:'Amex Gold',       amount:-54.90,   status:'cleared',   tags:[]},
 {date:'2026-07-03', payee:'iCloud+',             cat:'Software',        grp:'Bills & Utilities', acct:'Apple Card',      amount:-2.99,    status:'cleared',   tags:['Subscription']},
 {date:'2026-07-02', payee:'Home Depot',          cat:'Home Improvement',grp:'Shopping',          acct:'Sapphire Reserve',amount:-176.34,  status:'cleared',   tags:[]},
 {date:'2026-07-02', payee:'Interest — Ally',     cat:'Interest',        grp:'Income',            acct:'Online Savings',  amount:48.21,    status:'cleared',   tags:['Income']},
 {date:'2026-07-01', payee:'Office Rent',         cat:'Business Rent',   grp:'Business',          acct:'Total Checking',  amount:-1100.00, status:'cleared',   tags:['Business']}
];
var BUDGET=[ // this month; matches /v1/budgets shape (category, group, budgeted, spent, num_transactions)
 {cat:'Housing',           grp:null, budget:2400, spent:2400.00, n:1},
 {cat:'Bills & Utilities', grp:null, budget:1250, spent:1320.00, n:5},
 {cat:'Food & Drink',      grp:null, budget:1000, spent:980.00,  n:12},
 {cat:'Groceries',         grp:'Food & Drink', budget:600, spent:545.00, n:6},
 {cat:'Restaurants',       grp:'Food & Drink', budget:400, spent:435.00, n:6},
 {cat:'Shopping',          grp:null, budget:500,  spent:640.00,  n:5},
 {cat:'Transportation',    grp:null, budget:450,  spent:410.00,  n:5},
 {cat:'Travel',            grp:null, budget:400,  spent:520.00,  n:2},
 {cat:'Business',          grp:null, budget:1200, spent:1100.00, n:2},
 {cat:'Entertainment',     grp:null, budget:300,  spent:260.00,  n:3},
 {cat:'Health',            grp:null, budget:250,  spent:180.00,  n:2},
 {cat:'Personal',          grp:null, budget:300,  spent:290.00,  n:4}
];
var RECURRING=[ // /v1/recurring_items shape (payee, cadence, amount, next billing date, account, income?)
 {payee:'Payroll — MSFS',        desc:'Salary deposit',     cadence:'twice a month', amount:7100.00, next:'2026-08-06', acct:'Total Checking', income:true},
 {payee:'Home Mortgage',         desc:'Rocket Mortgage',    cadence:'monthly', amount:2400.00, next:'2026-08-15', acct:'Total Checking', income:false},
 {payee:'Office Rent',           desc:'Business rent',      cadence:'monthly', amount:1100.00, next:'2026-08-01', acct:'Total Checking', income:false},
 {payee:'Geico',                 desc:'Auto insurance',     cadence:'monthly', amount:145.00,  next:'2026-08-09', acct:'Total Checking', income:false},
 {payee:'Comcast Xfinity',       desc:'Internet',           cadence:'monthly', amount:89.00,   next:'2026-08-17', acct:'Total Checking', income:false},
 {payee:'AT&T Wireless',         desc:'Phone plan',         cadence:'monthly', amount:75.00,   next:'2026-08-13', acct:'Total Checking', income:false},
 {payee:'Adobe Creative Cloud',  desc:'Software',           cadence:'monthly', amount:54.99,   next:'2026-08-12', acct:'Sapphire Reserve', income:false},
 {payee:'LA Fitness',            desc:'Gym membership',     cadence:'monthly', amount:45.00,   next:'2026-08-08', acct:'Apple Card', income:false},
 {payee:'Netflix',               desc:'Streaming',          cadence:'monthly', amount:15.49,   next:'2026-08-19', acct:'Apple Card', income:false},
 {payee:'Spotify',               desc:'Streaming',          cadence:'monthly', amount:10.99,   next:'2026-08-14', acct:'Apple Card', income:false},
 {payee:'iCloud+',               desc:'Cloud storage',      cadence:'monthly', amount:2.99,    next:'2026-08-03', acct:'Apple Card', income:false},
 {payee:'Amazon Prime',          desc:'Annual membership',  cadence:'yearly',  amount:139.00,  next:'2027-03-04', acct:'Amex Gold', income:false}
];
var NW_TREND={ labels:['Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun','Jul'],
  values:[341000,345500,349000,351200,354800,358100,361000,363500,366200,368900,370800,0] };
var IE_TREND={ labels:['Feb','Mar','Apr','May','Jun','Jul'],
  income:[16000,18500,20000,22000,23275,47900], expenses:[9100,8700,9600,8200,8900,8100] };
// Month-to-date totals (consistent with BUDGET spent). Recent TX above is a sample of activity; these are the full-month rollups.
// income = current Fanbasis collected (last 30 days). When live, pull this from the Fanbasis feed instead of hardcoding.
var MONTH={ income:47900, spendByGroup:{'Housing':2400,'Bills & Utilities':1320,'Food & Drink':980,'Shopping':640,'Business':1100,'Travel':520,'Transportation':410,'Entertainment':260,'Personal':290,'Health':180} };

/* ---------- helpers ---------- */
function isLiab(t){return t==='credit'||t==='loan'||t==='other liability';}
var GROUPS=[
 {key:'Cash & Banking', types:['cash','checking','savings','depository']},
 {key:'Credit Cards',   types:['credit']},
 {key:'Investments',    types:['investment','brokerage','retirement']},
 {key:'Real Estate',    types:['real estate']},
 {key:'Vehicles',       types:['vehicle']},
 {key:'Crypto',         types:['cryptocurrency']},
 {key:'Loans',          types:['loan']}
];
function assetsTotal(){var s=0;ACCOUNTS.forEach(function(a){if(!isLiab(a.type))s+=a.balance;});return s;}
function liabTotal(){var s=0;ACCOUNTS.forEach(function(a){if(isLiab(a.type))s+=a.balance;});return s;}
function netWorth(){return assetsTotal()-liabTotal();}
// Live Fanbasis collected figure from the dashboard hero (#heroAmt). Always reflects "whatever the current Fanbasis is at".
function fanbasisIncome(){try{var el=document.getElementById('heroAmt');if(el){var n=parseInt((el.textContent||'').replace(/[^0-9]/g,''),10);if(n>0)return n;}}catch(e){}return MONTH.income;}
function moThisIncome(){return fanbasisIncome();}
function moThisExpense(){var s=0;for(var k in MONTH.spendByGroup)s+=MONTH.spendByGroup[k];return s;}
function money(n){var neg=n<0;return (neg?'-':'')+'$'+Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
function money0(n){var neg=n<0;return (neg?'-':'')+'$'+Math.abs(Math.round(n)).toLocaleString('en-US');}
function moneyK(n){return '$'+(Math.round(n/100)/10)+'k';}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;');}
function dfmt(d){var p=String(d).split('-');return p.length===3?(['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+p[1]-1]+' '+(+p[2])):d;}
function acctType(a){return a.source==='plaid'?'Synced':'Manual';}

/* ---------- styles ---------- */
var css=''+
'#view-personal .lm-sub{color:var(--muted);font-size:12.5px;margin:2px 0 14px;max-width:1000px;line-height:1.6}'+
'#view-personal .lm-badge{display:inline-block;background:var(--gold-soft);color:#8a6516;border-radius:20px;padding:3px 11px;font-size:11px;font-weight:700;margin-left:6px;vertical-align:middle}'+
'#view-personal .lm-tabs{display:inline-flex;border:1px solid var(--line);border-radius:9px;overflow:hidden;margin-bottom:16px;flex-wrap:wrap}'+
'#view-personal .lm-tabs button{border:none;background:var(--card);padding:8px 18px;font-size:12.5px;font-weight:700;cursor:pointer;color:var(--muted);border-right:1px solid var(--line)}'+
'#view-personal .lm-tabs button:last-child{border-right:none}#view-personal .lm-tabs button.on{background:var(--ink);color:#fff}'+
'#view-personal .lm-kpis{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin-bottom:16px}'+
'#view-personal .lm-kpi{background:var(--card);border:1px solid var(--line);border-radius:13px;padding:13px 15px}'+
'#view-personal .lm-kpi .l{font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}'+
'#view-personal .lm-kpi .v{font-size:22px;font-weight:800;margin-top:6px;letter-spacing:-.5px}'+
'#view-personal .lm-kpi .s{font-size:11px;color:var(--muted);margin-top:3px}'+
'#view-personal .lm-kpi.good .v{color:var(--green)}#view-personal .lm-kpi.bad .v{color:var(--red)}#view-personal .lm-kpi.hero{background:var(--ink)}#view-personal .lm-kpi.hero .l{color:#c7c0b4}#view-personal .lm-kpi.hero .v{color:#fff}#view-personal .lm-kpi.hero .s{color:#a49c8e}'+
'#view-personal .lm-grid2{display:grid;grid-template-columns:1.15fr .85fr;gap:16px;margin-bottom:16px}'+
'#view-personal .lm-grid11{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}'+
'#view-personal .lm-card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px}'+
'#view-personal .lm-card h3{margin:0 0 3px;font-size:14px}#view-personal .lm-card .cap{color:var(--muted);font-size:12px;margin:0 0 12px}'+
'#view-personal .lm-wrap{position:relative;height:250px}#view-personal .lm-wrap.sm{height:220px}'+
'#view-personal .lm-tablewrap{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:auto}'+
'#view-personal table.lm-table{width:100%;border-collapse:collapse;font-size:12.5px}'+
'#view-personal .lm-table th{position:sticky;top:0;background:#efe9df;text-align:left;padding:10px 12px;font-size:10.5px;text-transform:uppercase;letter-spacing:.03em;color:var(--muted);border-bottom:1px solid var(--line);white-space:nowrap;z-index:1}'+
'#view-personal .lm-table th.r,#view-personal .lm-table td.r{text-align:right}'+
'#view-personal .lm-table td{padding:9px 12px;border-bottom:1px solid #f0ece3;vertical-align:middle}'+
'#view-personal .lm-table tbody tr:hover{background:#faf7f1}'+
'#view-personal .lm-amt{font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}#view-personal .lm-in{color:var(--green)}#view-personal .lm-out{color:var(--ink)}'+
'#view-personal .lm-pill{display:inline-block;padding:2px 8px;border-radius:20px;font-size:10.5px;font-weight:700;white-space:nowrap}'+
'#view-personal .lm-cleared{background:var(--green-soft);color:#1f6a45}#view-personal .lm-uncleared{background:var(--gold-soft);color:#8a6516}#view-personal .lm-pending{background:#efeae0;color:#8d8577}'+
'#view-personal .lm-tag{display:inline-block;background:var(--blue-soft);color:#27508c;border-radius:6px;padding:2px 7px;font-size:10.5px;font-weight:600;margin-right:4px}'+
'#view-personal .lm-chips{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 12px}'+
'#view-personal .lm-chip{cursor:pointer;border:1px solid var(--line);background:var(--card);border-radius:20px;padding:7px 13px;font-size:12.5px;font-weight:600;color:var(--ink)}#view-personal .lm-chip.on{background:var(--ink);color:#fff;border-color:var(--ink)}'+
'#view-personal .lm-bar{display:flex;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap}#view-personal .lm-bar input{flex:1;max-width:320px;padding:9px 13px;border:1px solid var(--line);border-radius:9px;font-size:13px;background:var(--card);color:var(--ink)}'+
'#view-personal .lm-acct{display:flex;align-items:center;justify-content:space-between;padding:11px 14px;border-bottom:1px solid #f0ece3}#view-personal .lm-acct:last-child{border-bottom:none}'+
'#view-personal .lm-acct .nm{font-weight:700;font-size:13px}#view-personal .lm-acct .mt{font-size:11px;color:var(--muted);margin-top:2px}'+
'#view-personal .lm-acct .bal{font-weight:800;font-variant-numeric:tabular-nums;font-size:14px}'+
'#view-personal .lm-src{display:inline-block;font-size:9.5px;font-weight:700;padding:1px 6px;border-radius:10px;margin-left:6px;vertical-align:middle}#view-personal .lm-synced{background:var(--blue-soft);color:#27508c}#view-personal .lm-manual{background:#efeae0;color:#8d8577}'+
'#view-personal .lm-grouphead{display:flex;justify-content:space-between;align-items:baseline;margin:0 0 8px;padding:0 2px}#view-personal .lm-grouphead .gt{font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:#6f6857}#view-personal .lm-grouphead .gv{font-weight:800;font-variant-numeric:tabular-nums}'+
'#view-personal .lm-brow{display:grid;grid-template-columns:1.4fr 1fr 90px;gap:12px;align-items:center;padding:11px 4px;border-bottom:1px solid #f0ece3}#view-personal .lm-brow:last-child{border-bottom:none}'+
'#view-personal .lm-brow .bn{font-weight:700;font-size:13px}#view-personal .lm-brow .bs{font-size:11px;color:var(--muted);margin-top:2px}'+
'#view-personal .lm-prog{height:8px;background:#efe9df;border-radius:6px;overflow:hidden}#view-personal .lm-prog>i{display:block;height:100%;border-radius:6px}'+
'#view-personal .lm-brem{text-align:right;font-size:12px;font-weight:700;font-variant-numeric:tabular-nums}'+
'#view-personal .lm-foot{font-size:11.5px;color:var(--muted);margin-top:14px;line-height:1.6}'+
'#view-personal .lm-section-title{font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:#6f6857;margin:4px 0 10px}';

var sectionHTML=''+
'<div class="lm-sub"><b>Personal Finances.</b> Net worth, accounts, transactions, budgets and recurring bills — the full picture from Lunch Money in one place. <span class="lm-badge">Sample data — connect a Lunch Money API key to go live</span></div>'+
'<div class="lm-tabs">'+
 '<button class="on" data-v="overview">Overview</button>'+
 '<button data-v="accounts">Accounts</button>'+
 '<button data-v="transactions">Transactions</button>'+
 '<button data-v="budget">Budget</button>'+
 '<button data-v="recurring">Recurring</button>'+
'</div>'+
'<div id="lmBody"></div>';

/* ---------- overview ---------- */
function renderOverview(){
  var nw=netWorth(), inc=moThisIncome(), exp=moThisExpense(), flow=inc-exp;
  var html=''+
  '<div class="lm-kpis">'+
   '<div class="lm-kpi hero"><div class="l">Net Worth</div><div class="v">'+money0(nw)+'</div><div class="s">assets minus liabilities</div></div>'+
   '<div class="lm-kpi good"><div class="l">Total Assets</div><div class="v">'+money0(assetsTotal())+'</div><div class="s">'+ACCOUNTS.filter(function(a){return !isLiab(a.type);}).length+' accounts</div></div>'+
   '<div class="lm-kpi bad"><div class="l">Liabilities</div><div class="v">'+money0(liabTotal())+'</div><div class="s">'+ACCOUNTS.filter(function(a){return isLiab(a.type);}).length+' accounts</div></div>'+
   '<div class="lm-kpi good"><div class="l">Income (Jul)</div><div class="v">'+money0(inc)+'</div><div class="s">Fanbasis · last 30 days</div></div>'+
   '<div class="lm-kpi"><div class="l">Expenses (Jul)</div><div class="v">'+money0(exp)+'</div><div class="s">this month</div></div>'+
   '<div class="lm-kpi '+(flow>=0?'good':'bad')+'"><div class="l">Cash Flow</div><div class="v">'+(flow>=0?'+':'')+money0(flow)+'</div><div class="s">income minus spend</div></div>'+
  '</div>'+
  '<div class="lm-grid2">'+
   '<div class="lm-card"><h3>Net worth trend</h3><div class="cap">Last 12 months.</div><div class="lm-wrap"><canvas id="lmNwChart"></canvas></div></div>'+
   '<div class="lm-card"><h3>Spending by category</h3><div class="cap">This month, by category group.</div><div class="lm-wrap"><canvas id="lmCatChart"></canvas></div></div>'+
  '</div>'+
  '<div class="lm-grid11">'+
   '<div class="lm-card"><h3>Income vs expenses</h3><div class="cap">Last 6 months.</div><div class="lm-wrap sm"><canvas id="lmIeChart"></canvas></div></div>'+
   '<div class="lm-card"><h3>Budget this month</h3><div class="cap">Top categories, budgeted vs spent.</div>'+budgetMini()+'</div>'+
  '</div>'+
  '<div class="lm-card"><div class="lm-grouphead"><span class="gt">Accounts snapshot</span><span class="gv">'+money0(nw)+' net</span></div>'+acctSnapshot()+'</div>'+
  '<div class="lm-foot">Sample figures shown for layout. When the Lunch Money API key is connected, this pulls live from your assets, Plaid-synced accounts, transactions, budgets and recurring items.</div>';
  document.getElementById('lmBody').innerHTML=html;
  drawNwChart(); drawCatChart(); drawIeChart();
}
function budgetMini(){
  var rows=BUDGET.filter(function(b){return !b.grp;}).slice(0,6);
  return rows.map(function(b){
    var pct=Math.min(100,Math.round(b.spent/b.budget*100)), over=b.spent>b.budget;
    return '<div class="lm-brow"><div><div class="bn">'+esc(b.cat)+'</div><div class="bs">'+money0(b.spent)+' of '+money0(b.budget)+'</div></div>'+
     '<div class="lm-prog"><i style="width:'+pct+'%;background:'+(over?C.red:C.green)+'"></i></div>'+
     '<div class="lm-brem" style="color:'+(over?C.red:C.green)+'">'+(over?'-':'')+money0(Math.abs(b.budget-b.spent))+'</div></div>';
  }).join('');
}
function acctSnapshot(){
  return GROUPS.map(function(g){
    var list=ACCOUNTS.filter(function(a){return g.types.indexOf(a.type)>=0;});
    if(!list.length)return '';
    var sub=0;list.forEach(function(a){sub+=a.balance;});
    var liab=isLiab(list[0].type);
    return '<div class="lm-acct"><div><div class="nm">'+esc(g.key)+'</div><div class="mt">'+list.length+' account'+(list.length>1?'s':'')+'</div></div>'+
      '<div class="bal" style="color:'+(liab?C.red:C.ink||'inherit')+'">'+(liab?'-':'')+money0(sub)+'</div></div>';
  }).join('');
}

/* ---------- accounts ---------- */
function renderAccounts(){
  var html='';
  GROUPS.forEach(function(g){
    var list=ACCOUNTS.filter(function(a){return g.types.indexOf(a.type)>=0;});
    if(!list.length)return;
    var sub=0;list.forEach(function(a){sub+=a.balance;});
    var liab=isLiab(list[0].type);
    html+='<div class="lm-card" style="margin-bottom:14px">'+
     '<div class="lm-grouphead"><span class="gt">'+esc(g.key)+'</span><span class="gv" style="color:'+(liab?C.red:'inherit')+'">'+(liab?'-':'')+money0(sub)+'</span></div>'+
     list.map(function(a){
       return '<div class="lm-acct"><div><div class="nm">'+esc(a.name)+
         '<span class="lm-src '+(a.source==='plaid'?'lm-synced':'lm-manual')+'">'+acctType(a)+'</span></div>'+
         '<div class="mt">'+esc(a.institution||'Manual asset')+(a.mask?' ····'+a.mask:'')+' · updated '+dfmt(a.as_of)+'</div></div>'+
         '<div class="bal" style="color:'+(liab?C.red:'inherit')+'">'+(liab?'-':'')+money(a.balance)+'</div></div>';
     }).join('')+'</div>';
  });
  html+='<div class="lm-card"><div class="lm-grouphead"><span class="gt">Net worth</span><span class="gv">'+money0(netWorth())+'</span></div>'+
    '<div class="lm-acct"><div class="nm">Total assets</div><div class="bal" style="color:'+C.green+'">'+money0(assetsTotal())+'</div></div>'+
    '<div class="lm-acct"><div class="nm">Total liabilities</div><div class="bal" style="color:'+C.red+'">-'+money0(liabTotal())+'</div></div></div>';
  document.getElementById('lmBody').innerHTML=html;
}

/* ---------- transactions ---------- */
function txRows(){
  return TX.filter(function(t){
    if(txFilter==='income'&&!(t.amount>0&&!t.xfer))return false;
    if(txFilter==='expense'&&!(t.amount<0))return false;
    if(txFilter==='uncleared'&&t.status!=='uncleared')return false;
    if(txFilter==='pending'&&t.status!=='pending')return false;
    if(txSearch){var s=(t.payee+' '+t.cat+' '+t.acct).toLowerCase();if(s.indexOf(txSearch)<0)return false;}
    return true;
  });
}
function renderTx(){
  var chips=[['all','All'],['income','Income'],['expense','Expenses'],['uncleared','Uncleared'],['pending','Pending']];
  var rows=txRows();
  var html=''+
  '<div class="lm-chips" id="lmTxChips">'+chips.map(function(c){return '<span class="lm-chip'+(txFilter===c[0]?' on':'')+'" data-f="'+c[0]+'">'+c[1]+'</span>';}).join('')+'</div>'+
  '<div class="lm-bar"><input id="lmTxSearch" placeholder="Search payee, category or account…" value="'+esc(txSearch)+'"><span class="cap" style="color:var(--muted);font-size:12px">'+rows.length+' transactions</span></div>'+
  '<div class="lm-tablewrap"><table class="lm-table"><thead><tr>'+
   '<th>Date</th><th>Payee</th><th>Category</th><th>Account</th><th>Tags</th><th>Status</th><th class="r">Amount</th>'+
   '</tr></thead><tbody>'+
   rows.map(function(t){
     var inc=t.amount>0&&!t.xfer;
     return '<tr><td style="white-space:nowrap;color:var(--muted)">'+dfmt(t.date)+'</td>'+
       '<td style="font-weight:700">'+esc(t.payee)+'</td>'+
       '<td>'+esc(t.cat)+'<div style="font-size:10.5px;color:var(--muted)">'+esc(t.grp)+'</div></td>'+
       '<td>'+esc(t.acct)+'</td>'+
       '<td>'+(t.tags.length?t.tags.map(function(x){return '<span class="lm-tag">'+esc(x)+'</span>';}).join(''):'<span style="color:var(--muted)">—</span>')+'</td>'+
       '<td><span class="lm-pill lm-'+t.status+'">'+t.status+'</span></td>'+
       '<td class="r"><span class="lm-amt '+(inc?'lm-in':'lm-out')+'">'+(inc?'+':'')+money(t.amount)+'</span></td></tr>';
   }).join('')+
   '</tbody></table></div>';
  document.getElementById('lmBody').innerHTML=html;
  document.getElementById('lmTxSearch').oninput=function(e){txSearch=e.target.value.toLowerCase();var v=e.target.value;renderTx();var s=document.getElementById('lmTxSearch');s.focus();s.value=v;s.setSelectionRange(v.length,v.length);};
  document.querySelectorAll('#lmTxChips .lm-chip').forEach(function(el){el.onclick=function(){txFilter=el.getAttribute('data-f');renderTx();};});
}

/* ---------- budget ---------- */
function renderBudget(){
  var top=BUDGET.filter(function(b){return !b.grp;});
  var tb=0,ts=0;top.forEach(function(b){tb+=b.budget;ts+=b.spent;});
  var html=''+
  '<div class="lm-kpis" style="grid-template-columns:repeat(4,1fr)">'+
   '<div class="lm-kpi"><div class="l">Total budget</div><div class="v">'+money0(tb)+'</div><div class="s">July 2026</div></div>'+
   '<div class="lm-kpi"><div class="l">Spent</div><div class="v">'+money0(ts)+'</div><div class="s">'+Math.round(ts/tb*100)+'% of budget</div></div>'+
   '<div class="lm-kpi '+(tb-ts>=0?'good':'bad')+'"><div class="l">Remaining</div><div class="v">'+money0(tb-ts)+'</div><div class="s">left to spend</div></div>'+
   '<div class="lm-kpi bad"><div class="l">Over budget</div><div class="v">'+top.filter(function(b){return b.spent>b.budget;}).length+'</div><div class="s">categories</div></div>'+
  '</div>'+
  '<div class="lm-card"><div class="lm-section-title">Budgeted categories · July 2026</div>'+
   top.map(function(b){
     var pct=Math.min(100,Math.round(b.spent/b.budget*100)), over=b.spent>b.budget, rem=b.budget-b.spent;
     var kids=BUDGET.filter(function(k){return k.grp===b.cat;});
     var kidHtml=kids.length?'<div style="margin-left:2px;margin-top:4px">'+kids.map(function(k){var kp=Math.min(100,Math.round(k.spent/k.budget*100)),ko=k.spent>k.budget;return '<div class="lm-brow" style="grid-template-columns:1.4fr 1fr 90px;padding:7px 4px 7px 16px"><div><div class="bn" style="font-size:12px;font-weight:600">↳ '+esc(k.cat)+'</div><div class="bs">'+money0(k.spent)+' of '+money0(k.budget)+' · '+k.n+' txns</div></div><div class="lm-prog"><i style="width:'+kp+'%;background:'+(ko?C.red:C.blue)+'"></i></div><div class="lm-brem" style="color:'+(ko?C.red:C.green)+'">'+(ko?'-':'')+money0(Math.abs(k.budget-k.spent))+'</div></div>';}).join('')+'</div>':'';
     return '<div class="lm-brow"><div><div class="bn">'+esc(b.cat)+'</div><div class="bs">'+money0(b.spent)+' of '+money0(b.budget)+' · '+b.n+' txns</div></div>'+
       '<div class="lm-prog"><i style="width:'+pct+'%;background:'+(over?C.red:C.green)+'"></i></div>'+
       '<div class="lm-brem" style="color:'+(over?C.red:C.green)+'">'+(over?'-':'')+money0(Math.abs(rem))+'</div></div>'+kidHtml;
   }).join('')+'</div>';
  document.getElementById('lmBody').innerHTML=html;
}

/* ---------- recurring ---------- */
function renderRecurring(){
  var inc=RECURRING.filter(function(r){return r.income;});
  var bills=RECURRING.filter(function(r){return !r.income;});
  function moEquiv(r){return r.cadence==='yearly'?r.amount/12:r.cadence==='twice a month'?r.amount*2:r.amount;}
  var moBills=0;bills.forEach(function(r){moBills+=moEquiv(r);});
  var moInc=0;inc.forEach(function(r){moInc+=moEquiv(r);});
  function tbl(list){
    return '<div class="lm-tablewrap"><table class="lm-table"><thead><tr><th>Payee</th><th>Description</th><th>Cadence</th><th>Next date</th><th>Account</th><th class="r">Amount</th></tr></thead><tbody>'+
     list.map(function(r){return '<tr><td style="font-weight:700">'+esc(r.payee)+'</td><td style="color:var(--muted)">'+esc(r.desc)+'</td><td>'+esc(r.cadence)+'</td><td style="white-space:nowrap">'+dfmt(r.next)+'</td><td>'+esc(r.acct)+'</td><td class="r"><span class="lm-amt '+(r.income?'lm-in':'lm-out')+'">'+(r.income?'+':'')+money(r.amount)+'</span></td></tr>';}).join('')+
     '</tbody></table></div>';
  }
  var html=''+
  '<div class="lm-kpis" style="grid-template-columns:repeat(4,1fr)">'+
   '<div class="lm-kpi"><div class="l">Recurring items</div><div class="v">'+RECURRING.length+'</div><div class="s">'+bills.length+' bills · '+inc.length+' income</div></div>'+
   '<div class="lm-kpi bad"><div class="l">Monthly bills</div><div class="v">'+money0(moBills)+'</div><div class="s">normalized to monthly</div></div>'+
   '<div class="lm-kpi good"><div class="l">Monthly income</div><div class="v">'+money0(moInc)+'</div><div class="s">recurring only</div></div>'+
   '<div class="lm-kpi '+(moInc-moBills>=0?'good':'bad')+'"><div class="l">Net recurring</div><div class="v">'+(moInc-moBills>=0?'+':'')+money0(moInc-moBills)+'</div><div class="s">per month</div></div>'+
  '</div>'+
  '<div class="lm-section-title">Recurring income</div>'+tbl(inc)+
  '<div class="lm-section-title" style="margin-top:18px">Bills & subscriptions</div>'+tbl(bills)+
  '<div class="lm-foot">Amounts normalized to monthly for totals (yearly ÷ 12, twice-a-month × 2). Lunch Money predicts each item’s next expected billing date.</div>';
  document.getElementById('lmBody').innerHTML=html;
}

/* ---------- charts ---------- */
function killChart(k){if(charts[k]){charts[k].destroy();charts[k]=null;}}
function drawNwChart(){
  if(!window.Chart)return;var el=document.getElementById('lmNwChart');if(!el)return;killChart('nw');
  var vals=NW_TREND.values.slice();vals[vals.length-1]=Math.round(netWorth());
  charts.nw=new Chart(el.getContext('2d'),{type:'line',data:{labels:NW_TREND.labels,datasets:[{data:vals,borderColor:C.green,backgroundColor:'rgba(46,125,84,.10)',fill:true,tension:.35,pointRadius:0,borderWidth:2.5}]},
   options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:function(c){return money0(c.parsed.y);}}}},scales:{y:{ticks:{callback:function(v){return moneyK(v);},font:{size:10}},grid:{color:'#efe9df'}},x:{grid:{display:false},ticks:{font:{size:10}}}}}});
}
function drawCatChart(){
  if(!window.Chart)return;var el=document.getElementById('lmCatChart');if(!el)return;killChart('cat');
  var m=MONTH.spendByGroup;
  var labels=Object.keys(m).sort(function(a,b){return m[b]-m[a];});
  charts.cat=new Chart(el.getContext('2d'),{type:'doughnut',data:{labels:labels,datasets:[{data:labels.map(function(l){return Math.round(m[l]);}),backgroundColor:PAL,borderWidth:2,borderColor:'#fff'}]},
   options:{responsive:true,maintainAspectRatio:false,cutout:'58%',plugins:{legend:{position:'right',labels:{boxWidth:10,font:{size:10.5},padding:8}},tooltip:{callbacks:{label:function(c){return c.label+': '+money0(c.parsed);}}}}}});
}
function drawIeChart(){
  if(!window.Chart)return;var el=document.getElementById('lmIeChart');if(!el)return;killChart('ie');
  var incSeries=IE_TREND.income.slice();incSeries[incSeries.length-1]=fanbasisIncome();
  charts.ie=new Chart(el.getContext('2d'),{type:'bar',data:{labels:IE_TREND.labels,datasets:[
    {label:'Income',data:incSeries,backgroundColor:C.green,borderRadius:4},
    {label:'Expenses',data:IE_TREND.expenses,backgroundColor:C.red,borderRadius:4}]},
   options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{boxWidth:11,font:{size:11}}},tooltip:{callbacks:{label:function(c){return c.dataset.label+': '+money0(c.parsed.y);}}}},scales:{y:{ticks:{callback:function(v){return moneyK(v);},font:{size:10}},grid:{color:'#efe9df'}},x:{grid:{display:false},ticks:{font:{size:10}}}}}});
}

/* ---------- view switching ---------- */
function renderSub(){
  if(curSub==='overview')renderOverview();
  else if(curSub==='accounts')renderAccounts();
  else if(curSub==='transactions')renderTx();
  else if(curSub==='budget')renderBudget();
  else if(curSub==='recurring')renderRecurring();
}
function setSub(v){
  curSub=v;
  var btns=document.querySelectorAll('#view-personal .lm-tabs button');
  for(var i=0;i<btns.length;i++)btns[i].classList.toggle('on',btns[i].getAttribute('data-v')===v);
  renderSub();
}
function renderPersonal(){ /* data is local sample; when live, LM.fetchAll().then(renderSub) */ renderSub(); }

/* ---------- init (mirrors production.js integration) ---------- */
function initLM(){
  if(document.getElementById('view-personal'))return;
  var style=document.createElement('style');style.textContent=css;document.head.appendChild(style);
  var anc=document.getElementById('view-dash');
  var sec=document.createElement('section');sec.id='view-personal';sec.style.display='none';sec.innerHTML=sectionHTML;
  if(anc&&anc.parentNode)anc.parentNode.insertBefore(sec,anc); else document.body.appendChild(sec);
  sec.querySelectorAll('.lm-tabs button').forEach(function(b){b.onclick=function(){setSub(b.getAttribute('data-v'));};});
  var nav=document.getElementById('navFinance')||document.getElementById('nav');
  if(nav&&!document.getElementById('lmNavBtn')){
    var b=document.createElement('button');b.id='lmNavBtn';b.setAttribute('onclick',"showView('personal')");
    b.innerHTML='<span class="ico2">◎</span>Personal Finances';nav.appendChild(b);
  }
  if(typeof window.showView==='function'&&!window.__lmWrap){
    window.__lmWrap=true;var _sv=window.showView;
    window.showView=function(id){
      if(id==='personal'){
        // hide standard views via their class (never leave inline display:none on them — it breaks the app's .view.on toggle)
        var sv=document.querySelectorAll('.view');for(var i=0;i<sv.length;i++){sv[i].classList.remove('on');sv[i].style.display='';}
        var pd=document.getElementById('view-production');if(pd)pd.style.display='none';
        var v=document.getElementById('view-personal');if(v)v.style.display='';
        var nbs=document.querySelectorAll('.navgroup button');for(var j=0;j<nbs.length;j++)nbs[j].classList.remove('on');
        var nb=document.getElementById('lmNavBtn');if(nb)nb.classList.add('on');
        if(window.setNavGroup)window.setNavGroup('fi',false);
        var pt=document.getElementById('pageTitle');if(pt)pt.textContent='Personal Finances';
        renderPersonal();
      } else {
        var v=document.getElementById('view-personal');if(v)v.style.display='none';
        // clear any leftover inline display on standard views so the app's class toggle can show them again
        var sv=document.querySelectorAll('.view');for(var i=0;i<sv.length;i++)sv[i].style.display='';
        var nb=document.getElementById('lmNavBtn');if(nb)nb.classList.remove('on');
        _sv(id);
      }
    };
  }
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initLM);else initLM();
})();
