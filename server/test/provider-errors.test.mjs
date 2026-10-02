// What the tutor panel shows when the AI provider misbehaves (testing plan
// W8, connection checks). A local stand-in for an OpenAI-compatible
// provider answers each request according to the model name: a normal
// streamed reply, a bad key (as 401, and as Gemini's 400 with the reason in
// the body), an unknown model, a rate limit, an empty account, an outage,
// an empty reply, a reply that never comes, a model that refuses tools, and
// a tool call. Every case must end in a plain message, never silence or a
// hang.
//
// usage: node server/test/provider-errors.test.mjs
import { createServer } from "node:http";
import { chat } from "../src/providers/openai-compatible.js";

const sse = (res, parts) => {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const p of parts) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`);
  res.end("data: [DONE]\n\n");
};
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    const { model, tools, messages } = JSON.parse(body || "{}");
    const json = (status, obj) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
    switch (model) {
      case "ok": return sse(res, ["Hello", " there."]);
      case "bad-key": return json(401, { error: { message: "Unauthorized" } });
      case "gemini-bad-key": return json(400, { error: { message: "API key not valid. Please pass a valid API key." } });
      case "no-model": return json(404, { error: { message: "The model `no-model` does not exist", code: "model_not_found" } });
      case "no-model-400": return json(400, { error: { message: "Invalid model: no-model-400" } });
      case "rate": return json(429, { error: { message: "Too many requests" } });
      case "payment": return json(402, { error: { message: "Insufficient credits" } });
      case "outage": return json(503, { error: { message: "Service unavailable" } });
      case "empty": return sse(res, []);
      case "hang": return; // never answers
      case "stall": res.writeHead(200, { "Content-Type": "text/event-stream" }); res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "Half" } }] })}\n\n`); return; // starts, then goes quiet
      case "no-tools": return tools ? json(400, { error: { message: "tools not supported for this model" } }) : sse(res, ["Plain answer."]);
      case "garbled-tools": if (tools) { res.writeHead(200, { "Content-Type": "application/json" }); return res.end("{not json"); } return sse(res, ["Recovered."]);
      case "tool-call": {
        if (!tools) return sse(res, ["no tools?"]);
        const answered = messages.some((m) => m.role === "tool");
        if (!answered) return json(200, { choices: [{ message: { role: "assistant", content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "run_learner_code", arguments: "{\"inputs\":[]}" } }] } }] });
        return json(200, { choices: [{ message: { role: "assistant", content: "I ran it: it works." } }] });
      }
      default: return json(500, {});
    }
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;

// Short limits for the two waiting cases, so the test takes seconds.
process.env.TUTOR_RESPONSE_TIMEOUT_MS = "1500";
process.env.TUTOR_STREAM_STALL_MS = "1500";

const ask = async (model, extra = {}) => {
  let text = ""; const events = [];
  const started = Date.now();
  for await (const e of chat({ systemPrompt: "s", history: [], userContent: "u", baseUrl: extra.baseUrl ?? baseUrl, apiKey: "k", model, providerLabel: "TestProvider", ...extra })) {
    events.push(e.type);
    if (e.type === "text") text += e.text;
  }
  return { text, events, ms: Date.now() - started };
};
const tool = { type: "function", function: { name: "run_learner_code", parameters: { type: "object", properties: {} } } };

let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  ${JSON.stringify(detail)}`}`); if (!ok) failed++; };

let r = await ask("ok"); check("normal reply streams", r.text === "Hello there.", r);
r = await ask("bad-key"); check("bad key (401) → check the key", /API key/i.test(r.text) && /Settings/.test(r.text), r);
r = await ask("gemini-bad-key"); check("bad key reported as 400 with reason in body → check the key", /API key/i.test(r.text), r);
r = await ask("no-model"); check("unknown model (404) → check the model name", /model/i.test(r.text) && /Settings/.test(r.text) && /no-model/.test(r.text), r);
r = await ask("no-model-400"); check("unknown model (400) → check the model name", /model/i.test(r.text) && /Settings/.test(r.text), r);
r = await ask("rate"); check("rate limit → try again", /rate limit/i.test(r.text), r);
r = await ask("payment"); check("empty account (402) → plain message about credit", /credit|plan|billing|balance/i.test(r.text), r);
r = await ask("outage"); check("outage (503) → the provider has a problem, try again", /try again/i.test(r.text) && /503/.test(r.text), r);
r = await ask("empty"); check("empty reply → says so", /empty|no reply|nothing/i.test(r.text), r);
r = await ask("hang"); check("no answer at all → gives up with a message", /didn't answer|no answer|timed out|took too long/i.test(r.text) && r.ms < 10000, r);
r = await ask("stall"); check("reply that stops partway → ends with a message", r.text.startsWith("Half") && /stopped|cut off|didn't finish/i.test(r.text) && r.ms < 10000, r);
r = await ask("ok", { baseUrl: "http://127.0.0.1:9/v1" }); check("unreachable server → says it couldn't be reached, plainly", /couldn't reach/i.test(r.text) && !/fetch failed/.test(r.text), r);
r = await ask("no-tools", { tools: [tool], runTool: async () => ({}) }); check("model that refuses tools → plain answer instead", r.text === "Plain answer.", r);
r = await ask("garbled-tools", { tools: [tool], runTool: async () => ({}) }); check("garbled tool reply → plain answer instead of a crash", r.text === "Recovered.", r);
r = await ask("tool-call", { tools: [tool], runTool: async () => ({ screen: "ok" }) }); check("tool call → runs it, then answers", r.events.includes("tool") && r.text === "I ran it: it works.", r);

server.close();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
