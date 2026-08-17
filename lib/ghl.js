// GoHighLevel API v2 client (LeadConnector).
// Auth: Private Integration Token (Settings > Private Integrations in the sub-account).
const BASE = 'https://services.leadconnectorhq.com';

function headers(cfg) {
  return {
    Authorization: 'Bearer ' + cfg.ghlToken,
    Version: '2021-07-28',
    'Content-Type': 'application/json',
    Accept: 'application/json'
  };
}

// Retry policy. GoHighLevel rate-limits, and the dashboard pulls many pages at
// once, so a transient 429 or 5xx should recover rather than fail the whole
// request. Overridable so tests run without real waits.
let RETRY = { tries: 3, baseDelayMs: 500, timeoutMs: 20000 };
function _setRetry(patch) { RETRY = { ...RETRY, ...patch }; }
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Turn an HTTP status into something a user can act on.
function classify(status) {
  if (status === 401 || status === 403) return { retryable: false, msg: 'GoHighLevel rejected the API token — check it in Settings' };
  if (status === 429) return { retryable: true, msg: 'GoHighLevel is rate-limiting — please retry in a moment' };
  if (status >= 500) return { retryable: true, msg: 'GoHighLevel is temporarily unavailable — please retry' };
  return { retryable: false, msg: `GoHighLevel request failed (${status})` };
}

async function ghlFetch(cfg, path, opts = {}) {
  let lastErr;
  for (let attempt = 0; attempt < RETRY.tries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), RETRY.timeoutMs);
    let res;
    try {
      res = await fetch(BASE + path, { ...opts, signal: ctrl.signal, headers: { ...headers(cfg), ...(opts.headers || {}) } });
    } catch (e) {
      // Network failure or our own timeout — both worth another try.
      lastErr = new Error(e.name === 'AbortError' ? 'GoHighLevel timed out' : 'Could not reach GoHighLevel');
      lastErr.retryable = true;
      await sleep(RETRY.baseDelayMs * Math.pow(2, attempt));
      continue;
    } finally {
      clearTimeout(timer);
    }

    if (res.ok) return res.json();

    const info = classify(res.status);
    const body = await res.text().catch(() => '');
    lastErr = new Error(info.msg);
    lastErr.status = res.status;
    lastErr.retryable = info.retryable;
    lastErr.detail = body.slice(0, 2000); // long enough to parse a duplicate-contact error body (see createContact)
    if (!info.retryable) throw lastErr; // an expired token will not fix itself

    const retryAfter = parseInt(res.headers.get('retry-after') || '', 10);
    await sleep(Number.isFinite(retryAfter) ? retryAfter * 1000 : RETRY.baseDelayMs * Math.pow(2, attempt));
  }
  throw lastErr;
}

// Custom field definitions: id -> normalized key (e.g. 'total_spent')
async function fieldMap(cfg) {
  try {
    const data = await ghlFetch(cfg, `/locations/${cfg.ghlLocationId}/customFields`);
    const map = {};
    for (const f of data.customFields || []) {
      const key = (f.fieldKey || f.key || f.name || '').toLowerCase().replace(/^contact\./, '').replace(/\s+/g, '_');
      map[f.id] = key;
    }
    return map;
  } catch { return {}; }
}

// Pull ALL contacts (paged). Returns normalized client records.
async function fetchAllContacts(cfg, onPage) {
  const idToKey = await fieldMap(cfg);
  const contacts = [];
  let searchAfter = null;
  for (let page = 0; page < 100; page++) { // hard cap 100 pages x 500 = 50k
    const body = {
      locationId: cfg.ghlLocationId,
      pageLimit: 500,
      ...(searchAfter ? { searchAfter } : {})
    };
    const data = await ghlFetch(cfg, '/contacts/search', { method: 'POST', body: JSON.stringify(body) });
    const batch = data.contacts || [];
    contacts.push(...batch);
    if (onPage) onPage(contacts.length, data.total);
    if (!batch.length || contacts.length >= (data.total || 0)) break;
    searchAfter = batch[batch.length - 1].searchAfter;
    if (!searchAfter) break;
  }
  return contacts.map(c => normalizeContact(c, idToKey));
}

function customField(c, keys, idToKey = {}) {
  const list = c.customFields || c.customField || [];
  for (const f of list) {
    const k = (idToKey[f.id] || f.key || f.fieldKey || f.name || '').toLowerCase().replace(/^contact\./, '').replace(/\s+/g, '_');
    if (keys.includes(k)) return f.value ?? f.field_value ?? null;
  }
  return null;
}

