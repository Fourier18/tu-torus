import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getSettings } from "./settings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INSTRUCTIONS_PATH = path.join(__dirname, "tutor-instructions.md");

// [DESIGN.md, Panel 3] Tool list is a setting, not a hardcoded assumption:
// default mode = read-only (no pop-ups/suggestions/agent-written code).
// A future "live suggestions" mode removes Edit/Write from this block list.
//
// IMPORTANT: `allowedTools` does NOT restrict built-in tools — confirmed open
// bug, anthropics/claude-agent-sdk-typescript#115 (Bash/Edit/Write remain
// available even when omitted from allowedTools). `disallowedTools` is the
// mechanism that actually removes a tool from the model's context. Enforce
// read-only by blocking everything that can write or execute, not by trying
// to allow-list three tools.
const TOOL_MODES = {
  reactive: ["Bash", "BashOutput", "KillShell", "Write", "Edit", "MultiEdit", "NotebookEdit", "Task", "SlashCommand"],
};

export async function* askTutor({ message, projectDir, mode = "reactive" }) {
  const systemPrompt = await readFile(INSTRUCTIONS_PATH, "utf-8");
  const { model } = await getSettings(); // user-changeable — never hardcode this

  for await (const event of query({
    prompt: message,
    options: {
      cwd: projectDir,
      systemPrompt, // custom string — replaces Claude Code's own coding-agent prompt, not appended to it
      disallowedTools: TOOL_MODES[mode], // the actual enforcement — see note above
      settingSources: [], // don't load the user's own CLAUDE.md, plugins, skills, or MCP servers
      model,
      permissionMode: "bypassPermissions", // safe only because disallowedTools has already removed every write/exec tool
    },
  })) {
    yield event;
  }
}
