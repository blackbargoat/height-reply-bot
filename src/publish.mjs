// GoPeak HQ pipeline -> Instagram Reels publisher. Runs in GitHub Actions every 15 min.
// Picks approved posts whose slot has arrived (rpc pipe_worker_due), publishes each as a Reel
// (trial reel when post.trial), and reports back (rpc pipe_worker_done). CHECK=1 only tests token access.
const GRAPH = "https://graph.instagram.com/v23.0";
const SB = "https://etdbjahwegsmuelcawgf.supabase.co/rest/v1/rpc/", SB_KEY = "sb_publishable_p8exB2dS5lpdz-p1chueJA_n9zRQdnG";
const PIPE_KEY = process.env.PIPE_KEY || "";
const TOKENS = Object.keys(process.env).filter((k) => /^IG_ACCESS_TOKEN(_\d+)?$/.test(k)).sort().map((k) => process.env[k]).filter(Boolean);
const CHECK = process.env.CHECK === "1", DRY = process.env.DRY_RUN === "1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ig(token, path, params = {}, method = "GET") {
  const q = new URLSearchParams({ ...params, access_token: token });
  const res = method === "GET" ? await fetch(`${GRAPH}/${path}?${q}`) : await fetch(`${GRAPH}/${path}`, { method, body: q });
  const j = await res.json();
  if (j.error) throw new Error(`${path}: ${j.error.message}`);
  return j;
}
async function rpc(fn, body) {
  const r = await fetch(SB + fn, { method: "POST", headers: { apikey: SB_KEY, "content-type": "application/json" }, body: JSON.stringify({ p_key: PIPE_KEY, ...body }) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${fn}: ${t}`);
  return t ? JSON.parse(t) : null;
}

async function accounts() {
  const out = {};
  for (const t of TOKENS) {
    try { const me = await ig(t, "me", { fields: "user_id,username" }); out[me.username] = { token: t, id: me.user_id }; }
    catch (e) { console.log("token failed:", e.message); }
  }
  return out;
}

async function publish(acct, post) {
  const params = { media_type: "REELS", video_url: post.video_url, caption: post.caption || "" };
  if (!post.trial) params.share_to_feed = "true"; // trial reels go to non-followers only, never the feed
  if (post.thumb_url) params.cover_url = post.thumb_url;
  // SS_PERFORMANCE: Instagram moves the trial reel to the feed by itself if it does well with non-followers
  if (post.trial) params.trial_params = JSON.stringify({ graduation_strategy: "SS_PERFORMANCE" });
  const c = await ig(acct.token, `${acct.id}/media`, params, "POST");
  for (let i = 0; i < 60; i++) { // up to ~5 min for Instagram to fetch + process the video
    await sleep(5000);
    const s = await ig(acct.token, c.id, { fields: "status_code,status" });
    if (s.status_code === "FINISHED") break;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new Error(`processing ${s.status_code}: ${s.status || ""}`);
    if (i === 59) throw new Error("processing timed out");
  }
  const m = await ig(acct.token, `${acct.id}/media_publish`, { creation_id: c.id }, "POST");
  const info = await ig(acct.token, m.id, { fields: "permalink" }).catch(() => ({}));
  return { id: m.id, url: info.permalink || null };
}

const A = await accounts();
if (CHECK) {
  for (const [u, a] of Object.entries(A)) {
    try { const l = await ig(a.token, `${a.id}/content_publishing_limit`, { fields: "config,quota_usage" }); console.log(`@${u}: can publish`, JSON.stringify(l.data?.[0] ?? l)); }
    catch (e) { console.log(`@${u}: CANNOT publish: ${e.message}`); }
  }
  process.exit(0);
}
const due = await rpc("pipe_worker_due", {});
console.log(`${due.length} post(s) due`);
for (const p of due) {
  const a = A[p.account];
  if (!a) { await rpc("pipe_worker_done", { p_id: p.id, p_ok: false, p_result: null, p_error: `no Instagram token for @${p.account}` }); continue; }
  if (DRY) { console.log("would post", p.account, p.variant); continue; }
  try {
    const r = await publish(a, p);
    console.log(`posted ${p.variant} to @${p.account}: ${r.url}`);
    await rpc("pipe_worker_done", { p_id: p.id, p_ok: true, p_result: { instagram: r }, p_error: null });
  } catch (e) {
    console.log(`failed ${p.variant}: ${e.message}`);
    await rpc("pipe_worker_done", { p_id: p.id, p_ok: false, p_result: null, p_error: String(e.message).slice(0, 900) });
  }
}
