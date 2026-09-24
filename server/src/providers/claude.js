import { query } from "@anthropic-ai/claude-agent-sdk";

// [DESIGN.md, Panel 3] Tool list is a setting, not a hardcoded assumption:
// default mode = read-only (no pop-ups/suggestions/agent-written code).
//
// IMPORTANT: `allowedTools` does NOT restrict built-in tools — confirmed open
// bug, anthropics/claude-agent-sdk-typescript#115 (Bash/Edit/Write remain
// available even when omitted from allowedTools). `disallowedTools` is the
// mechanism that actually removes a tool from the model's context.
const TOOL_MODES = {
  reactive: ["Bash", "BashOutput", "KillShell", "Write", "Edit", "MultiEdit", "NotebookEdit", "Task", "SlashCommand"],
};

// Normalized shape every provider yields: {type:'text', text} chunks, then
// one {type:'done', usage}. index.js and the browser only ever see this —
// never a provider-specific event format.
export async function* chat({ message, projectDir, model, systemPrompt, mode = "reactive" }) {
  let usage = null;
  for await (const event of query({
    prompt: message,
    options: {
      cwd: projectDir,
      systemPrompt,
      disallowedTools: TOOL_MODES[mode],
      settingSources: [], // don't load the user's own CLAUDE.md, plugins, skills, or MCP servers
      model,
      permissionMode: "bypassPermissions", // safe only because disallowedTools has already removed every write/exec tool
    },
  })) {
    if (event.type === "assistant") {
      const text = Array.isArray(event.message.content)
        ? event.message.content.map((b) => b.text || "").join("")
        : event.message.content;
      if (text) yield { type: "text", text };
    }
    if (event.type === "result") usage = event.usage;
  }
  yield { type: "done", usage };
}
