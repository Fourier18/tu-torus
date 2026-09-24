// Generic OpenAI-compatible chat-completions client — covers Ollama, LM
// Studio, and most cloud providers (OpenAI, DeepSeek, many enterprise
// proxies) with one implementation, since they all speak this same shape.
// No agentic tool-use loop here (arbitrary third-party models can't be
// trusted to honor the same file-access restrictions the Claude path
// enforces at the tool level) — so the caller must hand this provider the
// context directly, already assembled, rather than letting it read files
// itself. That's a real, disclosed tradeoff, not a hidden limitation.
export async function* chat({ message, systemPrompt, contextText, baseUrl, apiKey, model }) {
  const userContent = contextText ? `${contextText}\n\n---\n\n${message}` : message;

  let res;
  try {
    res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        stream: true,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
      }),
    });
  } catch (err) {
    yield { type: "text", text: `Couldn't reach ${baseUrl} — is it running? (${err.message})` };
    yield { type: "done", usage: null };
    return;
  }

  if (!res.ok || !res.body) {
    yield { type: "text", text: `Model connection failed (${res.status} ${res.statusText}).` };
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
