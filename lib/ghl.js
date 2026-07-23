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
    lastErr.detail = body.slice(0, 300);
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

// ---- send SMS through GHL ----
async function sendSMS(cfg, contactId, message) {
  return ghlFetch(cfg, '/conversations/messages', {
    method: 'POST',
    body: JSON.stringify({ type: 'SMS', contactId, message })
  });
}

async function testConnection(cfg) {
  const data = await ghlFetch(cfg, '/contacts/search', {
    method: 'POST',
    body: JSON.stringify({ locationId: cfg.ghlLocationId, pageLimit: 1 })
  });
  return { ok: true, totalContacts: data.total ?? (data.contacts || []).length };
}

module.exports = { fetchAllContacts, smsByDay, testConnection, addTags, removeTags, setStatus, sendSMS, ghlFetch, _setRetry };
