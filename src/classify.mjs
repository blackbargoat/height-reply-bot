// Turns a comment like "14 and 5'10" into a colour emoji.
// 🟢 = 6'0"+, 🔴 = well below average for their age (bottom ~10%), 🔵 = everything else (potential).

// Roughly the 10th percentile height for boys by age, in cm (CDC charts). 18+ uses adult.
const SHORT_CM = { 10: 129, 11: 134, 12: 140, 13: 146, 14: 153, 15: 160, 16: 165, 17: 167, 18: 168 };

const FT = /\b([4-7])\s*(?:'|ft|foot|feet|,|\.)\s*(1[01]|\d)(?!\d)|\b([4-7])\s*(?:'|ft|foot|feet)(?!\s*\d)/g;
const PARENTS = /\b(mom|mum|mother|dad|father|parents?|grand(?:pa|ma|father|mother)|brother|sister|bro|sis)\b/;
const SELF = /\b(i'?m|i am|iam|am i|me|my height)\b/;

export function parse(text) {
  let t = text.toLowerCase().replace(/[’‘`´]/g, "'").replace(/[”“]/g, '"');
  if (t.includes("?") && !SELF.test(t)) return null;            // questions like "what if my parents are 5'9?"
  const hits = [...t.matchAll(FT)];
  let m = hits[0];
  if (PARENTS.test(t)) {
    // Comment mentions family heights: only use the height right after "I'm / me / I am".
    const self = t.match(SELF);
    m = self ? hits.find((h) => h.index > self.index) : null;
    if (!m) return null;
  }
  let cm = null;
  if (m) {
    const feet = Number(m[1] ?? m[3]), inches = Number(m[2] ?? 0);
    cm = (feet * 12 + inches) * 2.54;
    t = t.replace(FT, " ");                                       // drop every height so feet/inches aren't read as an age
  } else if (!PARENTS.test(t)) {
    const c = t.match(/\b(1[2-9]\d|2[0-2]\d)\s*cm\b/) || t.match(/\b(1[5-9]\d|20\d)\b/);
    if (c) { cm = Number(c[1]); t = t.replace(c[0], " "); }
  }
  if (cm == null || cm > 214) return null; // 7'0"+ is a joke comment
  const a = t.match(/\b(\d{1,2})\b/);
  const age = a && Number(a[1]) >= 8 && Number(a[1]) <= 30 ? Number(a[1]) : null;
  return { cm, age };
}

export function emoji({ cm, age }) {
  if (cm >= 182.88 - 0.5) return "🟢";
  if (age == null) return "🔵";                                 // no age given: don't call anyone cooked
  const floor = SHORT_CM[Math.min(Math.max(age, 10), 18)];
  return cm < floor ? "🔴" : "🔵";
}

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const EXTRA = {
  "🟢": ["", "", " 🔥", " giant fr", " tall genes", " already built different"],
  "🔵": ["", "", " if you lock in", " still growing", " plenty of time", " not done yet"],
  "🔴": ["", "", " lock in now", " not over yet", " still time", " gotta lock in"],
};
// Waitlist CTA, mixed up so no two replies read the same. Link lives in the bio, not the comment.
const CTAS = [
  "join the GoPeak waitlist, link in bio", "GoPeak waitlist is in my bio", "get on the GoPeak waitlist (bio)",
  "see how tall you'll actually get, GoPeak waitlist in bio", "GoPeak predicts your height, waitlist in my bio",
  "sign up for GoPeak in my bio", "waitlist for GoPeak in bio", "check the link in my bio for GoPeak",
  "GoPeak drops soon, waitlist in bio", "find your max height on GoPeak, link in bio", "tap my bio and join GoPeak",
  "GoPeak will show your real potential, bio", "get early access to GoPeak in my bio", "lock in with GoPeak, waitlist in bio",
];
const TAIL = ["", "", "", " 👆", " 📈", " 🔗", " fr", " 🙏"];
function cta() {
  const line = pick(CTAS);
  return (Math.random() < 0.4 ? line[0].toUpperCase() + line.slice(1) : line) + pick(TAIL);
}
export function replyFor(text, username) {
  const p = parse(text);
  if (!p) return null;
  const e = emoji(p);
  const body = `${e}${pick(EXTRA[e])}${pick([" ", " ", " · ", " | ", ". "])}${cta()}`;
  return username ? `@${username} ${body}` : body;
}
