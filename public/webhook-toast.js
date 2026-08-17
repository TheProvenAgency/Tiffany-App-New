// Real-time "did that webhook actually arrive" toast, top-right. Admin-only
// -- this file loads for everyone (like production.js/team.js), but does
// nothing at all unless window.apiMe() resolves an admin (the server-side
// gate on GET /api/recent-webhooks is the real boundary; this is only
// presentation, same reasoning as role.js).
//
// Every field this ever renders already went through lib/webhook-feed.js's
// capture-time ALLOWLIST -- this file does not decide what is safe to
// show, it only displays what the server already decided was safe.
(function () {
  var POLL_MS = 3000;
  var TOAST_MS = 5000;
  var lastSeenId = 0;
  var baselined = false; // first poll only sets lastSeenId, no toasts -- see poll()

  function injectStyles() {
    var css = '' +
      '#whkToastStack{position:fixed;top:16px;right:16px;z-index:500;display:flex;flex-direction:column;gap:8px;pointer-events:none;max-width:320px}' +
      '.whkToast{pointer-events:auto;background:var(--card);border:1px solid var(--line);border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.16);' +
        'padding:10px 14px;cursor:pointer;font-size:12.5px;color:var(--ink);opacity:0;transform:translateX(12px);transition:opacity .18s ease,transform .18s ease}' +
      '.whkToast.whkIn{opacity:1;transform:translateX(0)}' +
      '.whkToast.whkOut{opacity:0;transform:translateX(12px)}' +
      '.whkToast .whkDot{display:inline-block;width:7px;height:7px;border-radius:999px;background:#22c55e;margin-right:7px}' +
      '.whkToast .whkTime{color:var(--muted);font-size:10.5px;margin-top:2px}' +
      '#whkOverlay{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:600;display:none;align-items:flex-start;justify-content:center;padding:60px 16px;overflow:auto}' +
      '#whkOverlay.whkShow{display:flex}' +
      '#whkPanel{background:var(--card);border-radius:14px;max-width:560px;width:100%;padding:20px;color:var(--ink)}' +
      '#whkPanel h3{margin:0 0 2px;font-size:15px}' +
      '#whkPanel .whkMeta{color:var(--muted);font-size:12px;margin-bottom:14px}' +
      '#whkPanel table{width:100%;border-collapse:collapse;font-size:12px}' +
      '#whkPanel th{text-align:left;color:var(--muted);font-weight:600;padding:5px 8px;border-bottom:1px solid var(--line)}' +
      '#whkPanel td{padding:5px 8px;border-bottom:1px solid var(--line);word-break:break-word}' +
      '#whkPanel .whkEmpty{color:var(--muted);font-size:12.5px;padding:8px 0}' +
      '#whkPanel .whkClose{float:right;background:none;border:none;color:var(--muted);font-size:18px;cursor:pointer;line-height:1}';
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }

  function injectDom() {
    var stack = document.createElement('div');
    stack.id = 'whkToastStack';
    document.body.appendChild(stack);

    var overlay = document.createElement('div');
    overlay.id = 'whkOverlay';
    overlay.innerHTML = '<div id="whkPanel"><button class="whkClose" id="whkCloseBtn" aria-label="Close">&times;</button><div id="whkPanelBody"></div></div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeDetail(); });
    document.getElementById('whkCloseBtn').addEventListener('click', closeDetail);

    return stack;
  }

  function closeDetail() {
    document.getElementById('whkOverlay').classList.remove('whkShow');
  }

  function fmtTime(iso) {
    try { return new Date(iso).toLocaleTimeString(); } catch (e) { return iso; }
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function openDetail(entry) {
    var body = document.getElementById('whkPanelBody');
    var html = '<h3>' + esc(entry.summary) + '</h3>' +
      '<div class="whkMeta">' + esc(entry.path) + ' &middot; ' + esc(new Date(entry.receivedAt).toLocaleString()) +
      (entry.status != null ? ' &middot; status ' + esc(entry.status) : '') + '</div>';

    var d = entry.display || {};
    if (Array.isArray(d.items) && d.items.length) {
      var cols = [];
      d.items.forEach(function (it) {
        Object.keys(it).forEach(function (k) { if (cols.indexOf(k) < 0) cols.push(k); });
      });
      html += '<div style="overflow:auto;max-height:50vh"><table><thead><tr>' +
        cols.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        d.items.map(function (it) {
          return '<tr>' + cols.map(function (c) { return '<td>' + esc(it[c]) + '</td>'; }).join('') + '</tr>';
        }).join('') + '</tbody></table></div>';
    } else if (Array.isArray(d.items)) {
      html += '<div class="whkEmpty">No items in this payload.</div>';
    } else {
      html += '<div class="whkEmpty">Metadata only for this source' +
        (d.itemCount != null ? ' &mdash; ' + esc(d.itemCount) + ' item' + (d.itemCount === 1 ? '' : 's') : '') +
        '. Payload fields aren\'t shown here until they\'re confirmed safe to display.</div>';
    }
    body.innerHTML = html;
    document.getElementById('whkOverlay').classList.add('whkShow');
  }

  function showToast(stack, entry) {
    var el = document.createElement('div');
    el.className = 'whkToast';
    el.innerHTML = '<div><span class="whkDot"></span>' + esc(entry.summary) + '</div><div class="whkTime">' + esc(fmtTime(entry.receivedAt)) + '</div>';
    el.addEventListener('click', function () { openDetail(entry); });
    stack.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('whkIn'); });

    setTimeout(function () {
      el.classList.remove('whkIn');
      el.classList.add('whkOut');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 220);
    }, TOAST_MS);
  }

  function poll(stack) {
    fetch('/api/recent-webhooks?after=' + lastSeenId)
      .then(function (r) { if (!r.ok) throw new Error('not ok'); return r.json(); })
      .then(function (d) {
        var entries = d.entries || [];
        if (!baselined) {
          // Don't flood a fresh page load with everything that happened
          // before this admin started watching -- only genuinely new
          // arrivals get a toast.
          baselined = true;
          lastSeenId = d.latestId || lastSeenId;
          return;
        }
        entries.forEach(function (entry) {
          lastSeenId = Math.max(lastSeenId, entry.id);
          showToast(stack, entry);
        });
      })
      .catch(function () { /* a missed poll just tries again in POLL_MS -- not worth surfacing */ });
  }

  window.apiMe()
    .then(function (me) {
      if (me.role !== 'admin') return; // server already 403s; this just avoids pointless polling/console noise
      injectStyles();
      var stack = injectDom();
      poll(stack);
      setInterval(function () { poll(stack); }, POLL_MS);
    })
    .catch(function () { /* unauthenticated -- already at the login page */ });
})();
