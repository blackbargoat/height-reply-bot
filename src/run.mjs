// Looks at your newest posts and replies 🔵 / 🔴 / 🟢 to height comments you haven't answered yet.
// Runs on a schedule in GitHub Actions. Token comes from the IG_ACCESS_TOKEN repo secret, never from code.
import { replyFor } from "./classify.mjs";

const GRAPH = "https://graph.instagram.com/v23.0";
const TOKEN = process.env.IG_ACCESS_TOKEN;
const POSTS = 5;            // newest posts to watch
const MAX_PER_RUN = 25;     // cap per run so Instagram doesn't see a huge burst
const DRY_RUN = process.env.DRY_RUN === "1";

async function get(path, params = {}) {
  const res = await fetch(`${GRAPH}/${path}?${new URLSearchParams({ ...params, access_token: TOKEN })}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json;
}

const me = await get("me", { fields: "user_id,username" });
const media = await get(`${me.user_id}/media`, { fields: "id", limit: POSTS });
let sent = 0;
outer: for (const post of media.data ?? []) {
  const comments = await get(`${post.id}/comments`, { fields: "id,text,username,replies{username}", limit: 50 });
  for (const c of comments.data ?? []) {
    if (sent >= MAX_PER_RUN) break outer;
    if (c.username === me.username) continue;
    if ((c.replies?.data ?? []).some((r) => r.username === me.username)) continue; // already answered
    const message = replyFor(c.text ?? "", c.username);
    if (!message) continue;
    if (DRY_RUN) { console.log("[dry run]", c.username, JSON.stringify(c.text), "→", message); sent++; continue; }
    const res = await fetch(`${GRAPH}/${c.id}/replies`, {
      method: "POST",
      body: new URLSearchParams({ message, access_token: TOKEN }),
    });
    console.log(c.username, JSON.stringify(c.text), "→", message, res.status);
    sent++;
    await new Promise((r) => setTimeout(r, 4000 + Math.random() * 4000));
  }
}
console.log(`done, ${sent} replies`);
