// Applies the signed-in role to the interface, and wires the Admin-only
// "View as Employee" preview toggle.
//
// This is presentation only. The real boundary is server-side in lib/auth.js —
// if an employee (or a previewing Admin — see req.effectiveRole in server.js)
// bypassed this file entirely they would still get 403 from every route and
// asset they may not use. This exists so the app doesn't show them buttons
// that would only fail.
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

    // Global search + the date-range filter bar both drive admin-only pages
    // (Dashboard, and a Clients search that also reaches payment fields) --
    // out of scope for the Team Dashboard's narrower Clients view, so this
    // stays hidden even though Clients itself is now reachable.
    var search = document.getElementById('globalSearch');
    if (search) search.style.display = 'none';
    Array.prototype.forEach.call(document.querySelectorAll('.filters'), function (f) {
      if (!f.closest('#view-production')) f.style.display = 'none';
    });

    // Creating a client also creates a real GoHighLevel contact — server
    // rejects it from an employee (POST /api/clients is not in
    // EMPLOYEE_API), so don't show a button that would only fail.
    var addClient = document.getElementById('addClientBtn');
    if (addClient) addClient.style.display = 'none';
  }

  // The sidebar is a two-tier icon-rail + expandable panel: an icon rail
  // (.railbtn, one per group) always visible on the far left, plus a panel
  // of grouped .navgroup containers (Overview/Clients/Production/Finance/
  // Marketing/Account). The Employee nav (per the 2026-08-05 Company vs Team
  // Dashboard spec, revised the same day to add Pipeline + Follow-Ups back,
  // then to drop the full Deal Production nav item) spans several of those
  // groups now instead of living in just one: Team Dashboard (Overview),
  // Pipeline + New Clients + Clients (Clients group -- Pipeline is the same
  // top-level revenue-by-round board Admin sees, identical and unredacted,
  // per explicit request; New Clients is Deal Production's own
  // pvNewClientsBtn, a locked/filtered queue -- the full, unrestricted Deal
  // Production nav item (pvNavBtn) itself stays Admin-only, deliberately
  // NOT in this list even though GET/PATCH /api/production still has to
  // stay in EMPLOYEE_API since New Clients and the Team Dashboard drawer
  // both read it), Follow-Ups + Messages (Production group), Change
  // password + Sign out (Account group). Finance and Marketing stay fully
  // hidden, same as before.
  var ALLOWED_GROUPS = { ov: 1, cl: 1, pr: 1, ac: 1 };
  var ALLOWED_IDS = {
    teamNavBtn: 1, pipelineNavBtn: 1, pvNewClientsBtn: 1, clientsNavBtn: 1,
    fuNavBtn: 1, msgNavBtn: 1, changePwNavBtn: 1, signOutNavBtn: 1
  };
  function gateNav() {
    // teamNavBtn only exists once team.js's own /api/me check has resolved
    // and injected it (see public/team.js) -- that's the async part; the
    // rest (pvNavBtn, clientsNavBtn) are created synchronously on page load
    // and are always present by the time this is even worth checking.
    if (!document.getElementById('teamNavBtn')) return false;

    Array.prototype.forEach.call(document.querySelectorAll('.navgroup button'), function (b) {
      if (!ALLOWED_IDS[b.id]) b.style.display = 'none';
    });
    // A group heading with nothing left visible under it just reads as a
    // dangling label ("Finance" over a blank box) -- hide those too.
    Array.prototype.forEach.call(document.querySelectorAll('.sec[data-g]'), function (heading) {
      if (!ALLOWED_GROUPS[heading.dataset.g]) heading.style.display = 'none';
    });
    // Same idea for the icon rail: no reason to offer an icon that only
    // leads to a blank panel.
    Array.prototype.forEach.call(document.querySelectorAll('.railbtn[data-g]'), function (rb) {
      if (!ALLOWED_GROUPS[rb.dataset.g]) rb.style.display = 'none';
    });
    if (typeof window.setNavGroup === 'function') window.setNavGroup('ov', false);
    if (typeof window.showView === 'function') window.showView('team');
    return true;
  }

  function retry(fn, tries) {
    tries = tries || 0;
    if (fn() || tries > 60) return; // give up after ~3s rather than spin forever
    setTimeout(function () { retry(fn, tries + 1); }, 50);
  }

  // Admin-only "View as Employee" preview control (header, next to the
  // theme toggle) + the "Viewing as Employee" banner shown while it's on.
  // Both elements start hidden in index.html; this is the only place that
  // ever reveals them, and only for the account's REAL role, never the
  // effective one -- an Employee must never see either.
  function wirePreviewToggle(me) {
    var toggleBtn = document.getElementById('viewAsEmployeeBtn');
    var banner = document.getElementById('previewBanner');
    var exitLink = document.getElementById('exitPreviewBtn');
    if (me.realRole !== 'admin') return; // Employees get neither control.

    if (me.previewing) {
      if (banner) banner.style.display = '';
      if (exitLink) exitLink.onclick = function (e) {
        e.preventDefault();
        fetch('/api/preview/stop', { method: 'POST' }).then(function () { location.reload(); });
      };
    } else {
      if (toggleBtn) {
        toggleBtn.style.display = '';
        toggleBtn.onclick = function () {
          fetch('/api/preview/start', { method: 'POST' }).then(function () { location.reload(); });
        };
      }
    }
  }

  fetch('/api/me')
    .then(function (r) { return r.json(); })
    .then(function (me) {
      // data-role reflects the EFFECTIVE role (real, or the "View as
      // Employee" preview) -- every CSS/JS check keyed off it already
      // behaves correctly during a preview with no extra code, e.g. the
      // #dStage lock rule below.
      document.body.setAttribute('data-role', me.role);
      wirePreviewToggle(me);

      // Shown only for a session that arrived via the Proven Agency's
      // admin-only SSO link-out -- Tiffany and her employees log in here
      // directly and have nowhere to "go back" to, so they never see it.
      if (me.viaSso) {
        var back = document.getElementById('backToProvenBtn');
        if (back) back.style.display = '';
      }

      if (me.role === 'admin') {
        // Loaded only for a real (non-previewing) admin: the file has
        // balances hardcoded in it, and an effective employee gets 403 for
        // it, which would log a console error.
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
