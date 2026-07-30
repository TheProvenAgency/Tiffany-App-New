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

    // Enter in the global search runs showView('clients') + loadClients(),
    // which an employee may not call. The server refuses it correctly, but the
    // user would land on an empty Clients view with no explanation.
    var search = document.getElementById('globalSearch');
    if (search) search.style.display = 'none';

    // The date range bar drives loadDashboard() — same problem.
    Array.prototype.forEach.call(document.querySelectorAll('.filters'), function (f) {
      if (!f.closest('#view-production')) f.style.display = 'none';
    });

    // Creating a client also creates a real GoHighLevel contact — server
    // rejects it from an employee (POST /api/clients is not in
    // EMPLOYEE_API), so don't show a button that would only fail.
    var addClient = document.getElementById('addClientBtn');
    if (addClient) addClient.style.display = 'none';
  }

  // production.js injects its own nav button, so wait for it to appear.
  // The sidebar is a two-tier icon-rail + expandable-panel: an icon rail
  // (.railbtn, one per group) always visible on the far left, plus a panel
  // of grouped .navgroup containers (Overview/Clients/Production/Finance/
  // Marketing/Account). An employee gets Deal Production and Follow-Ups
  // (both live under Production, and both are in EMPLOYEE_API -- see
  // lib/auth.js), so this has to hide every button/rail-icon across every
  // group except those two, not just the one #nav held back when the
  // sidebar was a single flat list.
  var EMPLOYEE_NAV_BTNS = ['pvNavBtn', 'fuNavBtn'];
  function gateNav() {
    var prodBtn = document.getElementById('pvNavBtn');
    if (!prodBtn) return false;

    Array.prototype.forEach.call(document.querySelectorAll('.navgroup button'), function (b) {
      if (EMPLOYEE_NAV_BTNS.indexOf(b.id) === -1) b.style.display = 'none';
    });
    // A group heading with nothing left visible under it just reads as a
    // dangling label ("Finance" over a blank box) -- hide those too.
    Array.prototype.forEach.call(document.querySelectorAll('.sec[data-g]'), function (heading) {
      if (heading.dataset.g !== 'pr') heading.style.display = 'none';
    });
    // Same idea for the icon rail: an employee has nothing to see under
    // any group but Production, so don't offer icons that only lead to a
    // blank panel.
    Array.prototype.forEach.call(document.querySelectorAll('.railbtn[data-g]'), function (rb) {
      if (rb.dataset.g !== 'pr') rb.style.display = 'none';
    });
    if (typeof window.setNavGroup === 'function') window.setNavGroup('pr', false);
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

      // Shown only for a session that arrived via the Proven Agency's
      // admin-only SSO link-out -- Tiffany and her employees log in here
      // directly and have nowhere to "go back" to, so they never see it.
      if (me.viaSso) {
        var back = document.getElementById('backToProvenBtn');
        if (back) back.style.display = '';
      }

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
