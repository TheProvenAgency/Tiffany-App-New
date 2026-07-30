# Ms. Financial Solutions — Business Command Center

One dashboard for Tiffany's whole business: **GoHighLevel** (clients, pipeline, SMS), **Fanbasis** (payments), **DisputeFox** (dispute rounds), and **Instagram / Facebook** follower growth.

Filters: Today · Yesterday · 7 Days · This Week · 30 Days · This Month · 90 Days · YTD · This Year · Last Year · All Time · any custom date range — grouped by day, week, month, or year.

It boots in **demo mode** (realistic sample data shaped like the real business: 3,512 clients, 939 active, ~$360K collected) so you can see everything working, then flips to **live mode** the moment you paste the GHL keys in ⚙ Settings.

---

## 1. Deploy (Render, free tier, ~5 minutes)

1. Push this folder to a GitHub repo (or use "Deploy from a public Git repo").
2. On [render.com](https://render.com): **New → Web Service** → pick the repo.
3. Settings: Runtime **Node**, Build `npm install`, Start `npm start`.
4. Add a **Persistent Disk** (1 GB) mounted at `/data`, and set env var `DATA_DIR=/data` — this keeps API keys, webhook history, and follower snapshots across restarts.
5. Optional env var: `APP_PASSWORD` (login password; default is `msfs2026` — change it in Settings after first login).

Railway/Fly.io work the same way. To run locally instead: `npm install && npm start` → http://localhost:3000

## 2. Connect the data sources (⚙ Settings in the app)

### GoHighLevel (clients, active/inactive, packages, rounds, payments, SMS)
GHL is the hub — the Fanbasis→GHL Zap from the operations audit already pushes Total Spent, Last Payment Date, # Payments, and `status:active` into GHL, and every contact carries `status:` / `deal:` / `round:` tags.

1. In the GHL **sub-account** (not agency level): Settings → **Private Integrations** → **Create new**.
2. Tick these scopes **at creation** — you cannot always add them later, and the app fails without the first one:
   - `contacts.readonly` ← required; the connection test reads contacts
   - `contacts.write` (status write-back), `conversations.readonly`, `conversations/message.readonly`, `conversations/message.write` (send SMS), `opportunities.readonly`
3. Copy the token the moment it's shown — it starts `pit-` and is **40 characters** (`pit-` + a 36-char UUID). Come back later and only the integration's *name/ID* is visible, not the token.
4. **Location ID**: the easiest, error-proof source is the sub-account URL — `…/v2/location/<THIS>/…`. You can paste the **whole URL** into the app's Location ID field; it extracts the id (~20 chars) for you.
5. Paste token + Location ID into ⚙ Settings → **Test GHL connection** (it saves automatically before testing).

**Uses GHL's v2 API only** (`services.leadconnectorhq.com`). A v1 API key (a long `eyJ…` JWT from Business Profile) will not work — it must be a `pit-` Private Integration token.

The Test button names the real problem instead of guessing. Common results:
- *"not authorized for this scope"* → the integration is missing `contacts.readonly`
- *"Invalid JWT"* → that's a v1 key; use the `pit-` token
- *"looks like a TOKEN, not a Location ID"* → the token got pasted into the Location field
- *"token looks incomplete"* → truncated copy; recopy the whole 40-char token

### Instagram + Facebook followers
1. [developers.facebook.com](https://developers.facebook.com) → create an app → add the **Facebook Login / Graph API** product.
2. Generate a **Page access token** for her page with `pages_read_engagement` and `instagram_basic` (page must be linked to her IG business account, @msfinancialsolutions_).
3. Get the **Page ID** and the **Instagram Business User ID** (Graph Explorer: `me/accounts` then `{page-id}?fields=instagram_business_account`).
4. Paste all three in Settings → **Test Meta connection**. The app snapshots follower counts every 6 hours to build the growth chart.

### Fanbasis / Commas payments (per-day revenue history + auto-onboarding)
Fanbasis (a.k.a. Commas — same payment platform, whichever name reads clearer
in your Zap/n8n) has no public API, but it has Zapier (already authorized as
msfinancialsolutions@outlook.com) or works fine from n8n's HTTP node.
Point a Zap or workflow — **New Sale → Webhooks (POST)** — at either of these
(identical behavior, just two names for the same route):
`https://YOUR-APP.onrender.com/webhooks/fanbasis?secret=YOUR_SECRET`
`https://YOUR-APP.onrender.com/webhooks/commas?secret=YOUR_SECRET`
with fields: `email`, `name`, `phone` (optional), `amount`, `product`, `sale_date`.

Every sale lands in the dashboard within seconds — and, in live mode, the
payer is now also created as a GoHighLevel contact (`status:active`) and
dropped into Deal Production under **Onboarding**, automatically, no second
Fanbasis→GHL Zap required. It's idempotent: a repeat sale for the same
person (GHL's own duplicate-contact detection, plus a check against the
existing Deal Production roster) just records the additional payment
without creating a second contact or a second Deal Production row. If GHL
write access isn't configured (demo mode) or `READ_ONLY=1` is set, only the
payment event itself is recorded, same as before. (Until 20+ payments have
landed, the revenue chart approximates from GHL last-payment data — flagged
"approx" on the KPI.)

### DisputeFox dispute activity
DisputeFox also exposes Zapier only (Settings → Email/SMS/Zapier → Zapier Configuration → Generate key).
Zap: **DisputeFox trigger (e.g. Round Sent) → Webhooks POST** to
`https://YOUR-APP.onrender.com/webhooks/disputefox?secret=YOUR_SECRET`
with `email`, `client_name`, `round`, `action`. Round distribution meanwhile comes live from the `round:` tags in GHL.

### Webhook secret
Set any random string in Settings, then append `?secret=THAT_STRING` to the Zapier webhook URLs.

## 3. Management features (beyond the dashboard)

- **Pipeline** — active clients as a board by dispute round (mirrors GHL Credit Repair Delivery), lifetime value per stage.
- **Client profiles** — click any client anywhere: payments, dispute activity, notes, open tasks, mark active/inactive (writes `status:` tags back to GHL live), send SMS through GHL.
- **Reactivation queue** — all lapsed clients sorted hottest-first (fewest days lapsed), work-tracking checkboxes.
- **Follow-Ups** — task list with due dates, per-client follow-ups, overdue highlighting.

## 4. What's on the dashboard

- **KPIs**: revenue in range, avg payment, lifetime collected, active / inactive / new clients, texts in & out, IG + FB followers with growth in period, disputes sent.
- **Charts**: revenue over time · payments & new clients · SMS in/out · follower growth · lifetime revenue by package · active clients by dispute round · churn recency · active-vs-inactive donut.
- **Clients table**: all 3,512 — search, filter by status/package/round, sort any column, paginated.
- Auto-refreshes every 5 minutes; ⟳ Refresh forces a re-pull; GHL data cached 10 min to respect rate limits.

## 5. Logins and roles

Two roles:

- **Admin** — everything, as before. Manage the team in ⚙ Settings → Team.
- **Employee** — the Deal Production tracker and nothing else. No revenue, no
  client list, no API keys, no personal finances.

Sign in with a **username and password**. Your existing password became the
`admin` account the first time this version booted, so it still works — just
add the username.

The boundary is enforced on the server and denies by default: an employee gets
403 from every route and asset not explicitly opened to them, so anything added
later is closed until someone opens it. Hiding buttons is only cosmetic.

## Developing locally

```
npm install
npm start          # http://localhost:3000, demo data
npm test           # 57 tests
```

Set `READ_ONLY=1` when running against real GoHighLevel credentials:

```
READ_ONLY=1 npm start
```

Two routes can change live GHL data — status write-back (tag edits on a real
contact) and sending an SMS (a real text to a real client). With `READ_ONLY=1`
both refuse visibly and log what they blocked, rather than pretending to
succeed. Leave it unset in production.

## Security notes
- Accounts use scrypt with a per-user salt. Session tokens are random and
  opaque; the role is looked up server-side, so a cookie cannot be edited to
  grant admin.
- Disabling a user cuts off their existing sessions immediately, not at cookie
  expiry. The last admin cannot be disabled or demoted.
- API keys live only on the server (masked in the UI). Never shared with the browser.
- Webhooks reject calls without the secret once one is set.
- `sessions.json` and `production.json` are gitignored: `DATA_DIR` is set on
  Render but falls back to the repo root locally.
