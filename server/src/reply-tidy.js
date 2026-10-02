// Two things the instructions ask the tutor not to do, which it still does
// often enough that they're taken out of the reply as it streams:
//
// A closing nudge — "Try that.", "Want to try it?", "Press Run to see" — is
// dropped from the end. The tutor ended about 1 reply in 14 that way on the
// held-out suite (2026-10-01); a learner reads it as being told what to do
// next. Only whole last sentences go, and only when other text comes before.
//
// A concession opener — "You're right —", "You're correct:", "You're right
// to double-check!" — is dropped from the start. The instructions allow it
// only when the learner is right; the tutor opened 35 of 116 replies to a
// wrong pushback that way (held-out suite, 2026-10-01), several followed by
// the opposite: "You're right — that trailing comma is **not** an error". A
// beginner reads the first words as the answer. "Good question!" goes too.
//
// Replies stream to the page, so the first ~80 characters are held until
// the opener is decided, and the last ~200 until the reply ends; the rest
// goes out as it arrives.

export const NUDGE = /\b(try (it|that|this|running|pressing|again)\b|press(ing)?\s+\**run\**|let me know|want (me )?to\b|would you like|feel free|do you want|shall i|give it a (go|try))/i;

const sentencesOf = (text) => String(text).trim().replace(/```[\s\S]*?```/g, " ").split(/(?<=[.!?])\s+|\n+/).filter((s) => s.trim());
export function endsWithNudge(text) {
  return NUDGE.test(sentencesOf(text).at(-1) ?? "");
}

const YOURE = String.raw`You(?:'|’)re (?:absolutely |totally |completely |quite )?`;
const OPENERS = [
  // a whole sentence: "You're right to double-check!"
  new RegExp(String.raw`^\s*${YOURE}right to (?:double-check|check|question|ask|push back|be (?:skeptical|careful|unsure))[^.!?—–:\n]{0,30}[.!]\s*`, "i"),
  // a lead-in: "You're right — …", "You're correct: …", "You're right to push back — …", "You're right."
  new RegExp(String.raw`^\s*${YOURE}(?:right|correct)(?: to [^.!?—–:,\n]{1,40})?\s*(?:—|–|-|:|,|!|\.)\s*`, "i"),
  // "You're right that X, but …" → "X, but …"
  new RegExp(String.raw`^\s*${YOURE}(?:right|correct) that\s+`, "i"),
  /^\s*(?:Good|Great) question[.!—–:,]?\s*/i,
];
export function withoutOpener(text) {
  for (const re of OPENERS) {
    const m = re.exec(text);
    if (!m) continue;
    const rest = text.slice(m[0].length);
    if (!/\w/.test(rest)) return text; // the opener is the whole reply: leave it
    // Capital letter for what now starts the reply — not inside code (`x = 5`).
    return rest.replace(/^([*_"']*)(\p{Ll})/u, (_, marks, c) => marks + c.toUpperCase());
  }
  return text;
}

const OPEN_HOLD = 80;
const HOLD = 200;
export function createReplyTidier() {
  let all = "";
  let sent = 0;
  let opened = false; // the opener has been dealt with
  const open = () => { all = withoutOpener(all); opened = true; };
  return {
    // Text that can go out now.
    push(text) {
      all += text;
      if (!opened) {
        if (all.length < OPEN_HOLD) return "";
        open();
      }
      const upTo = Math.max(sent, all.length - HOLD);
      const out = all.slice(sent, upTo);
      sent = upTo;
      return out;
    },
    // The rest, at the end of the reply — without closing nudges. One
    // sentence at a time, since they come in pairs too ("Want to try it?
    // Let me know!" — the held-out suite once kept the first of two).
    end() {
      if (!opened) open();
      let tail = all.slice(sent);
      let trimmed = all.replace(/\s+$/, "");
      for (;;) {
        const lastSentence = sentencesOf(trimmed).at(-1) ?? "";
        const at = trimmed.lastIndexOf(lastSentence.trim());
        const insideCode = (trimmed.slice(0, at).match(/```/g) ?? []).length % 2 === 1;
        if (!lastSentence || !NUDGE.test(lastSentence) || insideCode || at < sent || !trimmed.slice(0, at).trim()) break;
        trimmed = trimmed.slice(0, at).replace(/\s+$/, "");
        tail = trimmed.slice(sent);
      }
      sent = all.length;
      return tail;
    },
  };
}
