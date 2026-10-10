// Turns a comment like "14 and 5'10" into a colour emoji.
// 🟢 = 6'0"+, 🔴 = well below average for their age (bottom ~10%), 🔵 = everything else (potential).

// Roughly the 10th percentile height for boys by age, in cm (CDC charts). 18+ uses adult.
const SHORT_CM = { 10: 129, 11: 134, 12: 140, 13: 146, 14: 153, 15: 160, 16: 165, 17: 167, 18: 168 };

export function parse(text) {
  let t = text.toLowerCase().replace(/[’‘`´]/g, "'").replace(/[”“]/g, '"');
  let cm = null;
  const m =
    t.match(/\b([4-7])\s*(?:'|ft|foot|feet|,|\.)\s*(1[01]|\d)(?!\d)/) ||   // 5'7  5,5  5ft 10  5.11
    t.match(/\b([4-7])\s*(?:'|ft|foot|feet)(?!\s*\d)/);                    // 6'  6ft
  if (m) { cm = (Number(m[1]) * 12 + Number(m[2] ?? 0)) * 2.54; t = t.replace(m[0], " "); }
  else {
    const c = t.match(/\b(1[2-9]\d|2[0-2]\d)\s*cm\b/) || t.match(/\b(1[5-9]\d|20\d)\b/);
    if (c) { cm = Number(c[1]); t = t.replace(c[0], " "); }
  }
  if (cm == null) return null;
  const a = t.match(/\b(\d{1,2})\b/);
  const age = a && Number(a[1]) >= 8 && Number(a[1]) <= 30 ? Number(a[1]) : null;
  return { cm, age };
}

export function emoji({ cm, age }) {
  if (cm >= 182.88 - 0.5) return "🟢";
  const floor = SHORT_CM[Math.min(Math.max(age ?? 18, 10), 18)];
  return cm < floor ? "🔴" : "🔵";
}

const EXTRA = {
  "🟢": ["", "", " 🔥", " giant fr"],
  "🔵": ["", "", " if you lock in", " still growing"],
  "🔴": ["", "", " lock in now", " not over yet"],
};

/** Reply text for a comment, or null if it doesn't contain a height. */
export function replyFor(text, username) {
  const p = parse(text);
  if (!p) return null;
  const e = emoji(p);
  const extras = EXTRA[e];
  const extra = extras[Math.floor(Math.random() * extras.length)];
  return username ? `@${username} ${e}${extra}` : `${e}${extra}`;
}
