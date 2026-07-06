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

1. In the GHL **sub-account**: Settings → **Private Integrations** → New.
2. Scopes: `contacts.readonly`, `contacts.write` (status write-back), `conversations.readonly`, `conversations/message.readonly`, `conversations/message.write` (send SMS from the app), `opportunities.readonly`.
3. Copy the token (starts `pit-`) + the **Location ID** (Settings → Business Profile) into the app's Settings and hit **Test GHL connection**.

### Instagram + Facebook followers
1. [developers.facebook.com](https://developers.facebook.com) → create an app → add the **Facebook Login / Graph API** product.
2. Generate a **Page access token** for her page with `pages_read_engagement` and `instagram_basic` (page must be linked to her IG business account, @msfinancialsolutions_).
3. Get the **Page ID** and the **Instagram Business User ID** (Graph Explorer: `me/accounts` then `{page-id}?fields=instagram_business_account`).
4. Paste all three in Settings → **Test Meta connection**. The app snapshots follower counts every 6 hours to build the growth chart.

### Fanbasis payments (per-day revenue history)
Fanbasis has no public API — but it has Zapier (already authorized as msfinancialsolutions@outlook.com).
Add a second Zap: **FanBasis New Sale → Webhooks by Zapier (POST)** to
`https://YOUR-APP.onrender.com/webhooks/fanbasis?secret=YOUR_SECRET`
with fields: `email`, `name`, `amount`, `product`, `sale_date`. Every sale then lands in the dashboard within seconds. (Until that history builds up, the revenue chart approximates from GHL last-payment data — flagged "approx" on the KPI.)

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

## Security notes
- Login is password-gated (cookie). Change the password in Settings immediately.
- API keys live only on the server (masked in the UI). Never shared with the browser.
- Webhooks reject calls without the secret once one is set.
