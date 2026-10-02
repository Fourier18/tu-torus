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
const requests = []; // what each request carried: model, tools or not, the system prompt
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    const { model, tools, messages, tool_choice } = JSON.parse(body || "{}");
    requests.push({ model, tools: Boolean(tools), system: messages?.[0]?.content, tool_choice });
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
      // Says it ran the code without calling the tool, unless a call is required.
      case "claims-run": {
        if (!tools) return sse(res, ["no tools?"]);
        if (messages.some((m) => m.role === "tool")) return json(200, { choices: [{ message: { role: "assistant", content: "It prints 53." } }] });
        if (tool_choice === "required") return json(200, { choices: [{ message: { role: "assistant", content: "", tool_calls: [{ id: "c2", type: "function", function: { name: "run_learner_code", arguments: "{\"inputs\":[]}" } }] } }] });
        return json(200, { choices: [{ message: { role: "assistant", content: "I ran it just now: it prints 53." } }] });
      }
      // Says it ran the code whatever it's asked; honest without tools.
      case "claims-run-always": return tools ? json(200, { choices: [{ message: { role: "assistant", content: "I ran it: fine." } }] }) : sse(res, ["Going by the code, it prints 53."]);
      // Claims a run of changed code, unless the system prompt says not to.
      case "changed-run": return json(200, { choices: [{ message: { role: "assistant", content: messages[0].content.endsWith(" +AGAIN") ? "Changing it to 5 would print 8." : "I changed it to 5 and ran it: 8." } }] });
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

// The tool's guidance goes only with the tool. An answer made without the
// tool must not be told about it — that's when the tutor claimed runs it
// never made.
const notes = { toolNote: " +TOOL-NOTE", noToolNote: " +NO-TOOL-NOTE" };
const since = (n) => requests.slice(n);
let n = requests.length;
r = await ask("tool-call", { tools: [tool], runTool: async () => ({ screen: "ok" }), ...notes });
check("requests with the tool carry its note", since(n).length === 2 && since(n).every((q) => q.tools && q.system === "s +TOOL-NOTE"), since(n));
n = requests.length;
r = await ask("no-tools", { tools: [tool], runTool: async () => ({}), ...notes });
check("model that refuses tools → the plain answer gets the no-tool note, not the tool's", r.text === "Plain answer." && since(n).length === 2 && since(n)[1].tools === false && since(n)[1].system === "s +NO-TOOL-NOTE" && r.events.includes("fallback"), { r, requests: since(n) });
n = requests.length;
r = await ask("garbled-tools", { tools: [tool], runTool: async () => ({}), ...notes });
check("garbled tool reply → the plain answer gets the no-tool note", r.text === "Recovered." && since(n)[1]?.system === "s +NO-TOOL-NOTE", since(n));
n = requests.length;
r = await ask("rate", { tools: [tool], runTool: async () => ({}), ...notes });
check("rate limit with tools → says so after one request, no answer without the tool", /rate limit/i.test(r.text) && since(n).length === 1 && !r.events.includes("fallback"), { r, requests: since(n) });
n = requests.length;
r = await ask("bad-key", { tools: [tool], runTool: async () => ({}), ...notes });
check("bad key with tools → check the key, one request", /API key/i.test(r.text) && /Settings/.test(r.text) && since(n).length === 1, { r, requests: since(n) });
n = requests.length;
r = await ask("gemini-bad-key", { tools: [tool], runTool: async () => ({}), ...notes });
check("bad key as 400 with tools → still reported as a bad key", /API key/i.test(r.text), r);
r = await ask("outage", { tools: [tool], runTool: async () => ({}), ...notes });
check("outage with tools → the provider has a problem, try again", /try again/i.test(r.text) && /503/.test(r.text), r);

// An answer is reviewed before it's shown. One that needs a run it didn't
// get is asked for again with the run required; one claiming something no
// run backs is asked for again with a note; a model that keeps failing gets
// its answer made without the tool.
const review = (t, { ran }) => (!ran && /\bI ran\b/.test(t) ? "run" : /\bI changed\b/.test(t) ? " +AGAIN" : null);
n = requests.length;
r = await ask("claims-run", { tools: [tool], runTool: async () => ({ screen: "53" }), ...notes, review });
check("claims a run it didn't make → the run is required, and the real answer shown", r.text === "It prints 53." && r.events.includes("tool") && since(n).map((q) => q.tool_choice).join() === "auto,required,auto", { r, requests: since(n) });
n = requests.length;
r = await ask("claims-run-always", { tools: [tool], runTool: async () => ({}), ...notes, review });
check("keeps claiming without running → answered without the tool, no claim shown", r.text === "Going by the code, it prints 53." && r.events.includes("fallback") && since(n).length === 3 && since(n)[2].system === "s +NO-TOOL-NOTE", { r, requests: since(n) });
n = requests.length;
r = await ask("tool-call", { tools: [tool], runTool: async () => ({ screen: "ok" }), ...notes, review });
check("claims a run it did make → shown as is", r.text === "I ran it: it works." && since(n).length === 2, { r, requests: since(n) });
n = requests.length;
r = await ask("changed-run", { tools: [tool], runTool: async () => ({}), ...notes, review });
check("claims a run of changed code → asked again with the note, the second answer shown", r.text === "Changing it to 5 would print 8." && since(n).length === 2 && since(n)[1].system === "s +TOOL-NOTE +AGAIN", { r, requests: since(n) });

server.close();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
