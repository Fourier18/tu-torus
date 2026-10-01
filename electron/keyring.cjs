// The server keeps the API key encrypted at rest (server/src/keyring.js),
// but safeStorage exists only in Electron's main process, so the server asks
// over the IPC channel and gets the result back. On Windows, safeStorage
// protects the encrypted key with the user's own account (DPAPI).
const { safeStorage } = require("electron");

function attachKeyring(child) {
  child.on("message", (msg) => {
    if (msg?.type !== "keyring") return;
    const reply = (fields) => child.connected && child.send({ type: "keyring", id: msg.id, ...fields });
    try {
      if (msg.op === "available") return reply({ ok: true, result: safeStorage.isEncryptionAvailable() });
      if (!safeStorage.isEncryptionAvailable()) return reply({ ok: false, error: "Encryption isn't available on this computer." });
      if (msg.op === "encrypt") return reply({ ok: true, result: safeStorage.encryptString(String(msg.data)).toString("base64") });
      if (msg.op === "decrypt") return reply({ ok: true, result: safeStorage.decryptString(Buffer.from(String(msg.data), "base64")) });
      reply({ ok: false, error: "Unknown request." });
    } catch (err) {
      reply({ ok: false, error: err.message });
    }
  });
}

module.exports = { attachKeyring };
