// Fixed by location, not by process.cwd() — cwd depends on how/where the
// server was launched, which should never change what "the project" means.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..", ".."); // tu-torus/

export const WORKSPACE_DIR = path.join(REPO_ROOT, "workspace"); // the user's actual project files — all the tutor's Read/Glob/Grep can see
export const TUTOR_DIR = path.join(WORKSPACE_DIR, ".tutor"); // run records, settings, usage log, tmp — lives inside the workspace so the tutor's Read/Glob can reach run records directly

// The packaged Electron app never had a `workspace/` directory at all —
// the `files` glob in package.json's build config only ever listed
// electron/server/frontend, never workspace. Confirmed as the actual root
// cause of the Claude tutor's launch failure inside the packaged app: the
// Agent SDK spawns its native binary with this as its working directory,
// and Windows CreateProcess fails with ENOENT for a missing *working
// directory*, not just a missing executable — which is exactly what the
// SDK's error looked like ("binary exists but failed to launch"). Creating
// it here, at the source, so this is robust regardless of packaging config
// rather than depending on a files glob being remembered and kept in sync.
mkdirSync(TUTOR_DIR, { recursive: true });
