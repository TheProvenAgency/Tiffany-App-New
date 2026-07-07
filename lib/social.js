// Public follower counts — no Meta app/token needed.
// Reads the public profile pages and parses the follower count from meta tags.
// Used as fallback whenever a Meta Page token isn't configured.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function parseCount(s) {
  if (!s) return null;
  const m = String(s).replace(/,/g, '').match(/([\d.]+)\s*([KM]?)/i);
  if (!m) return null;
  let n = parseFloat(m[1]);
  if (/k/i.test(m[2])) n *= 1000;
  if (/m/i.test(m[2])) n *= 1000000;
  return Math.round(n);
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9' },
    redirect: 'follow'
  });
  if (!res.ok) throw new Error(url + ' -> ' + res.status);
  return res.text();
}

// Instagram: og:description = "12.3K Followers, 456 Following, 789 Posts - ..."
async function igFollowers(handle) {
  try {
    const html = await fetchHtml(`https://www.instagram.com/${handle}/`);
    const og = html.match(/<meta[^>]+(?:property="og:description"|name="description")[^>]+content="([^"]*)"/i)
      || html.match(/content="([^"]*Followers[^"]*)"/i);
    if (!og) return null;
    const m = og[1].match(/([\d.,]+\s*[KM]?)\s*Followers/i);
    return m ? parseCount(m[1]) : null;
  } catch { return null; }
}

// Facebook profile/page: meta description usually contains "X likes" / "X followers"
async function fbFollowers(pageUrl) {
  try {
    const html = await fetchHtml(pageUrl);
    const m = html.match(/([\d.,]+\s*[KM]?)\s*(?:followers|Follower)/i)
      || html.match(/([\d.,]+\s*[KM]?)\s*likes/i);
    return m ? parseCount(m[1]) : null;
  } catch { return null; }
}

async function publicCounts(cfg) {
  const [ig, fb] = await Promise.all([
    cfg.igHandle ? igFollowers(cfg.igHandle) : null,
    cfg.fbPageUrl ? fbFollowers(cfg.fbPageUrl) : null
  ]);
  return { igFollowers: ig, fbFollowers: fb, source: 'public' };
}

module.exports = { publicCounts };