function normalizeContact(c, idToKey = {}) {
  const tags = (c.tags || []).map(t => String(t).toLowerCase());
  const tag = prefix => (tags.find(t => t.startsWith(prefix)) || '').slice(prefix.length) || null;
  return {
    id: c.id,
    name: [c.firstName || c.firstNameLowerCase, c.lastName || c.lastNameLowerCase].filter(Boolean).join(' ') || c.contactName || c.email || 'Unknown',
    email: c.email || null,
    phone: c.phone || null,
    createdAt: c.dateAdded || c.createdAt || null,
    tags,
    status: tags.includes('status:active') ? 'active' : (tags.includes('status:inactive') ? 'inactive' : 'unknown'),
    round: tag('round:'),
    deal: tag('deal:'),
    totalSpent: parseFloat(String(customField(c, ['total_spent', 'totalspent'], idToKey) ?? '').replace(/[$,]/g, '')) || 0,
    lastPaymentDate: customField(c, ['last_payment_date', 'lastpaymentdate'], idToKey),
    numberOfPayments: parseInt(customField(c, ['number_of_payments', 'numberofpayments'], idToKey)) || 0
  };
}

// Conversations search — used for SMS volume. Returns raw conversations.
async function fetchConversations(cfg, { limit = 100 } = {}) {
  const params = new URLSearchParams({
    locationId: cfg.ghlLocationId,
    limit: String(Math.min(limit, 100)),
    sort: 'desc',
    sortBy: 'last_message_date'
  });
  const data = await ghlFetch(cfg, '/conversations/search?' + params.toString());
  return data.conversations || [];
}

// Messages of one conversation (paged once, latest 100).
async function fetchMessages(cfg, conversationId) {
  const data = await ghlFetch(cfg, `/conversations/${conversationId}/messages?limit=100`);
  return (data.messages && data.messages.messages) || data.messages || [];
}

// ---- unified inbox: every channel GHL has connected for this sub-account
// (SMS, Email, and whatever's wired up as a Conversation Provider -- e.g.
// Facebook Messenger / Instagram DMs, since those show up as GHL conversation
// types once connected in Settings > Integrations, not a separate API) ----
const CHANNEL_LABELS = {
  SMS: 'SMS', EMAIL: 'Email', FACEBOOK: 'Facebook', INSTAGRAM: 'Instagram',
  WHATSAPP: 'WhatsApp', GMB: 'Google Business', LIVE_CHAT: 'Live Chat',
  CALL: 'Call', VOICEMAIL: 'Voicemail', REVIEW: 'Review', CUSTOM: 'Custom', ACTIVITY: 'Activity'
};
function normalizeChannel(raw) {
  const key = String(raw || '').toUpperCase().replace(/^TYPE_/, '').replace(/[^A-Z_]/g, '') || 'OTHER';
  return { key, label: CHANNEL_LABELS[key] || (key === 'OTHER' ? 'Other' : key.replace(/_/g, ' ')) };
}

