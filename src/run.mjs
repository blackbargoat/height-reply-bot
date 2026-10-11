// Looks at your newest posts and replies 🔵 / 🔴 / 🟢 to height comments you haven't answered yet.
// Runs on a schedule in GitHub Actions. One token per account, from the IG_ACCESS_TOKEN, IG_ACCESS_TOKEN_2, ...
// repo secrets, never from code.
import { replyFor, STYLES } from "./classify.mjs";
import fs from "node:fs";

const GRAPH = "https://graph.instagram.com/v23.0";
const TOKENS = Object.keys(process.env).filter((k) => /^IG_ACCESS_TOKEN(_\d+)?$/.test(k)).sort()
  .map((k) => process.env[k]).filter(Boolean);
const POSTS = 10;           // newest posts to watch
const MAX_PER_RUN = 60;     // cap per account per run so Instagram doesn't see a huge burst
const DRY_RUN = process.env.DRY_RUN === "1";

// A/B test: every reply sent in the same UTC hour uses the same style, so waitlist signups per hour can be
// matched to a style later (see src/report.mjs). Set FORCE_STYLE to lock in a winner.
const STYLE_IDS = Object.keys(STYLES);
const STYLE = STYLES[process.env.FORCE_STYLE] ? process.env.FORCE_STYLE : STYLE_IDS[Math.floor(Date.now() / 3600e3) % STYLE_IDS.length];
const LOG = "stats/replies.json";       // one row per reply the bot sent, with likes / reply-backs filled in later
let log = []; try { log = JSON.parse(fs.readFileSync(LOG, "utf8")); } catch {}
const CHECK_AFTER_H = 6, CHECKS_PER_RUN = 40;

