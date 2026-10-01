// Encrypting the API key at rest. Electron's safeStorage (Windows: the
// account's own data protection, DPAPI) is only available in Electron's main
// process, and this server runs as a separate Node process — so it asks the
// main process over the IPC channel electron/main.js opens when it starts
// the server. Without that channel (development, tests) there is no keyring
// and settings.js keeps the key as before.
const pending = new Map();
let nextId = 1;

const channel = typeof process.send === "function";
if (channel) {
  process.on("message", (msg) => {
    if (msg?.type !== "keyring" || !pending.has(msg.id)) return;
    const { resolve, reject, timer } = pending.get(msg.id);
    pending.delete(msg.id);
    clearTimeout(timer);
    if (msg.ok) resolve(msg.result); else reject(new Error(msg.error || "keyring error"));
  });
}

function call(op, data) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("The app didn't answer the encryption request.")); }, 5000);
    pending.set(id, { resolve, reject, timer });
    process.send({ type: "keyring", id, op, data });
  });
}

let availability = null;
// True only when the main process can actually encrypt (it reports
// safeStorage.isEncryptionAvailable()).
export function keyringAvailable() {
  if (!channel) return Promise.resolve(false);
  availability ??= call("available").then(Boolean, () => false);
  return availability;
}
export const encryptSecret = (plain) => call("encrypt", plain); // → base64
export const decryptSecret = (base64) => call("decrypt", base64); // → plain text
