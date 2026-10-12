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
    // Metres like "1,92" / "1.85m" / "1,92cm" (common outside the US)
    const mt = t.match(/\b([12])[.,](\d{2})\s*(?:m|cm|meters?|metres?)?(?![\d.,])/);
    const c = t.match(/\b(1[2-9]\d|2[0-2]\d)\s*cm\b/) || t.match(/\b(1[5-9]\d|20\d)\b/);
    if (mt && +mt[1] * 100 + +mt[2] >= 120) { cm = +mt[1] * 100 + +mt[2]; t = t.replace(mt[0], " "); }
    else if (c) { cm = Number(c[1]); t = t.replace(c[0], " "); }
  }
  if (cm == null || cm > 214) return null; // 7'0"+ is a joke comment
  const a = t.match(/(?<!\d)(\d{1,2})(?!\d)/);           // also "15years", "14yo"
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

// What a real person would say back, by colour. {age} lines are only used when the comment gave an age.
const REACT = {
  "🟢": ["already tall fr", "nah you're built different", "giant behavior 😭", "tall genes for real", "you're good already",
         "{age} and already that tall is crazy", "bro's already up there"],
  "🔵": ["not done growing yet btw", "you still got time fr", "plenty of growing left", "still got potential",
         "you're good, still room to grow", "not done yet trust", "you got years left at {age}", "{age} is still early, you're good",
         "you're not done at {age}"],
  "🔴": ["not over yet, gotta lock in", "still time, lock in rn", "it's not over at {age}", "lock in now, sleep + protein",
         "still time to change it", "don't stress, just lock in", "not cooked yet, lock in"],
};

// Reply styles. The bot rotates them by the hour so we can see which one gets the most likes, reply-backs and signups.
export const STYLES = {
  nudge: ["make sure to join the waitlist in my bio", "join the gopeak waitlist in my bio", "get on the waitlist in my bio before it drops",
          "make sure you're on the waitlist, it's in my bio", "hop on the waitlist in my bio"],
  question: ["want to see how tall you'll actually get? waitlist in my bio", "curious what your max is? gopeak waitlist in my bio",
             "wanna know your real potential? link in my bio", "want your actual predicted height? waitlist in bio"],
  short: ["waitlist in bio", "link in bio 📈", "gopeak in my bio", "waitlist in my bio 🙏"],
  personal: ["i made an app that predicts your height, waitlist is in my bio", "i'm building an app for this, waitlist in my bio",
             "my app gopeak predicts your height, waitlist in bio", "made an app for exactly this, it's in my bio"],
};

export function replyFor(text, username, style = pick(Object.keys(STYLES))) {
  const p = parse(text);
  if (!p) {
    // Only an age ("14 years 🔴"): ask for the height so they come back, plus the CTA.
    const t = text.toLowerCase();
    const a = t.match(/(?<!\d)(\d{1,2})\s*(?:y\/?o|yrs?|years?|yr old)|\bage\s*(\d{1,2})(?!\d)/);
    const age = a && Number(a[1] ?? a[2]);
    if (!age || age < 8 || age > 30 || t.includes("?")) return null;
    const ask = pick(["drop your height too 👀", "how tall tho?", "what's your height tho", "need the height too 😭"]);
    const body = `${ask} ${pick(STYLES[style])}`;
    return { message: username ? `@${username} ${body}` : body, style, emoji: "❔" };
  }
  const e = emoji(p);
  const lines = REACT[e].filter((l) => p.age != null || !l.includes("{age}"));
  const react = pick(lines).replace("{age}", p.age);
  const join = pick([" btw ", ". ", ", "]);
  const body = `${e} ${react}${react.endsWith("btw") ? " " : join}${pick(STYLES[style])}`;
  return { message: username ? `@${username} ${body}` : body, style, emoji: e };
}
