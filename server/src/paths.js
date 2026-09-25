// Fixed by location, not by process.cwd() — cwd depends on how/where the
// server was launched, which should never change what "the project" means.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..", ".."); // tu-torus/

export const WORKSPACE_DIR = path.join(REPO_ROOT, "workspace"); // the user's actual project files
export const TUTOR_DIR = path.join(WORKSPACE_DIR, ".tutor"); // run records, settings, usage log, tmp — lives inside the workspace, next to what it's about

// The packaged Electron app never had a `workspace/` directory at all — the
// `files` glob in package.json's build config only ever listed
// electron/server/frontend, never workspace. Created here, at the source,
// so this is robust regardless of packaging config rather than depending on
// a files glob being remembered and kept in sync.
mkdirSync(TUTOR_DIR, { recursive: true });
