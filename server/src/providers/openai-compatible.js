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
export async function* chat({ systemPrompt, history = [], userContent, baseUrl, apiKey, model, providerLabel }) {
  const messages = [{ role: "system", content: systemPrompt }, ...history, { role: "user", content: userContent }];

  let res;
  try {
    res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ model, stream: true, messages }),
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
