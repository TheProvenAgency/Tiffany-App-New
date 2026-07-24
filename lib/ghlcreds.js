// Validate and normalize GoHighLevel v2 credentials, so Settings can catch the
// mistakes that produce GHL's unhelpful errors — a v1 key pasted, a token
// dropped into the Location field, a whole URL pasted — before a call is made.

// Pull the location id out of whatever was pasted: a full sub-account URL
// (…/v2/location/<id>/…) or the bare id. Returns the trimmed input if there is
// nothing to extract.
function extractLocationId(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/\/location\/([A-Za-z0-9]+)/);
  return m ? m[1] : s;
}

// Is this the right KIND of token for the v2 API? pit- yes; a JWT (eyJ…) is a
// v1 key and will be rejected by v2 as "Invalid JWT".
function classifyToken(raw) {
  const t = String(raw || '').trim();
  if (!t) return { ok: false, kind: 'empty', message: 'No token saved yet — paste the token that starts "pit-".' };
  if (t.startsWith('pit-')) {
    // A full pit- token is 40 chars (pit- + a 36-char UUID). Anything much
    // shorter is a truncated copy that looks valid because of the prefix.
    if (t.length < 36) return { ok: false, kind: 'truncated', message: `This token looks incomplete (${t.length} characters; a full one is ~40). Recopy the whole token.` };
    return { ok: true, kind: 'v2', message: '' };
  }
  if (t.startsWith('eyJ')) return { ok: false, kind: 'v1', message: 'That is a v1 API key (starts "eyJ"). This app uses GHL v2 — paste the Private Integration token that starts "pit-".' };
  return { ok: false, kind: 'unknown', message: 'That does not look like a v2 Private Integration token — it should start "pit-".' };
}

// Does the location id look like an id, or is it actually a token / URL leftover?
function classifyLocationId(raw) {
  const id = String(raw || '').trim();
  if (!id) return { ok: false, message: 'No Location ID — paste it, or paste the whole sub-account URL and it will be extracted.' };
  if (id.startsWith('pit-') || id.startsWith('eyJ')) return { ok: false, message: 'That looks like a TOKEN, not a Location ID. The Location ID is the ~20-character code in the sub-account URL, after /location/.' };
  if (!/^[A-Za-z0-9]{15,30}$/.test(id)) return { ok: false, message: `That does not look like a Location ID (expected ~20 letters/numbers, got ${id.length}). It is the code in the sub-account URL after /location/.` };
  return { ok: true, message: '' };
}

module.exports = { extractLocationId, classifyToken, classifyLocationId };
