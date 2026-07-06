// Demo dataset seeded with the REAL shape of Tiffany's business from the July 2026
// operations audit: 3,512 Fanbasis clients, 939 active, ~$360.4K collected,
// rounds 2-8 distribution, deal mix (full-repair, 1-month, unlimited, quick-fix,
// sweeps, 1-round). Used until live API keys are connected, so every chart works.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEALS = [
  { key: 'full-repair', price: 497, weight: 0.22 },
  { key: 'unlimited', price: 297, weight: 0.14 },
  { key: '3-rounds', price: 225, weight: 0.16 },
  { key: '1-month', price: 99, weight: 0.18 },
  { key: '1-round', price: 75, weight: 0.16 },
  { key: 'quick-fix', price: 50, weight: 0.08 },
  { key: 'sweeps', price: 150, weight: 0.06 }
];

const FIRST = ['Amanda','Lashonda','LaRue','Keisha','Marcus','Tamika','Darnell','Jasmine','Andre','Brittany','Terrence','Shanice','Devon','Latoya','Malik','Ebony','Jerome','Kiara','Reggie','Monique','Tyrone','Alexis','Cedric','Danielle','Isaiah','Crystal','Damon','Tasha','Quincy','Nia','Rashad','Imani','Corey','Vanessa','Dominique','Angela','Maurice','Tiara','Lamar','Jada'];
const LAST = ['Ratcliff','Davidson','Taylor','Johnson','Williams','Brown','Jones','Davis','Miller','Wilson','Moore','Jackson','Martin','Lee','Thompson','White','Harris','Clark','Lewis','Robinson','Walker','Young','Allen','King','Wright','Scott','Green','Baker','Adams','Nelson','Hill','Carter','Mitchell','Perez','Roberts','Turner','Phillips','Campbell','Parker','Evans'];

function pickDeal(r) {
  let x = r(), acc = 0;
  for (const d of DEALS) { acc += d.weight; if (x <= acc) return d; }
  return DEALS[0];
}

function build() {
  const rand = mulberry32(20260706);
  const now = new Date('2026-07-06T12:00:00Z');
  const clients = [];
  const payments = [];
  const N = 3512;

  for (let i = 0; i < N; i++) {
    const deal = pickDeal(rand);
    // join date spread over 30 months, weighted toward recent (business growing)
    const monthsAgo = Math.floor(Math.pow(rand(), 1.6) * 30);
    const joined = new Date(now); joined.setMonth(joined.getMonth() - monthsAgo);
    joined.setDate(1 + Math.floor(rand() * 27));

    const nPay = 1 + Math.floor(rand() * (deal.key === 'unlimited' ? 6 : deal.key === 'full-repair' ? 4 : 3));
    let total = 0, last = null;
    for (let p = 0; p < nPay; p++) {
      const at = new Date(joined); at.setDate(at.getDate() + p * (20 + Math.floor(rand() * 25)));
      if (at > now) break;
      const amt = Math.round(deal.price * (0.85 + rand() * 0.3));
      total += amt; last = at;
      payments.push({ type: 'payment', at: at.toISOString(), amount: amt, product: deal.key, email: `client${i}@demo.com` });
    }
    if (!last) { last = joined; total = deal.price; payments.push({ type: 'payment', at: joined.toISOString(), amount: deal.price, product: deal.key, email: `client${i}@demo.com` }); }

    // active window by product (mirrors the refined active-status logic)
    const windowDays = { 'full-repair': 150, unlimited: 120, '3-rounds': 110, '1-month': 45, '1-round': 40, 'quick-fix': 30, sweeps: 60 }[deal.key];
    const daysSince = (now - last) / 86400000;
    const active = daysSince <= windowDays;
    const round = active ? String(2 + Math.floor(Math.pow(rand(), 1.4) * 7)) : null;

    clients.push({
      id: 'demo-' + i,
      name: FIRST[Math.floor(rand() * FIRST.length)] + ' ' + LAST[Math.floor(rand() * LAST.length)],
      email: `client${i}@demo.com`,
      phone: '+1601555' + String(1000 + Math.floor(rand() * 8999)),
      createdAt: joined.toISOString(),
      status: active ? 'active' : 'inactive',
      round,
      deal: deal.key,
      totalSpent: total,
      lastPaymentDate: last.toISOString(),
      numberOfPayments: payments.filter(p => p.email === `client${i}@demo.com`).length,
      tags: ['status:' + (active ? 'active' : 'inactive'), 'deal:' + deal.key].concat(round ? ['round:' + round] : [])
    });
  }

  // scale payment amounts so lifetime total ≈ $360,440 (audit figure)
  const sum = payments.reduce((s, p) => s + p.amount, 0);
  const k = 360440 / sum;
  for (const p of payments) p.amount = Math.round(p.amount * k * 100) / 100;
  for (const c of clients) c.totalSpent = Math.round(c.totalSpent * k * 100) / 100;

  // SMS events: inbound/outbound daily volume for last 24 months
  const sms = [];
  for (let d = 730; d >= 0; d--) {
    const day = new Date(now); day.setDate(day.getDate() - d);
    const dow = day.getDay();
    const base = dow === 0 || dow === 6 ? 14 : 38;
    const growth = 1 + (730 - d) / 900;
    const inbound = Math.round(base * growth * (0.7 + rand() * 0.6));
    const outbound = Math.round(inbound * (1.4 + rand() * 0.5));
    sms.push({ date: day.toISOString().slice(0, 10), in: inbound, out: outbound });
  }

  // follower snapshots: last 24 months, steady growth
  const snapshots = [];
  let ig = 8200, fb = 4900;
  for (let d = 730; d >= 0; d--) {
    const day = new Date(now); day.setDate(day.getDate() - d);
    ig += Math.round(rand() * 14 + 3); fb += Math.round(rand() * 7 + 1);
    if (d % 1 === 0) snapshots.push({ date: day.toISOString().slice(0, 10), igFollowers: ig, fbFollowers: fb });
  }

  return { clients, payments, sms, snapshots };
}

let cache = null;
function demoData() { if (!cache) cache = build(); return cache; }

module.exports = { demoData };
