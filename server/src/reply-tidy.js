// A closing nudge — "Try that.", "Want to try it?", "Press Run to see" — is
// dropped from the end of a tutor reply. The instructions ask for none, and
// the tutor still ended about 1 reply in 14 that way on the held-out suite
// (2026-10-01); a learner reads it as being told what to do next. Only the
// last sentence is ever touched, and only when other text comes before it.
//
// Replies stream to the page, so the last ~200 characters are held back
// until the reply ends; everything before them goes out as it arrives.

export const NUDGE = /\b(try (it|that|this|running|pressing|again)\b|press(ing)?\s+\**run\**|let me know|want (me )?to\b|would you like|feel free|do you want|shall i|give it a (go|try))/i;

const sentencesOf = (text) => String(text).trim().replace(/```[\s\S]*?```/g, " ").split(/(?<=[.!?])\s+|\n+/).filter((s) => s.trim());
export function endsWithNudge(text) {
  return NUDGE.test(sentencesOf(text).at(-1) ?? "");
}

const HOLD = 200;
export function createNudgeTrimmer() {
  let all = "";
  let sent = 0;
  return {
    // Text that can go out now.
    push(text) {
      all += text;
      const upTo = Math.max(sent, all.length - HOLD);
      const out = all.slice(sent, upTo);
      sent = upTo;
      return out;
    },
    // The rest, at the end of the reply — without a closing nudge.
    end() {
      let tail = all.slice(sent);
      const trimmed = all.replace(/\s+$/, "");
      const lastSentence = sentencesOf(trimmed).at(-1) ?? "";
      const at = trimmed.lastIndexOf(lastSentence.trim());
      const insideCode = (trimmed.slice(0, at).match(/```/g) ?? []).length % 2 === 1;
      if (lastSentence && NUDGE.test(lastSentence) && !insideCode && at >= sent && trimmed.slice(0, at).trim()) {
        tail = trimmed.slice(sent, at).replace(/\s+$/, "");
      }
      sent = all.length;
      return tail;
    },
  };
}
