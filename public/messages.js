/* MSFS All Messages — unified inbox (SMS + Email + Facebook + Instagram, everything
GHL's Conversations already aggregate for this sub-account). Self-contained module,
same pattern as production.js: injects its own <section>, its own nav button under
Production, and wraps window.showView rather than touching index.html's core script. */
(function(){
var CHAN_COLOR={SMS:'#00B8F2',EMAIL:'#F4941E',FACEBOOK:'#3b5998',INSTAGRAM:'#DE3ACE',WHATSAPP:'#25d366',CALL:'#6B7280',VOICEMAIL:'#6B7280',GMB:'#4285f4',LIVE_CHAT:'#45B369',REVIEW:'#F86624',OTHER:'#9CA3AF'};
function chanColor(k){return CHAN_COLOR[k]||CHAN_COLOR.OTHER;}
var CONVOS=[], CHANNELS=[], curChannel='ALL', curSearch='', curId=null, curContactId=null, curChannelKey=null, sending=false, loaded=false, pollTimer=null, unreadOnly=false;

/* ---------- styles ---------- */
var css=''+
'#view-messages{display:flex;flex-direction:column;height:calc(100vh - 90px)}'+
'#view-messages .msg-sub{color:var(--muted);font-size:12.5px;margin:2px 0 14px}'+
'#view-messages .msg-body{display:grid;grid-template-columns:340px 1fr;gap:16px;flex:1;min-height:0}'+
'#view-messages .msg-list-wrap{background:var(--card);border:none;border-radius:8px;box-shadow:0 0.25rem 1.875rem rgba(46,45,116,.05);display:flex;flex-direction:column;min-height:0;overflow:hidden}'+
'#view-messages .msg-tools{padding:12px 12px 10px;border-bottom:1px solid var(--line)}'+
'#view-messages .msg-tools input{width:100%;box-sizing:border-box;padding:8px 12px;border:1px solid var(--line);border-radius:9px;font-size:12.5px;background:var(--bg);color:var(--ink)}'+
'#view-messages .msg-chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px}'+
'#view-messages .msg-chip{cursor:pointer;border:1px solid var(--line);background:var(--bg);border-radius:20px;padding:5px 11px;font-size:11px;font-weight:700;color:var(--ink);display:flex;align-items:center;gap:5px}'+
'#view-messages .msg-chip .dot{width:7px;height:7px;border-radius:50%}'+
'#view-messages .msg-chip.on{background:var(--inverse-bg);color:var(--inverse-ink);border-color:var(--inverse-bg)}'+
'#view-messages .msg-rows{overflow-y:auto;flex:1}'+
'#view-messages .msg-row{display:flex;gap:10px;padding:11px 13px;border-bottom:1px solid var(--line);cursor:pointer;align-items:flex-start}'+
'#view-messages .msg-row:hover{background:var(--bg)}#view-messages .msg-row.on{background:var(--blue-soft)}'+
'#view-messages .msg-avatar{width:34px;height:34px;border-radius:50%;background:var(--card2,var(--tile-bg));color:var(--muted);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12.5px;flex:none;position:relative}'+
'#view-messages .msg-avatar .chandot{position:absolute;right:-2px;bottom:-2px;width:11px;height:11px;border-radius:50%;border:2px solid var(--card)}'+
'#view-messages .msg-rowmain{min-width:0;flex:1}'+
'#view-messages .msg-rowtop{display:flex;justify-content:space-between;gap:8px}'+
'#view-messages .msg-name{font-weight:700;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'+
'#view-messages .msg-time{font-size:10.5px;color:var(--muted);white-space:nowrap;flex:none}'+
'#view-messages .msg-snip{font-size:11.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}'+
'#view-messages .msg-row.unread .msg-snip{color:var(--ink);font-weight:600}'+
'#view-messages .msg-chip-unread{margin-left:auto}'+
'#view-messages .msg-unreaddot{width:8px;height:8px;border-radius:50%;background:var(--red);flex:none;margin-top:4px}'+
'#view-messages .msg-empty{padding:30px 16px;color:var(--muted);font-size:12.5px;text-align:center}'+
'#view-messages .msg-thread{background:var(--card);border:none;border-radius:8px;box-shadow:0 0.25rem 1.875rem rgba(46,45,116,.05);display:flex;flex-direction:column;min-height:0;overflow:hidden}'+
'#view-messages .msg-thead{padding:14px 18px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;gap:10px}'+
'#view-messages .msg-thead .nm{font-weight:800;font-size:14.5px}'+
'#view-messages .msg-thead .meta{color:var(--muted);font-size:11.5px;margin-top:2px}'+
'#view-messages .msg-thead a{font-size:11.5px;font-weight:700;color:var(--blue);text-decoration:none;white-space:nowrap}'+
'#view-messages .msg-scroll{flex:1;overflow-y:auto;padding:16px 18px;display:flex;flex-direction:column;gap:10px}'+
'#view-messages .msg-bubblewrap{display:flex;flex-direction:column;max-width:70%}'+
'#view-messages .msg-bubblewrap.out{align-self:flex-end;align-items:flex-end}'+
'#view-messages .msg-bubblewrap.in{align-self:flex-start;align-items:flex-start}'+
'#view-messages .msg-bubble{padding:9px 13px;border-radius:14px;font-size:13px;line-height:1.4;white-space:pre-wrap;word-break:break-word}'+
'#view-messages .msg-bubblewrap.out .msg-bubble{background:var(--inverse-bg);color:var(--inverse-ink);border-bottom-right-radius:4px}'+
'#view-messages .msg-bubblewrap.in .msg-bubble{background:var(--tile-bg);color:var(--ink);border-bottom-left-radius:4px}'+
'#view-messages .msg-bmeta{font-size:10px;color:var(--muted);margin-top:3px;padding:0 3px}'+
'#view-messages .msg-noselect{flex:1;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:13px}'+
'#view-messages .msg-composer{display:none;gap:8px;padding:12px 18px;border-top:1px solid var(--line);align-items:flex-end}'+
'#view-messages .msg-composer textarea{flex:1;resize:none;max-height:120px;min-height:38px;padding:9px 12px;border:1px solid var(--line);border-radius:10px;font:inherit;font-size:13px;line-height:1.4;background:var(--bg);color:var(--ink)}'+
'#view-messages .msg-composer button{background:var(--inverse-bg);color:var(--inverse-ink);border:none;border-radius:10px;padding:9px 16px;font-size:12.5px;font-weight:700;cursor:pointer;white-space:nowrap}'+
'#view-messages .msg-composer button:disabled{opacity:.5;cursor:default}'+
'@media(max-width:900px){#view-messages .msg-body{grid-template-columns:1fr}#view-messages .msg-thread{display:none}#view-messages.msg-thread-open .msg-thread{display:flex}#view-messages.msg-thread-open .msg-list-wrap{display:none}#view-messages .msg-back{display:inline-block!important}}'+
'#view-messages .msg-back{display:none;background:none;border:none;font-size:16px;cursor:pointer;color:var(--ink);margin-right:4px}';

/* ---------- helpers ---------- */
function initials(n){var p=(n||'?').trim().split(/\s+/);return((p[0]||'')[0]||'')+((p[1]||'')[0]||'');}
function relTime(iso){
if(!iso)return'';
var d=new Date(iso),diff=(Date.now()-d.getTime())/1000;
if(diff<60)return'now';
if(diff<3600)return Math.floor(diff/60)+'m';
if(diff<86400)return Math.floor(diff/3600)+'h';
if(diff<604800)return Math.floor(diff/86400)+'d';
return d.toLocaleDateString(undefined,{month:'short',day:'numeric'});
}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}

/* ---------- data ---------- */
function loadList(){
// The server already filters on unread (see /api/messages), so this is the
// same list narrowed server-side rather than a second client-side pass that
// could disagree with the counts.
var qs=new URLSearchParams({channel:curChannel,q:curSearch});
if(unreadOnly)qs.set('unread','1');
return fetch('/api/messages?'+qs).then(function(r){return r.json();}).then(function(d){
CONVOS=d.conversations||[];CHANNELS=d.channels||[];
renderChips();renderRows();
if(curId){
var still=CONVOS.some(function(c){return c.id===curId;});
if(!still&&CONVOS.length){/* keep whatever's open, just not highlighted */}
}
}).catch(function(){});
}
function loadThread(id){
var el=document.getElementById('msgScroll');
el.innerHTML='<div class="msg-noselect">Loading…</div>';
return fetch('/api/messages/'+encodeURIComponent(id)).then(function(r){return r.json();}).then(function(d){
renderThread(d.messages||[]);
}).catch(function(){el.innerHTML='<div class="msg-noselect">Couldn\'t load this thread.</div>';});
}

/* ---------- send a reply ---------- */
function bubbleHTML(text, when){
return'<div class="msg-bubblewrap out"><div class="msg-bubble">'+esc(text)+'</div>'+
'<div class="msg-bmeta">'+esc(when||'Sent just now')+'</div></div>';
}
function sendReply(){
if(sending)return;
var ta=document.getElementById('msgInput');
var text=(ta.value||'').trim();
if(!text||!curId||!curContactId)return;
sending=true;
var btn=document.getElementById('msgSendBtn');
btn.disabled=true;ta.disabled=true;
fetch('/api/messages/'+encodeURIComponent(curId)+'/reply',{
method:'POST',
headers:{'Content-Type':'application/json'},
body:JSON.stringify({contactId:curContactId,type:curChannelKey||'SMS',message:text})
}).then(function(r){
return r.json().then(function(d){return{status:r.status,body:d};});
}).then(function(res){
sending=false;btn.disabled=false;ta.disabled=false;
if(res.status!==200||res.body.error){
window.alert((res.body&&res.body.error)?res.body.error:'Could not send that message.');
return;
}
ta.value='';ta.style.height='auto';
if(res.body.demo){
window.alert(res.body.note||'Demo mode — no message actually sent.');
}else{
var el=document.getElementById('msgScroll');
var noSelect=el.querySelector('.msg-noselect');
if(noSelect)el.innerHTML='';
el.insertAdjacentHTML('beforeend',bubbleHTML(text));
el.scrollTop=el.scrollHeight;
}
loadList();
ta.focus();
}).catch(function(){
sending=false;btn.disabled=false;ta.disabled=false;
window.alert('Network error — message may not have sent.');
});
}

/* ---------- render ---------- */
function renderChips(){
var wrap=document.getElementById('msgChips');
var chips=[{k:'ALL',label:'All'}].concat(CHANNELS.map(function(k){
var found=CONVOS.find(function(c){return c.channelKey===k;});
return{k:k,label:found?found.channel:k};
}));
// Unread sits apart from the channel chips because it is a different axis --
// you filter to unread WITHIN a channel, not instead of one.
var unreadCount=CONVOS.reduce(function(n,c){return n+(c.unread>0?1:0);},0);
wrap.innerHTML=chips.map(function(c){
return'<div class="msg-chip'+(curChannel===c.k?' on':'')+'" data-k="'+esc(c.k)+'">'+
(c.k==='ALL'?'':'<span class="dot" style="background:'+chanColor(c.k)+'"></span>')+esc(c.label)+'</div>';
}).join('')
+'<div class="msg-chip msg-chip-unread'+(unreadOnly?' on':'')+'" data-unread="1" title="Only conversations waiting on a reply">'
+'<span class="dot" style="background:var(--red)"></span>Unread'
+(unreadOnly||!unreadCount?'':' <span style="opacity:.6">'+unreadCount+'</span>')
+'</div>';
Array.prototype.forEach.call(wrap.querySelectorAll('.msg-chip'),function(el){
el.onclick=function(){
  if(el.dataset.unread){unreadOnly=!unreadOnly;}
  else{curChannel=el.dataset.k;}
  loadList();
};
});
}
function renderRows(){
var wrap=document.getElementById('msgRows');
if(!CONVOS.length){
wrap.innerHTML='<div class="msg-empty">'+(unreadOnly?'Nothing unread. Everyone has been replied to.':'No conversations yet.')+'</div>';
return;}
wrap.innerHTML=CONVOS.map(function(c){
var dirPrefix=c.lastDirection==='outbound'?'You: ':'';
return'<div class="msg-row'+(c.id===curId?' on':'')+(c.unread?' unread':'')+'" data-id="'+esc(c.id)+'">'+
'<div class="msg-avatar">'+esc(initials(c.name))+'<span class="chandot" style="background:'+chanColor(c.channelKey)+'"></span></div>'+
'<div class="msg-rowmain">'+
'<div class="msg-rowtop"><span class="msg-name">'+esc(c.name)+'</span><span class="msg-time">'+relTime(c.lastAt)+'</span></div>'+
'<div class="msg-snip">'+esc(dirPrefix+(c.lastBody||'(no preview)'))+'</div>'+
'</div>'+
(c.unread?'<div class="msg-unreaddot"></div>':'')+
'</div>';
}).join('');
Array.prototype.forEach.call(wrap.querySelectorAll('.msg-row'),function(el){
el.onclick=function(){openThread(el.dataset.id);};
});
}
function renderThread(msgs){
var el=document.getElementById('msgScroll');
if(!msgs.length){el.innerHTML='<div class="msg-noselect">No messages in this thread.</div>';return;}
el.innerHTML=msgs.map(function(m){
var dir=m.direction==='outbound'?'out':'in';
return'<div class="msg-bubblewrap '+dir+'"><div class="msg-bubble">'+esc(m.body||'(no content)')+'</div>'+
'<div class="msg-bmeta">'+esc(m.channel||'')+' · '+(m.at?new Date(m.at).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'')+'</div></div>';
}).join('');
el.scrollTop=el.scrollHeight;
}
function openThread(id){
curId=id;
var c=CONVOS.find(function(x){return x.id===id;});
document.getElementById('msgThreadNm').textContent=c?c.name:'—';
document.getElementById('msgThreadMeta').textContent=c?(c.channel+(c.email?' · '+c.email:'')+(c.phone?' · '+c.phone:'')):'';
var link=document.getElementById('msgThreadOpen');
if(c&&c.contactId){link.style.display='';link.onclick=function(){if(typeof window.openClient==='function'){window.showView('clients');window.openClient(c.contactId);}};}
else link.style.display='none';
var composer=document.getElementById('msgComposer');
if(c&&c.contactId){
curContactId=c.contactId;
curChannelKey=c.channelKey;
composer.style.display='flex';
var input=document.getElementById('msgInput');
input.placeholder='Reply via '+(c.channel||c.channelKey)+'…';
}else{
curContactId=null;curChannelKey=null;
composer.style.display='none';
}
document.getElementById('view-messages').classList.add('msg-thread-open');
renderRows();
loadThread(id);
}

/* ---------- markup ---------- */
var sectionHTML=''+
'<h2 style="margin:0 0 3px;font-size:20px">All Messages</h2>'+
'<div class="msg-sub">Every conversation across SMS, Email, Facebook and Instagram — pulled live from GHL\'s unified inbox.</div>'+
'<div class="msg-body">'+
'<div class="msg-list-wrap">'+
'<div class="msg-tools"><input id="msgSearch" type="text" placeholder="Search name, email or phone…">'+
'<div class="msg-chips" id="msgChips"></div></div>'+
'<div class="msg-rows" id="msgRows"><div class="msg-empty">Loading…</div></div>'+
'</div>'+
'<div class="msg-thread">'+
'<div class="msg-thead"><div><button class="msg-back" id="msgBack">‹</button><span class="nm" id="msgThreadNm">Select a conversation</span>'+
'<div class="meta" id="msgThreadMeta"></div></div><a href="#" id="msgThreadOpen" style="display:none">Open client →</a></div>'+
'<div class="msg-scroll" id="msgScroll"><div class="msg-noselect">Pick a conversation on the left to see the full thread.</div></div>'+
'<div class="msg-composer" id="msgComposer">'+
'<textarea id="msgInput" placeholder="Type a reply…" rows="1"></textarea>'+
'<button id="msgSendBtn" type="button">Send</button>'+
'</div>'+
'</div>'+
'</div>';

/* ---------- init ---------- */
function initMessages(){
if(document.getElementById('view-messages'))return;
var style=document.createElement('style');style.textContent=css;document.head.appendChild(style);
var anc=document.getElementById('view-dash');
var sec=document.createElement('section');sec.id='view-messages';sec.style.display='none';sec.innerHTML=sectionHTML;
if(anc&&anc.parentNode)anc.parentNode.insertBefore(sec,anc); else document.body.appendChild(sec);

var nav=document.getElementById('navProduction')||document.getElementById('nav');
if(nav&&!document.getElementById('msgNavBtn')){
var b=document.createElement('button');b.id='msgNavBtn';b.setAttribute('onclick',"showView('messages')");
b.innerHTML='<span class="ico2"><i class="ri-message-3-line"></i></span>All Messages';nav.appendChild(b);
}

document.getElementById('msgBack').onclick=function(){document.getElementById('view-messages').classList.remove('msg-thread-open');};
var qTimer;
document.getElementById('msgSearch').addEventListener('input',function(e){
clearTimeout(qTimer);var v=e.target.value;qTimer=setTimeout(function(){curSearch=v;loadList();},300);
});

document.getElementById('msgSendBtn').onclick=sendReply;
var msgInput=document.getElementById('msgInput');
msgInput.addEventListener('keydown',function(e){
if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendReply();}
});
msgInput.addEventListener('input',function(){
msgInput.style.height='auto';
msgInput.style.height=Math.min(msgInput.scrollHeight,120)+'px';
});

if(typeof window.showView==='function'&&!window.__msgWrap){
window.__msgWrap=true;var _sv=window.showView;
window.showView=function(id){
if(id==='messages'){
var sv=document.querySelectorAll('.view');for(var i=0;i<sv.length;i++){sv[i].classList.remove('on');sv[i].style.display='';}
// messages.js loads last (outermost wrapper), so its own "show" branch
// is the only one that runs when jumping straight here from any other
// special view -- it has to hide every one of them itself rather than
// relying on their wrappers to self-hide down the chain (see production.js
// /revenue.js/mfsn.js/personal-finances.js for the same pattern).
['view-production','view-personal','view-rev','view-mfsn'].forEach(function(x){var e=document.getElementById(x);if(e)e.style.display='none';});
var v=document.getElementById('view-messages');if(v)v.style.display='';
var nbs=document.querySelectorAll('.navgroup button');for(var j=0;j<nbs.length;j++)nbs[j].classList.remove('on');
var nb=document.getElementById('msgNavBtn');if(nb)nb.classList.add('on');
if(window.setNavGroup)window.setNavGroup('pr',false);
var pt=document.getElementById('pageTitle');if(pt)pt.textContent='All Messages';
loadList();
if(pollTimer)clearInterval(pollTimer);
pollTimer=setInterval(loadList,30000);
loaded=true;
} else {
var v2=document.getElementById('view-messages');if(v2)v2.style.display='none';
if(pollTimer){clearInterval(pollTimer);pollTimer=null;}
_sv(id);
}
};
}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initMessages);else initMessages();
})();
