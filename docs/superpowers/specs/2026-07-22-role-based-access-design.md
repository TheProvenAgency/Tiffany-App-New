# Role-Based Access: Admin and Employee Logins

**Date:** 2026-07-22
**Status:** Implemented and deployed 2026-07-22 (57 tests)

Delivered as designed, with three changes made during implementation:

- `notes` became admin-only; employees append via a `note` field the server
  attributes. A writable notes array would have let one employee delete or
  forge another's note, making server-side attribution pointless.
- Static assets needed gating, not just the API — `personal-finances.js`
  carries balances in its source. Recorded in section 3a.
- The `READ_ONLY` guard refuses visibly instead of returning a fake success.
  A silent no-op is the failure mode this whole design argues against.

Still open: the personal finance figures remain hardcoded in client source and
in git history, including in the `nikki-dashboard` copy.
`public/production-seed.json` (1.4 MB of client records) is referenced by no
code at all.

## Problem

The dashboard has one shared password. Everyone who logs in sees everything:
revenue, lifetime collected, every client, the GoHighLevel API keys, and the
personal finances tab.

Employees need to work the Deal Production page — the credit repair lead tracker
— without seeing any of the rest.

## Goals

- Two roles: **admin** (everything, as today) and **employee** (Deal Production only).
- Each employee gets their own login, so notes are attributed to a real person
  and one person can be revoked without disrupting the team.
- The boundary is enforced on the server. Hiding buttons is not access control.
- Multiple employees can edit leads at the same time without erasing each other.

## Non-goals

- Per-employee lead filtering. Every employee sees all leads.
- Any change to `nikki-dashboard`, which is a separate repository.
- Refactoring `public/index.html` beyond gating the navigation.
- More than two roles.

## Current state

**Authentication** (`server.js:18-48`)

The cookie is `sha256('msfs-dash-v1' + password)` — a value derived entirely
from what the client already knows. It proves the user knew *a* password and
carries no identity. The password itself comes from
`store.getConfig().appPassword`, falling back to `APP_PASSWORD`, then to the
literal `'msfs2026'`.

Middleware at `server.js:42` opens `/webhooks/*`, `/api/login`, `/login.html`,
and `/favicon.ico`, and gates everything else — including static assets, which
is correct and worth preserving.

**Deal Production** (`server.js:600-611`, `public/production.js`)

3,578 records in `public/production-seed.json`, persisted to
`production.json` under `DATA_DIR`. Fields: `id, name, pkg, stage, days, tu,
eq, ex, docs, va, notes`. No dollar amounts, which is why this page is safe to
expose.

`production.js:143-145` posts the **entire array** on every edit, debounced
500ms. `server.js:606` overwrites the whole file with it.

## Why concurrent editing must be fixed now

Whole-file overwrites are safe with one user and lossy with two:

1. Employee A loads all 3,578 records into the browser.
2. Employee B loads all 3,578 records.
3. A updates a client's Experian round and posts A's full array.
4. B adds a note to a different client and posts B's full array — which never
   contained A's change.
5. A's edit is gone. No error is shown to anyone.

This feature exists to add concurrent users, so shipping it without addressing
the write model would ship a data-loss bug.

## Design

### 1. Accounts

`store.getConfig()` gains a `users` array:

```
{ id, username, name, role: 'admin' | 'employee', passHash, salt, disabled, createdAt }
```

Passwords are hashed with `crypto.scrypt` and a per-user random salt, replacing
the single hardcoded `'msfs-dash-v1'`.

**Migration:** on first boot after deploy, if `users` is absent, create one
admin from the existing `appPassword` with username `admin`. This guarantees
the current password still works and nobody is locked out.

### 2. Sessions

Login accepts username and password. On success the server generates 32 random
bytes and stores the session server-side:

```
{ token, userId, role, createdAt, expiresAt }
```

The cookie carries only the opaque token — `HttpOnly`, `SameSite=Lax`, 30-day
expiry, matching today's settings.

The role is never sent to the client as an authority. A role encoded in a
cookie is a role the client can edit; a role looked up server-side cannot be
forged.

Sessions persist to `DATA_DIR` so a Render restart does not sign everyone out.
Logout deletes the session. Disabling a user deletes all of theirs.

**Accepted cost:** the cookie format changes, so all existing sessions become
invalid on deploy and everyone signs in once more.

### 3. Authorization — deny by default

