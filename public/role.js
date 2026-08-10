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
  var HOME = { view: 'team', waitFor: 'teamNavBtn', group: 'ov' };
  var ALLOWED_IDS = {
    teamNavBtn: 1, pipelineNavBtn: 1, pvNewClientsBtn: 1, clientsNavBtn: 1,
    fuNavBtn: 1, msgNavBtn: 1, changePwNavBtn: 1, signOutNavBtn: 1,
    // A disputer's only view. Without this the nav filter hid the one button
    // their whole job runs through.
    disputesNavBtn: 1
  };
  function gateNav() {
    // teamNavBtn only exists once team.js's own /api/me check has resolved
    // and injected it (see public/team.js) -- that's the async part; the
    // rest (pvNavBtn, clientsNavBtn) are created synchronously on page load
    // and are always present by the time this is even worth checking.
    // Which button marks "this worker's modules have finished injecting"
    // depends on what they can reach. This used to wait unconditionally for
    // teamNavBtn, which a disputer never gets -- so gateNav simply never ran
    // for them: full unfiltered nav, and a landing on a Dashboard the server
    // refuses. HOME is set from capabilities just below.
    if (!document.getElementById(HOME.waitFor)) return false;

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
    if (typeof window.setNavGroup === 'function') window.setNavGroup(HOME.group, false);
    if (typeof window.showView === 'function') window.showView(HOME.view);
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
      // Name the role actually being previewed -- with four presets, a banner
      // that always says "Employee" is worse than none.
      var rn = document.getElementById('previewRoleName');
      if (rn) rn.textContent = ({ va: 'a VA', disputer: 'a Disputer', employee: 'an Employee' })[me.role] || me.role;
      if (exitLink) exitLink.onclick = function (e) {
        e.preventDefault();
        fetch('/api/preview/stop', { method: 'POST' }).then(function () { location.reload(); });
      };
    } else {
      if (toggleBtn) {
        toggleBtn.style.display = '';
        toggleBtn.onchange = function () {
          var role = toggleBtn.value;
          if (!role) return;
          fetch('/api/preview/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: role })
          }).then(function (r) {
            if (!r.ok) { toggleBtn.value = ''; return; }
            location.reload();
          });
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
      // Capabilities are what the server actually gates on (lib/auth.js), so
      // the UI reads the same list rather than re-deriving it from the role
      // name -- a per-user override would otherwise be invisible here.
      // Presentation only; the boundary is still server-side.
      window.__me = me;
      var pill = document.getElementById('modePill');
      if (pill && me.mode) pill.textContent = me.mode === 'live' ? 'LIVE' : 'DEMO';
      var caps = Array.isArray(me.capabilities) ? me.capabilities : [];
      var can = function (c) { return caps.indexOf(c) >= 0; };
      document.body.setAttribute('data-caps', caps.join(' '));
      wirePreviewToggle(me);

      // Shown only for a session that arrived via the Proven Agency's
      // admin-only SSO link-out -- Tiffany and her employees log in here
      // directly and have nowhere to "go back" to, so they never see it.
      if (me.viaSso) {
        var back = document.getElementById('backToProvenBtn');
        if (back) back.style.display = '';
      }

      if (can('revenue')) {
        // Loaded only for someone who actually holds the money capability:
        // the file has balances hardcoded in it, and anyone else gets a 403
        // for it, which would only log a console error.
        var pf = document.createElement('script');
        pf.src = '/personal-finances.js';
        document.body.appendChild(pf);
      }

      if (me.role === 'admin') return;

      // The server rejects a stage change from anyone without the production
      // capability, so don't offer the control — a rejected save looks
      // identical to a successful one. Keyed off data-caps rather than a role
      // name so it holds for every preset that lacks it.
      var st = document.createElement('style');
      st.textContent = 'body:not([data-caps~="production"]) #dStage{pointer-events:none;opacity:.55}';
      document.head.appendChild(st);

      // Where a worker lands, and which injected button proves their modules
      // are ready. A disputer has no Dashboard and no Team Dashboard, so
      // sending them to either is a blank screen or a 403.
      if (can('production')) HOME = { view: 'team', waitFor: 'teamNavBtn', group: 'ov' };
      else if (can('disputes')) HOME = { view: 'disputes', waitFor: 'disputesNavBtn', group: 'cl' };
      else HOME = { view: 'team', waitFor: 'teamNavBtn', group: 'ov' };

      hideAdminChrome();
      retry(gateNav);
    })
    .catch(function () { /* an unauthenticated user is already at the login page */ });
})();
