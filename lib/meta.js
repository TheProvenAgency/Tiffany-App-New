// Meta Graph API — Facebook Page + Instagram Business follower counts.
// Needs a Page access token with pages_read_engagement + instagram_basic,
// the Facebook Page ID, and the Instagram Business Account ID.
const GRAPH = 'https://graph.facebook.com/v21.0';

async function graphGet(path, params) {
  const url = `${GRAPH}/${path}?${new URLSearchParams(params).toString()}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error('Meta: ' + data.error.message);
  return data;
}

async function getFollowers(cfg) {
  const out = { fbFollowers: null, fbFans: null, igFollowers: null, igMediaCount: null };
  if (cfg.metaPageToken && cfg.fbPageId) {
    try {
      const p = await graphGet(cfg.fbPageId, { fields: 'followers_count,fan_count,name', access_token: cfg.metaPageToken });
      out.fbFollowers = p.followers_count ?? null;
      out.fbFans = p.fan_count ?? null;
      out.fbName = p.name;
    } catch (e) { out.fbError = e.message; }
  }
  if (cfg.metaPageToken && cfg.igUserId) {
    try {
      const ig = await graphGet(cfg.igUserId, { fields: 'followers_count,media_count,username', access_token: cfg.metaPageToken });
      out.igFollowers = ig.followers_count ?? null;
      out.igMediaCount = ig.media_count ?? null;
      out.igUsername = ig.username;
    } catch (e) { out.igError = e.message; }
  }
  return out;
}

module.exports = { getFollowers };
