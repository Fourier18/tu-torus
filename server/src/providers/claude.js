import { query } from "@anthropic-ai/claude-agent-sdk";
import { createRequire } from "node:module";
import path from "node:path";

// [Electron packaging] The bundled claude.exe runs perfectly on its own
// (confirmed directly: `claude.exe --version` succeeds) — but the SDK's own
// internal spawn logic fails to launch it when this process is Electron
// hosting Node via ELECTRON_RUN_AS_NODE, not a real node.exe. The SDK's own
// error names the fix: pass the binary's real path explicitly so the SDK
// skips whatever resolution logic is tripping over that distinction.
const require = createRequire(import.meta.url);
function resolveClaudeBinary() {
  const platform = process.platform; // win32 | darwin | linux
  const arch = process.arch; // x64 | arm64
  try {
    const pkgPath = require.resolve(`@anthropic-ai/claude-agent-sdk-${platform}-${arch}/package.json`);
    return path.join(path.dirname(pkgPath), platform === "win32" ? "claude.exe" : "claude");
  } catch {
    return undefined; // not found — let the SDK fall back to its own default resolution
  }
}
const CLAUDE_BINARY = resolveClaudeBinary();

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
      ...(CLAUDE_BINARY ? { pathToClaudeCodeExecutable: CLAUDE_BINARY } : {}),
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
