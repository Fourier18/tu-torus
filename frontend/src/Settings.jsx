import { useState } from "react";

const MODELS = [
  { value: "haiku", label: "Haiku — fastest, cheapest" },
  { value: "sonnet", label: "Sonnet — balanced (default)" },
  { value: "opus", label: "Opus — most capable, slowest" },
];

export default function Settings({ settings, onChange }) {
  const [open, setOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [form, setForm] = useState({ baseUrl: "http://localhost:11434/v1", apiKey: "", model: "" });

  const save = (next) => {
    const previous = settings;
    onChange(next); // optimistic — apply immediately, don't wait on the network round trip
    fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "provider", value: next.provider }),
    })
      .then((r) => { if (!r.ok) throw new Error(); })
      .catch(() => onChange(previous)); // roll back — a save that silently failed shouldn't leave the UI claiming something that isn't true
  };

  const update = (key, value) => {
    if (key === "model") { save({ ...settings, model: value }); return; }
    if (key === "theme") { save({ ...settings, theme: value }); return; }
  };

  const connect = () => save({ ...settings, provider: { type: "custom", ...form } });
  const useClaudeInstead = () => save({ ...settings, provider: { type: "claude" } });

  const usingCustom = settings.provider?.type === "custom";

  return (
    <div className="settings">
      <button className="settings-toggle" onClick={() => setOpen((o) => !o)} aria-label="Settings">⚙</button>
      {open && (
        <div className="settings-panel">
          {!usingCustom && (
            <label>
              Tutor model
              <select value={settings.model} onChange={(e) => update("model", e.target.value)}>
                {MODELS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </label>
          )}
          <label>
            Theme
            <select value={settings.theme} onChange={(e) => update("theme", e.target.value)}>
              <option value="light">Light (default)</option>
              <option value="dark">Dark</option>
            </select>
          </label>

          <div className="settings-divider" />

          {usingCustom ? (
            <div className="provider-status">
              <div>Using your own model: <strong>{settings.provider.model || "(unnamed)"}</strong></div>
              <div className="provider-url">{settings.provider.baseUrl}</div>
              <button className="link-btn" onClick={useClaudeInstead}>Switch back to Claude</button>
            </div>
          ) : connecting ? (
            <div className="connect-form">
              <label>
                Server address
                <input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="http://localhost:11434/v1" />
              </label>
              <label>
                Model name
                <input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="llama3" />
              </label>
              <label>
                API key (only if it needs one)
                <input value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} type="password" />
              </label>
              <div className="connect-form-actions">
                <button onClick={connect} disabled={!form.baseUrl || !form.model}>Connect</button>
                <button className="link-btn" onClick={() => setConnecting(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <button className="link-btn" onClick={() => setConnecting(true)}>Connect a different model…</button>
          )}
        </div>
      )}
    </div>
  );
}