Middleware resolves `req.user` from the session, then applies an explicit
allowlist. Employees may reach:

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/me` | Own name and role |
| GET | `/api/production` | Read the lead tracker |
| PATCH | `/api/production/:id` | Update one lead |
| POST | `/api/logout` | Sign out |

Every other route returns **403** for employees, notably:

- `/api/config` — returns and sets the GoHighLevel token and app password
- `/api/dashboard` — revenue, lifetime collected, all KPIs
- `/api/clients`, `/api/pipeline`, `/api/reactivation`, `/api/tasks`, `/api/social`
- `POST /api/production` — bulk overwrite, admin-only for imports
- `/api/clients/:id/sms` and `/api/clients/:id/status` — write to live GoHighLevel

Deny-by-default means routes added later are closed to employees until
deliberately opened.

### 3a. Static assets must be gated too

Gating `/api/*` is not sufficient. `public/personal-finances.js` contains
financial figures hardcoded in the source — account balances and an income
value matching the Fanbasis figure from commit history. There is no API call to
block, because the file *is* the data. An authenticated employee could simply
request `/personal-finances.js` and read all of it.

Therefore the static handler becomes role-aware. Employees may load only:

- `index.html`, `production.js`, `logo.png`, and shared CSS
- **Denied:** `personal-finances.js`, and any future asset carrying data

Everything not on the employee asset allowlist returns 403 — again
deny-by-default, so a new data-bearing file is closed until opened.

Follow-up, outside this spec: those figures should move server-side behind an
admin-only endpoint rather than living in client source. Gating the file is the
correct fix for *this* feature, but the data is still in git history, including
in the `nikki-dashboard` copy.

### 4. Per-client writes

`PATCH /api/production/:id` accepts the changed fields for a single lead. The
server reads the file, merges that one record, and writes — behind an
in-process write lock, since Node serializes but the read-modify-write cycle
still interleaves across awaits.

Two employees editing different leads no longer collide. Two editing the *same*
lead resolve field-by-field rather than losing the whole record.

Note attribution is stamped server-side from the session, never accepted from
the request body, so an employee cannot post a note as someone else.

`POST /api/production` remains for bulk import, restricted to admin.

### 5. Field-level permissions

Not every field should be employee-editable. The default, to be confirmed:

- **Employees may edit:** `tu`, `eq`, `ex` (dispute rounds), `docs`
  (document checklist), `notes` (append only)
- **Admin only:** `stage` (moves a lead through the pipeline), `va`
  (reassigns ownership), `name`, `pkg`, `id`

This lives in one predicate function in `server.js` so it can be changed in one
place. The `PATCH` handler rejects disallowed fields with 403 rather than
silently dropping them — a silent drop would look like a save that worked.

### 6. Frontend

`GET /api/me` returns `{name, role}`. On boot, `index.html` hides navigation
buttons the role cannot use; employees land on Deal Production. Settings shows
only password change for employees.

This is presentation only. The server is the boundary.

### 7. Admin user management

Settings gains a Users panel: list, add, set role, reset password, disable.
Admins cannot disable or demote their own account, which prevents locking the
last admin out.

## Testing

Automated, not manual clicking. The security claims must be asserted:

1. An employee session receives 403 from `/api/dashboard`, `/api/clients`,
   `/api/config`, and `POST /api/production`.
2. An employee session receives 200 from `GET /api/production` and a permitted
   `PATCH`.
3. A `PATCH` touching `stage` is rejected for an employee, accepted for an admin.
4. A forged or altered cookie is rejected.
5. Two interleaved `PATCH`es to different leads both persist.
6. Migration: a config with `appPassword` and no `users` yields a working admin
   login.
7. A disabled user's existing session stops working.
8. An employee session receives 403 for `GET /personal-finances.js`, and 200
   for `GET /production.js`.

## Risks

| Risk | Mitigation |
|---|---|
| Locking Tiffany out | Migrate `appPassword` to an admin account; verify login before pushing |
| Everyone signed out on deploy | Expected and one-time; tell the team beforehand |
| Employee reaches a route we forgot | Deny-by-default closes unknown routes automatically |
| Employee reads data from a static file | Asset allowlist; `personal-finances.js` denied explicitly |
| Live GoHighLevel writes during testing | Develop against demo mode; `READ_ONLY` guard still pending |
| Production data corrupted while testing | Back up `production.json` before deploying |

## Rollout

Build on a branch, not `main`, since pushing to `main` deploys to
`msfs-dashboard.onrender.com` where the team is working. Merge once the tests
pass and admin login is verified locally.
