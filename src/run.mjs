// Looks at your newest posts and replies 🔵 / 🔴 / 🟢 to height comments you haven't answered yet.
// Runs on a schedule in GitHub Actions. Token comes from the IG_ACCESS_TOKEN repo secret, never from code.
import { replyFor } from "./classify.mjs";

const GRAPH = "https://graph.instagram.com/v23.0";
const TOKEN = process.env.IG_ACCESS_TOKEN;
const POSTS = 5;            // newest posts to watch
const MAX_PER_RUN = 20;     // cap per run so Instagram doesn't see a huge burst
const DRY_RUN = process.env.DRY_RUN === "1";

async function get(path, params = {}) {
  const res = await fetch(`${GRAPH}/${path}?${new URLSearchParams({ ...params, access_token: TOKEN })}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json;
}

const me = await get("me", { fields: "user_id,username" });
const media = await get(`${me.user_id}/media`, { fields: "id,timestamp,comments_count,media_product_type", limit: POSTS });
console.log(`account @${me.username}, watching ${media.data?.length ?? 0} posts`);
let sent = 0;
outer: for (const post of media.data ?? []) {
  // Page through all comments (newest posts can have hundreds).
  const comments = { data: [] };
  let page = await get(`${post.id}/comments`, { fields: "id,text,username,from{id,username},replies{id,from{id,username},username}", limit: 50 });
  for (let i = 0; i < 6 && page; i++) {
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
    sent++;
    await new Promise((r) => setTimeout(r, 4000 + Math.random() * 4000));
  }
}
console.log(`done, ${sent} replies`);
