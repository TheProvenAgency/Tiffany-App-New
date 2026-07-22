// Applies the signed-in role to the interface.
//
// This is presentation only. The real boundary is server-side in lib/auth.js —
// if an employee bypassed this file entirely they would still get 403 from
// every route and asset they may not use. This exists so the app doesn't show
// them buttons that would only fail.
(function () {
  function hideAdminChrome() {
    // Settings reads /api/config, which returns the GoHighLevel keys.
    var settings = document.querySelector('button[onclick*="openSettings"]');
    if (settings) settings.style.display = 'none';

    var sources = document.getElementById('sources');
    if (sources) {
      sources.style.display = 'none';
      var heading = sources.previousElementSibling;
      if (heading && heading.className === 'sec') heading.style.display = 'none';
    }
  }

  // production.js injects its own nav button, so wait for it to appear.
  function gateNav() {
    var nav = document.getElementById('nav');
    var prodBtn = document.getElementById('pvNavBtn');
    if (!nav || !prodBtn) return false;

    Array.prototype.forEach.call(nav.querySelectorAll('button'), function (b) {
      if (b.id !== 'pvNavBtn') b.style.display = 'none';
    });
    if (typeof window.showView === 'function') window.showView('production');
    return true;
  }

  function retry(fn, tries) {
    tries = tries || 0;
    if (fn() || tries > 60) return; // give up after ~3s rather than spin forever
    setTimeout(function () { retry(fn, tries + 1); }, 50);
  }

  fetch('/api/me')
    .then(function (r) { return r.json(); })
    .then(function (me) {
      document.body.setAttribute('data-role', me.role);

      if (me.role === 'admin') {
        // Loaded only for admins: the file has balances hardcoded in it, and
        // employees get 403 for it, which would log a console error.
        var s = document.createElement('script');
        s.src = '/personal-finances.js';
        document.body.appendChild(s);
        return;
      }

      // The server rejects a stage change from an employee, so don't offer the
      // control — a rejected save looks identical to a successful one.
      var s = document.createElement('style');
      s.textContent = 'body[data-role="employee"] #dStage{pointer-events:none;opacity:.55}';
      document.head.appendChild(s);

      hideAdminChrome();
      retry(gateNav);
    })
    .catch(function () { /* an unauthenticated user is already at the login page */ });
})();