let TOKEN;
async function get(path, params = {}) {
  const res = await fetch(`${GRAPH}/${path}?${new URLSearchParams({ ...params, access_token: TOKEN })}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json;
}

async function runAccount() {
  const me = await get("me", { fields: "user_id,username,followers_count,media_count" });
  const media = await get(`${me.user_id}/media`, { fields: "id,timestamp,comments_count,like_count,media_product_type", limit: POSTS });
  console.log(`account @${me.username}, watching ${media.data?.length ?? 0} posts`);
  let sent = 0;
  outer: for (const post of media.data ?? []) {
    // Page through all comments (newest posts can have hundreds).
    const comments = { data: [] };
    let page = await get(`${post.id}/comments`, { fields: "id,text,username,from{id,username},replies{id,text,from{id,username},username}", limit: 50 });
    for (let i = 0; i < 30 && page; i++) {
      comments.data.push(...(page.data ?? []));
      page = page.paging?.next ? await (await fetch(page.paging.next)).json() : null;
    }
    console.log(`post ${post.timestamp?.slice(0, 16)} ${post.media_product_type}: ${post.comments_count} comments, API returned ${comments.data?.length ?? 0}`);
    if (DRY_RUN) for (const c of comments.data ?? []) console.log("   ", c.from?.username ?? c.username ?? "(no username)", JSON.stringify(c.text), `${c.replies?.data?.length ?? 0} replies`);
    // Instagram sometimes lists our replies as separate top-level comments ("@name ...") instead of under the
    // original, so also treat anyone we've @-mentioned on this post (or replied to before) as answered.
    const answered = new Set(log.map((x) => x.parent));
    const mentioned = new Set();
    for (const c of comments.data ?? []) {
      const mine = [c, ...(c.replies?.data ?? [])].filter((x) => x.from?.id === me.user_id || (x.from?.username ?? x.username) === me.username);
      for (const m of mine) { const at = (m.text ?? "").match(/^@([\w.]+)/); if (at) mentioned.add(at[1].toLowerCase()); }
    }
    for (const c of comments.data ?? []) {
      if (sent >= MAX_PER_RUN) break outer;
      if (answered.has(c.id) || mentioned.has((c.from?.username ?? c.username ?? "").toLowerCase())) continue;
      const who = c.from?.username ?? c.username;
      if (who === me.username || c.from?.id === me.user_id) continue;
      const replies = c.replies?.data ?? [];
      const byMe = replies.some((r) => r.from?.id === me.user_id || (r.from?.username ?? r.username) === me.username);
      const unknown = replies.some((r) => !(r.from?.username ?? r.username));
      if (byMe || unknown) continue; // you (or the bot) already answered it
      const r = replyFor(c.text ?? "", who, STYLE);
      if (!r) continue;
      const { message } = r;
      if (DRY_RUN) { console.log("[dry run]", who, JSON.stringify(c.text), "→", message); sent++; continue; }
      const res = await fetch(`${GRAPH}/${c.id}/replies`, {
        method: "POST",
        body: new URLSearchParams({ message, access_token: TOKEN }),
      });
      console.log(who, JSON.stringify(c.text), "→", message, res.status);
      if (!res.ok) { console.log("Instagram refused a reply, pausing this account:", await res.text()); break outer; }
      const { id } = await res.json().catch(() => ({}));
      mentioned.add(who.toLowerCase());
      if (id) log.push({ id, parent: c.id, user: who, account: me.username, style: r.style, emoji: r.emoji, at: new Date().toISOString() });
      sent++;
      await new Promise((r) => setTimeout(r, 2500 + Math.random() * 3000));
    }
  }
  console.log(`done, ${sent} replies (style: ${STYLE})`);
  if (!DRY_RUN) await checkEngagement(me);
  // Views need the instagram_business_manage_insights permission; record null if the token doesn't have it.
  let views = null, reach = null;
  try {
    const since = Math.floor(Date.UTC(...new Date().toISOString().slice(0, 10).split("-").map((v, i) => (i === 1 ? v - 1 : +v))) / 1000);
    const ins = await get(`${me.user_id}/insights`, { metric: "views,reach", period: "day", metric_type: "total_value", since, until: Math.floor(Date.now() / 1000) });
    for (const m of ins.data ?? []) { if (m.name === "views") views = m.total_value?.value ?? null; if (m.name === "reach") reach = m.total_value?.value ?? null; }
    console.log(`insights @${me.username}: views today ${views}, reach ${reach}`);
  } catch (e) { console.log(`insights @${me.username} unavailable: ${e.message}`); }
  stats.push({ me, media: media.data ?? [], sent, views, reach });
  if (sent >= MAX_PER_RUN) capped = true;
}

// Later, look back at replies a few hours old: did people like them, and did the commenter reply to us?
async function checkEngagement(me) {
  const due = log.filter((x) => x.account === me.username && x.likes == null && Date.now() - Date.parse(x.at) > CHECK_AFTER_H * 3600e3)
    .slice(0, CHECKS_PER_RUN);
  for (const x of due) {
    try {
      const mine = await get(x.id, { fields: "like_count" });
      const parent = await get(x.parent, { fields: "replies{timestamp,username,from{username}}" });
      x.likes = mine.like_count ?? 0;
      x.replied_back = (parent.replies?.data ?? []).some((r) => (r.from?.username ?? r.username) === x.user && Date.parse(r.timestamp) > Date.parse(x.at));
    } catch (e) { x.likes = 0; x.replied_back = false; x.gone = true; } // comment was deleted
  }
  if (due.length) console.log(`checked engagement on ${due.length} older replies`);
}

let failed = false, capped = false;
const stats = [];
for (TOKEN of TOKENS) {
  try { await runAccount(); } catch (e) { console.error("account failed:", e.message); failed = true; }
}
// Daily stats for the GoPeak dashboard (stats/daily.json): one row per account per day.
if (!DRY_RUN) {
  const file = "stats/daily.json", day = new Date().toISOString().slice(0, 10);
  let rows = []; try { rows = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
  for (const { me, media, sent, views, reach } of stats) {
    let row = rows.find((r) => r.day === day && r.account === me.username);
    if (!row) rows.push((row = { day, account: me.username, replies: 0 }));
    row.followers = me.followers_count ?? null;
    row.posts = me.media_count ?? null;
    row.replies += sent;
    row.likes_recent = media.reduce((a, m) => a + (m.like_count ?? 0), 0);
    row.comments_recent = media.reduce((a, m) => a + (m.comments_count ?? 0), 0);
    if (views != null) row.views = views;
    if (reach != null) row.reach = reach;
    row.updated = new Date().toISOString();
  }
  fs.mkdirSync("stats", { recursive: true });
  fs.writeFileSync(file, JSON.stringify(rows.sort((a, b) => (a.day + a.account).localeCompare(b.day + b.account)), null, 1));
  // Keep 30 days of reply rows, plus a per-style summary for the dashboard.
  log = log.filter((x) => Date.now() - Date.parse(x.at) < 30 * 86400e3);
  fs.writeFileSync(LOG, JSON.stringify(log));
  const sum = {};
  for (const x of log) {
    const s = (sum[x.style] ??= { replies: 0, checked: 0, likes: 0, replied_back: 0 });
    s.replies++;
    if (x.likes != null && !x.gone) { s.checked++; s.likes += x.likes; s.replied_back += x.replied_back ? 1 : 0; }
  }
  fs.writeFileSync("stats/styles.json", JSON.stringify(sum, null, 1));
}
// Tell the workflow to start another run right away while there's still a backlog.
if (capped && !DRY_RUN && process.env.GITHUB_OUTPUT) (await import("node:fs")).appendFileSync(process.env.GITHUB_OUTPUT, "capped=true\n");
if (failed) process.exit(1);
