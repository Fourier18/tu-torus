// Learner notes must keep working on providers that reject JSON mode.
// Runs against fake OpenAI-compatible servers on this machine — no API key,
// no network. Run: node server/test/notes-provider.test.mjs
import http from "node:http";
import { reviseLearnerNotes } from "../src/learner-notes.js";

const exchanges = [{ learner: "i'm new to coding, why does nothing print", tutor: "Your function returns but nothing prints it." }];
const proposal = JSON.stringify({ add: [{ note: "New to coding.", evidence: "i'm new to coding" }], remove: [] });

function fakeProvider({ acceptsJsonMode, replyText }) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const parsed = JSON.parse(body);
      const jsonMode = !!parsed.response_format;
      seen.push(jsonMode ? "json-mode" : "plain");
      if (jsonMode && !acceptsJsonMode) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: { message: "response_format is not supported by this model" } }));
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: replyText } }] }));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, seen, baseUrl: `http://127.0.0.1:${server.address().port}/v1` })));
}

const cases = [
  ["provider with JSON mode", { acceptsJsonMode: true, replyText: proposal }, ["json-mode"]],
  ["provider without JSON mode, plain JSON reply", { acceptsJsonMode: false, replyText: proposal }, ["json-mode", "plain"]],
  ["provider without JSON mode, chatty fenced reply", { acceptsJsonMode: false, replyText: `Sure! Here are the changes:\n\`\`\`json\n${proposal}\n\`\`\`` }, ["json-mode", "plain"]],
];

let failed = 0;
for (const [name, opts, expectRequests] of cases) {
  const { server, seen, baseUrl } = await fakeProvider(opts);
  const r = await reviseLearnerNotes({ notes: "", exchanges, baseUrl, apiKey: "test", model: "fake" });
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
  const pass = r?.notes === "New to coding." && JSON.stringify(seen) === JSON.stringify(expectRequests);
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  (requests: ${seen.join(" → ")}; notes: ${JSON.stringify(r?.notes)})`);
}
console.log(failed ? `${failed} failed` : "all passed");
process.exitCode = failed ? 1 : 0;
