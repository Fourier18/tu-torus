// The only tutor provider — one generic OpenAI-compatible chat-completions
// client, since Mistral, Gemini, OpenRouter, and pretty much every other
// cloud or local option (Ollama, LM Studio, OpenAI, Groq, Cerebras, DeepSeek…)
// all speak this same request/response shape. A provider "preset" in
// Settings is just a suggested baseUrl/model — this file never branches on
// which one it's talking to.
//
// No agentic tool-use loop here: an arbitrary third-party model can't be
// trusted to honor file-access restrictions the way a tool-level sandbox
// could, so the caller hands this provider everything it needs already
// assembled (current code, last run, trimmed history) rather than letting it
// read files itself. A disclosed tradeoff, not a hidden limitation.
const MAX_TOOL_ROUNDS = 3;

// With `tools`, the model may ask the app to run a tool (the app executes it —
// the model only asks) before answering; capped at MAX_TOOL_ROUNDS so it can't
// spin. These rounds aren't streamed. If the provider or model rejects tools,
// this falls back to a plain answer so a tool-less model still works.
export async function* chat({ tools, runTool, ...rawOpts }) {
  // An empty turn in history (a reply that never arrived) makes Mistral
  // reject every later request with 400 — seen in a simulated session, where
  // one empty reply turned the rest of the conversation into errors.
  const opts = { ...rawOpts, history: (rawOpts.history ?? []).filter((m) => typeof m.content === "string" && m.content.trim()) };
  if (!tools?.length) return yield* streamChat(opts);

  const { systemPrompt, history = [], userContent, baseUrl, apiKey, model } = opts;
  const messages = [{ role: "system", content: systemPrompt }, ...history, { role: "user", content: userContent }];

  for (let round = 0; ; round++) {
    const lastRound = round >= MAX_TOOL_ROUNDS;
    let res;
    try {
      res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({ model, messages, tools, tool_choice: lastRound ? "none" : "auto", temperature: 0.3 }),
      });
    } catch {
      return yield* streamChat(opts); // let the plain path report the connection problem its usual way
    }
    // A 400/404/422 here is most often "this model doesn't do tools" — answer
    // without them rather than failing. Auth and rate limits get the plain
    // path's normal messages too.
    if (!res.ok) return yield* streamChat(opts);

    const msg = (await res.json()).choices?.[0]?.message;
    const calls = msg?.tool_calls ?? [];
    if (!calls.length || lastRound) {
      // Never finish silently: if the tool rounds end without any text,
      // answer the plain way instead.
      if (!msg?.content?.trim()) return yield* streamChat(opts);
      yield { type: "text", text: msg.content };
      yield { type: "done", usage: null };
      return;
    }

    messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: calls });
    for (const call of calls) {
      let args = {};
      try { args = JSON.parse(call.function.arguments || "{}"); } catch { /* malformed args — run with defaults */ }
      yield { type: "tool", name: call.function.name, args };
      const result = await runTool(call.function.name, args);
      messages.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content: JSON.stringify(result) });
    }
  }
}

async function* streamChat({ systemPrompt, history = [], userContent, baseUrl, apiKey, model, providerLabel }) {
  const messages = [{ role: "system", content: systemPrompt }, ...history, { role: "user", content: userContent }];

  let res;
  try {
    res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      // Low temperature deliberately — this is a tutor reasoning about a
      // specific learner's actual code, not a creative-writing task. Lower
      // variance also cuts the odds of drifting into a repeated-phrasing
      // loop when its own prior turns are sitting right there in history.
      body: JSON.stringify({ model, stream: true, messages, temperature: 0.3 }),
    });
  } catch (err) {
    yield { type: "text", text: `Couldn't reach ${baseUrl} — is it running? (${err.message})` };
    yield { type: "done", usage: null };
    return;
  }

  if (!res.ok || !res.body) {
    // Never fail silently — every one of these lands as a real message in
    // the tutor panel, not a swallowed error. Free-tier limits shift over
    // time on every provider here, so this deliberately says "try again in
    // a minute" instead of quoting a specific number that'll go stale.
    //
    // Status codes alone aren't reliable across providers here — confirmed
    // directly: Gemini's OpenAI-compat layer returns a plain 400 for a bad
    // key, not 401/403, with the real reason only in the body text ("Please
    // pass a valid API key"). Falling back to a body-text check catches that
    // case too instead of showing a vague generic message for it.
    const bodyText = await res.text().catch(() => "");
    const looksLikeAuthError = /api.?key|unauthoriz|authenticat/i.test(bodyText);
    let text;
    if (res.status === 429) text = "Rate limit reached — try again in a minute.";
    else if (res.status === 401 || res.status === 403 || looksLikeAuthError) text = `Invalid API key for ${providerLabel} — check it in Settings.`;
    else text = `Model connection failed (${res.status} ${res.statusText}).`;
    yield { type: "text", text };
    yield { type: "done", usage: null };
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop(); // last line may be incomplete — keep it for the next chunk
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6);
      if (payload === "[DONE]") continue;
      try {
        const chunk = JSON.parse(payload);
        const text = chunk.choices?.[0]?.delta?.content;
        if (text) yield { type: "text", text };
      } catch { /* a malformed chunk shouldn't kill the whole stream */ }
    }
  }
  yield { type: "done", usage: null }; // most OpenAI-compatible servers don't report usage on streamed responses — not something we can fabricate
}
