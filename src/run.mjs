// Looks at your newest posts and replies 🔵 / 🔴 / 🟢 to height comments you haven't answered yet.
// Runs on a schedule in GitHub Actions. One token per account, from the IG_ACCESS_TOKEN, IG_ACCESS_TOKEN_2, ...
// repo secrets, never from code.
import { replyFor } from "./classify.mjs";
import fs from "node:fs";

const GRAPH = "https://graph.instagram.com/v23.0";
const TOKENS = Object.keys(process.env).filter((k) => /^IG_ACCESS_TOKEN(_\d+)?$/.test(k)).sort()
  .map((k) => process.env[k]).filter(Boolean);
const POSTS = 10;           // newest posts to watch
const MAX_PER_RUN = 60;     // cap per account per run so Instagram doesn't see a huge burst
const DRY_RUN = process.env.DRY_RUN === "1";

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
    let page = await get(`${post.id}/comments`, { fields: "id,text,username,from{id,username},replies{id,from{id,username},username}", limit: 50 });
    for (let i = 0; i < 30 && page; i++) {
      comments.data.push(...(page.data ?? []));
      page = page.paging?.next ? await (await fetch(page.paging.next)).json() : null;
    }
    console.log(`post ${post.timestamp?.slice(0, 16)} ${post.media_product_type}: ${post.comments_count} comments, API returned ${comments.data?.length ?? 0}`);
    if (DRY_RUN) for (const c of comments.data ?? []) console.log("   ", c.from?.username ?? c.username ?? "(no username)", JSON.stringify(c.text), `${c.replies?.data?.length ?? 0} replies`);
    for (const c of comments.data ?? []) {
      if (sent >= MAX_PER_RUN) break outer;
      const who = c.from?.username ?? c.username;
      if (who === me.username || c.from?.id === me.user_id) continue;
      const replies = c.replies?.data ?? [];
      const byMe = replies.some((r) => r.from?.id === me.user_id || (r.from?.username ?? r.username) === me.username);
      const unknown = replies.some((r) => !(r.from?.username ?? r.username));
      if (byMe || unknown) continue; // you (or the bot) already answered it
      const message = replyFor(c.text ?? "", who);
      if (!message) continue;
      if (DRY_RUN) { console.log("[dry run]", who, JSON.stringify(c.text), "→", message); sent++; continue; }
      const res = await fetch(`${GRAPH}/${c.id}/replies`, {
        method: "POST",
        body: new URLSearchParams({ message, access_token: TOKEN }),
      });
      console.log(who, JSON.stringify(c.text), "→", message, res.status);
    if (!res.ok) { console.log("Instagram refused a reply, pausing this account:", await res.text()); break outer; }
      sent++;
      await new Promise((r) => setTimeout(r, 2500 + Math.random() * 3000));
    }
  }
  console.log(`done, ${sent} replies`);
  stats.push({ me, media: media.data ?? [], sent });
  if (sent >= MAX_PER_RUN) capped = true;
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
  for (const { me, media, sent } of stats) {
    let row = rows.find((r) => r.day === day && r.account === me.username);
    if (!row) rows.push((row = { day, account: me.username, replies: 0 }));
    row.followers = me.followers_count ?? null;
    row.posts = me.media_count ?? null;
    row.replies += sent;
    row.likes_recent = media.reduce((a, m) => a + (m.like_count ?? 0), 0);
    row.comments_recent = media.reduce((a, m) => a + (m.comments_count ?? 0), 0);
    row.updated = new Date().toISOString();
  }
  fs.mkdirSync("stats", { recursive: true });
  fs.writeFileSync(file, JSON.stringify(rows.sort((a, b) => (a.day + a.account).localeCompare(b.day + b.account)), null, 1));
}
// Tell the workflow to start another run right away while there's still a backlog.
if (capped && !DRY_RUN && process.env.GITHUB_OUTPUT) (await import("node:fs")).appendFileSync(process.env.GITHUB_OUTPUT, "capped=true\n");
if (failed) process.exit(1);
