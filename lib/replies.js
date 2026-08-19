// Conversations where the client spoke last and nobody has answered.
//
// This is the one operational SLA in the app with a clock that can be trusted:
// every conversation carries a real lastAt and lastDirection from GoHighLevel.
// The equivalent cards for dispute rounds cannot be built the same way -- the
// queue's days-in-stage reads 0 for all 1,231 rounds, and there are no dated
// dispute events to fall back on -- so rather than invent a clock there, this
// covers the surface where the timestamps are real.
//
// Scope note the caller must pass through to the UI: the conversation feed is
// capped (300 most recent), so counts describe recent conversations, not all
// history. Saying "83 waiting" when it is "83 of the last 300" would be a
// quietly different claim.

const DAY = 86400000;
const DEFAULT_SLA_DAYS = 2;

// Reactions are not questions. A "Loved a message" coming back as the last
// inbound event is not somebody waiting on a reply, and counting it would pad
// the queue with work that does not exist.
const NON_MESSAGE_CHANNELS = new Set(['SMS_REACTION']);

function hoursSince(iso, now) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return null;
  return Math.max(0, (now - t) / (DAY / 24));
}

function toRow(c, now, slaDays) {
  const hrs = hoursSince(c.lastAt, now);
  const days = hrs === null ? null : Math.floor(hrs / 24);
  return {
    id: c.id,
    contactId: c.contactId || null,
    name: c.name || '(no name)',
    channel: c.channel || c.channelKey || null,
    channelKey: c.channelKey || null,
    lastBody: (c.lastBody || '').slice(0, 140),
    lastAt: c.lastAt || null,
    waitingHours: hrs === null ? null : Math.round(hrs),
    waitingDays: days,
    unread: c.unread || 0,
    flagged: hrs !== null && hrs > slaDays * 24
  };
}

function buildQueue(conversations, opts) {
  opts = opts || {};
  const now = opts.now ? new Date(opts.now).getTime() : Date.now();
  const slaDays = opts.slaDays == null ? DEFAULT_SLA_DAYS : Number(opts.slaDays);
  const limit = opts.limit == null ? 12 : opts.limit;

  const dismissals = opts.dismissals || {};
  const rows = (conversations || [])
    .filter(c => c && c.lastDirection === 'inbound')
    .filter(c => !NON_MESSAGE_CHANNELS.has(c.channelKey))
    // "No reply needed" -- but only for the exact message it was clicked on.
    // A newer inbound message than the dismissal's means the client spoke
    // again, and the thread returns to the queue by itself.
    .filter(c => {
      const d = dismissals[c.id];
      return !(d && String(d.lastAt || '') === String(c.lastAt || ''));
    })
    .map(c => toRow(c, now, slaDays))
    // Longest wait first. An undated conversation cannot be ranked and must
    // not outrank a real one, so it sorts last.
    .sort((a, b) => {
      if (a.waitingHours === null && b.waitingHours === null) return 0;
      if (a.waitingHours === null) return 1;
      if (b.waitingHours === null) return -1;
      return b.waitingHours - a.waitingHours;
    });

  return {
    items: limit > 0 ? rows.slice(0, limit) : rows,
    totals: {
      waiting: rows.length,
      flagged: rows.filter(r => r.flagged).length,
      longestWaitHours: rows.length ? rows[0].waitingHours : null,
      slaDays: slaDays,
      // How many conversations were looked at, so the UI can say "of the last N"
      // rather than implying it searched everything.
      scanned: (conversations || []).length
    },
    generatedAt: new Date(now).toISOString()
  };
}

module.exports = { buildQueue, DEFAULT_SLA_DAYS, NON_MESSAGE_CHANNELS };
