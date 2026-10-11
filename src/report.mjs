// Which reply style works best? node src/report.mjs
// Likes and reply-backs come from stats/replies.json. Signups come from the waitlist page's hourly counts
// (needs stats/site_hourly.sql run once in Supabase), matched to the style that was running that hour.
import fs from "node:fs";

const API = "https://etdbjahwegsmuelcawgf.supabase.co/rest/v1";
const KEY = "sb_publishable_p8exB2dS5lpdz-p1chueJA_n9zRQdnG"; // public key, same one the waitlist page uses
const log = JSON.parse(fs.readFileSync("stats/replies.json", "utf8"));

const rows = {}, styleOfHour = {};
for (const x of log) {
  const r = (rows[x.style] ??= { replies: 0, checked: 0, likes: 0, back: 0, views: 0, signups: 0 });
  r.replies++;
  if (x.likes != null && !x.gone) { r.checked++; r.likes += x.likes; r.back += x.replied_back ? 1 : 0; }
  styleOfHour[x.at.slice(0, 13)] = x.style;
}

let hourly = null;
try {
  const res = await fetch(`${API}/rpc/site_hourly`, { method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" }, body: "{}" });
  if (res.ok) hourly = await res.json();
} catch {}
for (const h of hourly ?? []) {
  const style = styleOfHour[new Date(h.hour).toISOString().slice(0, 13)];
  if (style) { rows[style].views += h.views; rows[style].signups += h.signups; }
}

const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) + "%" : "-");
console.table(Object.fromEntries(Object.entries(rows).map(([s, r]) => [s, {
  replies: r.replies,
  "likes / reply": r.checked ? (r.likes / r.checked).toFixed(2) : "-",
  "reply-back": pct(r.back, r.checked),
  "site visits": hourly ? r.views : "-",
  "signups": hourly ? r.signups : "-",
  "signups / 100 replies": hourly ? ((100 * r.signups) / r.replies).toFixed(1) : "-",
}])));
if (!hourly) console.log("No signup data yet: run stats/site_hourly.sql once in the Supabase SQL editor.");
