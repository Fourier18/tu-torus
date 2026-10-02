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

// How long to wait for a provider: for the reply to start, and between
// pieces of a streamed reply. A provider that never answered used to leave
// the tutor "thinking" forever. Read per call so tests can shorten them.
const responseTimeout = () => Number(process.env.TUTOR_RESPONSE_TIMEOUT_MS) || 90_000;
const streamStall = () => Number(process.env.TUTOR_STREAM_STALL_MS) || 60_000;

// Why a request never got a reply, in plain words.
function unreachable(baseUrl, err) {
  const code = err?.cause?.code ?? err?.code;
  if (err?.name === "TimeoutError" || err?.name === "AbortError") return `The AI provider didn't answer within ${Math.round(responseTimeout() / 1000)} seconds — try again in a minute.`;
  if (code === "ECONNREFUSED") return `Couldn't reach ${baseUrl} — nothing answered there. If it's a local server (Ollama, LM Studio), is it running?`;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return `Couldn't reach ${baseUrl} — that address wasn't found. Check the base URL in Settings, and that this computer is online.`;
  return `Couldn't reach ${baseUrl} — check the base URL in Settings, and that this computer is online.`;
}

// A provider's refusal, in plain words. Status codes alone aren't reliable
// across providers (Gemini's OpenAI-compatible layer answers a bad key with a
// plain 400 and the reason only in the body), so the body is read too.
function refusal(res, bodyText, { model, providerLabel }) {
  if (res.status === 429) return "Rate limit reached — try again in a minute.";
  if (res.status === 401 || res.status === 403 || /api.?key|unauthoriz|authenticat/i.test(bodyText)) return `Invalid API key for ${providerLabel} — check it in Settings.`;
  if (res.status === 402 || /insufficient|credit|balance|billing|payment required/i.test(bodyText)) return `${providerLabel} says the account needs credit or a plan (${res.status}) — check your account on their website.`;
  if ((res.status === 404 || res.status === 400 || res.status === 422) && /model/i.test(bodyText)) return `The model "${model}" wasn't found at ${providerLabel} — check the model name in Settings (the provider's model list has the exact names).`;
  if (res.status >= 500) return `${providerLabel} had a problem answering (${res.status}) — try again in a minute.`;
  return `Model connection failed (${res.status} ${res.statusText}).`;
}

// Events: {type:"text", text} — with notice: true when the text is this
// app's own message (a refusal, a timeout, an empty reply) rather than the
// model's words — then {type:"done"}. Callers use `notice` to keep such
// text out of the learner notes and to retry in the test suites.
//
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
    let data;
    try {
      res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({ model, messages, tools, tool_choice: lastRound ? "none" : "auto", temperature: 0.3 }),
        signal: AbortSignal.timeout(responseTimeout()),
      });
      // A 400/404/422 here is most often "this model doesn't do tools" —
      // answer without them rather than failing. Auth and rate limits get the
      // plain path's normal messages too.
      if (!res.ok) return yield* streamChat(opts);
      data = await res.json();
    } catch (err) {
      // No answer in time: say so now rather than waiting all over again.
      if (err?.name === "TimeoutError") { yield { type: "text", text: unreachable(baseUrl, err), notice: true }; yield { type: "done", usage: null }; return; }
      return yield* streamChat(opts); // unreachable, or a reply that wasn't JSON — the plain path reports or recovers
    }

    const msg = data?.choices?.[0]?.message;
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

  // One controller for the whole request: it gives up if the reply hasn't
  // started within responseTimeout(), or if a started reply goes quiet for
  // streamStall().
  const abort = new AbortController();
  let timer = setTimeout(() => abort.abort(Object.assign(new Error("timeout"), { name: "TimeoutError" })), responseTimeout());
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
      signal: abort.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    yield { type: "text", text: unreachable(baseUrl, abort.signal.aborted ? abort.signal.reason : err), notice: true };
    yield { type: "done", usage: null };
    return;
  }

  if (!res.ok || !res.body) {
    // Never fail silently — every one of these lands as a real message in
    // the tutor panel, not a swallowed error. Free-tier limits shift over
    // time on every provider here, so the messages say "try again in a
    // minute" instead of quoting a specific number that'll go stale.
    clearTimeout(timer);
    const bodyText = await res.text().catch(() => "");
    yield { type: "text", text: refusal(res, bodyText, { model, providerLabel }), notice: true };
    yield { type: "done", usage: null };
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let said = false;
  const quiet = () => { clearTimeout(timer); timer = setTimeout(() => abort.abort(Object.assign(new Error("stalled"), { name: "TimeoutError" })), streamStall()); };
  quiet();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      quiet();
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
          if (text) { said = true; yield { type: "text", text }; }
        } catch { /* a malformed chunk shouldn't kill the whole stream */ }
      }
    }
  } catch {
    // The reply stopped partway (or never got going after the headers).
    yield { type: "text", text: said ? "\n\n(The reply stopped partway — the provider went quiet. Try asking again.)" : unreachable(baseUrl, { name: "TimeoutError" }), notice: true };
    said = true;
  } finally {
    clearTimeout(timer);
  }
  if (!said) yield { type: "text", text: "The model sent back an empty reply — try asking again.", notice: true };
  yield { type: "done", usage: null }; // most OpenAI-compatible servers don't report usage on streamed responses — not something we can fabricate
}
