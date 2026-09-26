// The tutor's memory of this learner across sessions: a short plain-text
// note, kept up to date by the model itself and shown to the learner in
// Settings (read, correct, clear). Lives in the data folder next to
// settings.json, so it survives reinstalls.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { TUTOR_DIR } from "./paths.js";

const NOTES_PATH = path.join(TUTOR_DIR, "learner-notes.md");
export const NOTES_MAX = 1200; // forces keeping what matters, not a transcript

export async function getLearnerNotes() {
  try { return (await readFile(NOTES_PATH, "utf-8")).trim(); } catch { return ""; }
}

export async function setLearnerNotes(text) {
  const notes = String(text ?? "").trim().slice(0, NOTES_MAX);
  await writeFile(NOTES_PATH, notes);
  return notes;
}

// Updating is a separate short request after each reply, not a tool the tutor
// may call mid-answer: offered as an optional tool, Mistral Large never once
// used it across 15 test runs — including when told outright that its notes
// were wrong. Asking the question every time makes it reliable; the model
// still decides whether anything is worth keeping.
const REVISE_PROMPT = `You keep a coding tutor's short private notes about one learner, carried between sessions so the tutor can adapt to them. You're shown the current notes and the latest exchange.

Change the notes only if the exchange shows something real and lasting about the learner:
- what they said about themselves ("I'm new to coding", "I know Java")
- a confusion they showed in their own words ("so return doesn't print it?")
- something they got right on their own after being stuck

Most exchanges change nothing. Do NOT record:
- anything inferred from their code — code they wrote isn't evidence of what they understand
- a single question on its own ("asked what a decorator is" is not worth keeping)
- mood, tone or language — "wtf", swearing or impatience says nothing lasting about them
- guesses about preferences or personality
- that they understood something, unless they showed it in their own words or fixed it themselves
- what the tutor explained

- facts about Python or programming — notes are about the learner, not the subject

If the exchange contradicts a note, fix the note. Write about the learner in the third person, a few short lines, plain words. Good notes look like:
New to coding.
Mixed up return and print (thought return shows the result); got it once explained.
Knows Java; new to Python.

Reply with exactly NO CHANGE if nothing should change. Otherwise reply with only the complete new notes — no heading, no preamble.`;

export async function reviseLearnerNotes({ notes, learnerSaid, tutorSaid, baseUrl, apiKey, model }) {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: REVISE_PROMPT },
        { role: "user", content: `Current notes:\n${notes || "(none yet)"}\n\nLatest exchange:\nLearner: ${learnerSaid}\nTutor: ${tutorSaid}` },
      ],
    }),
  });
  if (!res.ok) return null; // rate limit or outage — just skip this update
  const text = (await res.json()).choices?.[0]?.message?.content?.trim() ?? "";
  if (!text || /^NO CHANGE\.?$/i.test(text)) return null;
  // Models sometimes wrap the answer in a code fence or a "New notes:" label.
  return text.replace(/^```\w*\n?|\n?```$/g, "").replace(/^(new |updated )?notes:\s*/i, "").trim().slice(0, NOTES_MAX);
}