function normalizeConversation(c) {
  const ch = normalizeChannel(c.lastMessageType || c.type);
  return {
    id: c.id,
    contactId: c.contactId || c.contact_id || null,
    name: c.fullName || c.contactName || c.contact_name
      || [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || c.phone || 'Unknown',
    email: c.email || null,
    phone: c.phone || null,
    channelKey: ch.key,
    channel: ch.label,
    lastBody: c.lastMessageBody || c.lastMessageBodyPreview || '',
    lastDirection: (c.lastMessageDirection || '').toLowerCase() || null,
    lastAt: c.lastMessageDate || c.dateUpdated || c.dateAdded || null,
    unread: Number(c.unreadCount || 0)
  };
}

function normalizeMessage(m) {
  const ch = normalizeChannel(m.messageType || m.type);
  return {
    id: m.id,
    body: m.body || m.message || '',
    direction: (m.direction || '').toLowerCase() || null,
    channelKey: ch.key,
    channel: ch.label,
    at: m.dateAdded || m.dateUpdated || null,
    status: m.status || null
  };
}

// All conversations across every connected channel, newest first, paged
// past GHL's 100-per-request cap using the same cursor shape contacts/search
// uses. If an older plan/response doesn't carry a cursor field, this just
// stops after one page rather than looping forever -- still covers "what's
// recent," which is what an inbox view needs most.
// max defaults high enough to mean "all of it": the whole history, not a
// recency window. 200 pages of 100 covers a 20,000-conversation book; the
// loop stops at the first short page anyway, so the cap only matters as a
// runaway guard.
async function fetchAllConversations(cfg, { max = 20000 } = {}) {
  const out = [];
  let startAfterDate = null, startAfter = null;
  for (let page = 0; page < Math.ceil(max / 100) && out.length < max; page++) {
    const params = new URLSearchParams({
      locationId: cfg.ghlLocationId, limit: '100', sort: 'desc', sortBy: 'last_message_date'
    });
    if (startAfterDate) params.set('startAfterDate', startAfterDate);
    if (startAfter) params.set('startAfter', startAfter);
    const data = await ghlFetch(cfg, '/conversations/search?' + params.toString());
    const batch = data.conversations || [];
    out.push(...batch);
    if (batch.length < 100) break;
    const last = batch[batch.length - 1];
    const nextDate = last.startAfterDate || last.lastMessageDate;
    const nextAfter = last.startAfter || last.id;
    if (!nextDate || (nextDate === startAfterDate && nextAfter === startAfter)) break; // no forward progress -- stop
    startAfterDate = nextDate; startAfter = nextAfter;
  }
  return out.slice(0, max).map(normalizeConversation);
}

// Only the unread conversations, however old. The recent-300 fetch above is
// what an inbox shows first, but unread threads older than the 300 newest
// conversations exist too -- GHL's own inbox counts them (90+) while a
// recency-capped fetch caught only the ones that happened to be recent (17).
// GHL's search filters on status=unread server-side, so paging this stays
// proportional to the unread backlog, not the whole history.
async function fetchUnreadConversations(cfg, { max = 500 } = {}) {
  const out = [];
  let startAfterDate = null, startAfter = null;
  for (let page = 0; page < 10 && out.length < max; page++) {
    const params = new URLSearchParams({
      locationId: cfg.ghlLocationId, limit: '100', sort: 'desc',
      sortBy: 'last_message_date', status: 'unread'
    });
    if (startAfterDate) params.set('startAfterDate', startAfterDate);
    if (startAfter) params.set('startAfter', startAfter);
    const data = await ghlFetch(cfg, '/conversations/search?' + params.toString());
    const batch = data.conversations || [];
    out.push(...batch);
    if (batch.length < 100) break;
    const last = batch[batch.length - 1];
    const nextDate = last.startAfterDate || last.lastMessageDate;
    const nextAfter = last.startAfter || last.id;
    if (!nextDate || (nextDate === startAfterDate && nextAfter === startAfter)) break;
    startAfterDate = nextDate; startAfter = nextAfter;
  }
  return out.slice(0, max).map(normalizeConversation);
}

// Flip a conversation's unread state IN GHL, so the app and GHL's own inbox
// can never disagree about it -- the app deliberately keeps no unread state
// of its own.
function setConversationUnread(cfg, conversationId, unread) {
  return ghlFetch(cfg, `/conversations/${conversationId}`, {
    method: 'PUT',
    body: JSON.stringify({ locationId: cfg.ghlLocationId, unreadCount: unread ? 1 : 0 })
  });
}

// Count inbound/outbound SMS per day across recent conversations (bounded work).
async function smsByDay(cfg, { maxConversations = 150 } = {}) {
  const convos = await fetchConversations(cfg, { limit: 100 });
  const slice = convos.slice(0, maxConversations);
  const days = {}; // date -> {in, out}
  for (const cv of slice) {
    try {
      const msgs = await fetchMessages(cfg, cv.id);
      for (const m of msgs) {
        const type = (m.messageType || m.type || '').toString().toUpperCase();
        if (!type.includes('SMS') && type !== 'TYPE_SMS' && type !== '1') continue;
        const at = m.dateAdded || m.dateUpdated;
        if (!at) continue;
        const d = new Date(at).toISOString().slice(0, 10);
        days[d] = days[d] || { in: 0, out: 0 };
        if ((m.direction || '').toLowerCase() === 'inbound') days[d].in++;
        else days[d].out++;
      }
    } catch { /* skip failed conversation */ }
  }
  return days;
}

// ---- write-back: tags / status ----
async function addTags(cfg, contactId, tags) {
  return ghlFetch(cfg, `/contacts/${contactId}/tags`, { method: 'POST', body: JSON.stringify({ tags }) });
}
async function removeTags(cfg, contactId, tags) {
  return ghlFetch(cfg, `/contacts/${contactId}/tags`, { method: 'DELETE', body: JSON.stringify({ tags }) });
}
async function setStatus(cfg, contactId, status) {
  // status: 'active' | 'inactive' — keeps tags consistent
  await addTags(cfg, contactId, ['status:' + status]);
  await removeTags(cfg, contactId, ['status:' + (status === 'active' ? 'inactive' : 'active')]).catch(() => {});
  return { ok: true };
}

// Our internal channel key (from normalizeChannel above, e.g. FACEBOOK,
// INSTAGRAM) doesn't always match what GHL's *send* endpoint expects as
// `type` -- reading and writing use slightly different vocabularies for the
// same two channels. Everything else already lines up.
const SEND_TYPE_MAP = { FACEBOOK: 'FB', INSTAGRAM: 'IG', LIVE_CHAT: 'Live_Chat', EMAIL: 'Email', WHATSAPP: 'WhatsApp' };
function toSendType(type) {
  const key = String(type || 'SMS').toUpperCase();
  return SEND_TYPE_MAP[key] || key;
}

// ---- send a message through GHL, on whatever channel a conversation uses ----
// One endpoint for every channel: SMS, Email, WhatsApp, GMB, FB, IG,
// Live_Chat, Custom. Email additionally wants a subject + html body; every
// other channel just wants `message`. Passing conversationId (when known)
// keeps the reply attached to the existing thread rather than GHL having to
// infer it from contactId + type alone.
async function sendMessage(cfg, { contactId, conversationId, type = 'SMS', message, subject } = {}) {
  const channelType = toSendType(type);
  const body = { type: channelType, message };
  if (contactId) body.contactId = contactId;
  if (conversationId) body.conversationId = conversationId;
  if (channelType === 'Email') {
    body.subject = subject || 'Message from Ms. Financial Solutions';
    body.html = message;
  }
  return ghlFetch(cfg, '/conversations/messages', { method: 'POST', body: JSON.stringify(body) });
}

// ---- send SMS through GHL ----
// Kept as its own function: the client-profile "send SMS" button (and its
// existing tests) call this directly with just (cfg, contactId, message).
async function sendSMS(cfg, contactId, message) {
  return sendMessage(cfg, { contactId, type: 'SMS', message });
}

// ---- create a new contact ----
// GoHighLevel rejects a contact whose email or phone already matches an
// existing one (statusCode 400, meta.contactId pointing at the existing
// record) rather than creating a duplicate. That's treated as a normal,
// expected outcome here -- not an error -- so the caller can say "this
// client is already in GoHighLevel" and link straight to them instead of
// surfacing a raw API failure.
async function createContact(cfg, { firstName, lastName, email, phone, tags } = {}) {
  const body = { locationId: cfg.ghlLocationId };
  if (firstName) body.firstName = firstName;
  if (lastName) body.lastName = lastName;
  if (email) body.email = email;
  if (phone) body.phone = phone;
  if (tags && tags.length) body.tags = tags;
  try {
    const data = await ghlFetch(cfg, '/contacts/', { method: 'POST', body: JSON.stringify(body) });
    return { duplicate: false, contact: normalizeContact(data.contact || data) };
  } catch (e) {
    if (e.status === 400 && e.detail) {
      let parsed = null;
      try { parsed = JSON.parse(e.detail); } catch { /* detail was truncated or not JSON */ }
      const existingId = parsed && parsed.meta && parsed.meta.contactId;
      if (existingId) return { duplicate: true, existingId, message: (parsed && parsed.message) || e.message };
    }
    throw e;
  }
}

// ---- update an existing contact's core fields (email/phone/name) ----
// Used e.g. when a client paid for something (like Mentorship, via Commas)
// under a different email than the one already on file in GoHighLevel --
// we correct/add the real email so the record reflects reality rather than
// leaving a silent mismatch.
async function updateContact(cfg, contactId, { firstName, lastName, email, phone } = {}) {
  const body = {};
  if (firstName) body.firstName = firstName;
  if (lastName) body.lastName = lastName;
  if (email) body.email = email;
  if (phone) body.phone = phone;
  const data = await ghlFetch(cfg, `/contacts/${contactId}`, { method: 'PUT', body: JSON.stringify(body) });
  return normalizeContact(data.contact || data);
}

async function testConnection(cfg) {
  const data = await ghlFetch(cfg, '/contacts/search', {
    method: 'POST',
    body: JSON.stringify({ locationId: cfg.ghlLocationId, pageLimit: 1 })
  });
  return { ok: true, totalContacts: data.total ?? (data.contacts || []).length };
}

module.exports = {
  fetchAllContacts, smsByDay, testConnection, addTags, removeTags, setStatus, sendSMS, sendMessage, createContact, updateContact,
  fetchConversations, fetchMessages, fetchAllConversations, fetchUnreadConversations, setConversationUnread, normalizeConversation, normalizeMessage,
  ghlFetch, _setRetry
};
