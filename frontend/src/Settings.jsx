import { useState } from "react";

const PRESETS = {
  custom: { label: "Add your own", baseUrl: "", model: "", keyUrl: null },
  mistral: { label: "Mistral — Codestral", baseUrl: "https://api.mistral.ai/v1", model: "codestral-latest", keyUrl: "https://console.mistral.ai/api-keys" },
  gemini: { label: "Google Gemini — Flash", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/", model: "gemini-flash-latest", keyUrl: "https://aistudio.google.com/apikey" },
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "openrouter/free", keyUrl: "https://openrouter.ai/keys" },
  groq: { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: "mixtral-8x7b-32768", keyUrl: "https://console.groq.com/keys" },
  deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", keyUrl: "https://platform.deepseek.com/api_keys" },
  together: { label: "Together AI", baseUrl: "https://api.together.xyz/v1", model: "meta-llama/Meta-Llama-3-8B-Instruct-Turbo", keyUrl: "https://api.together.xyz/settings/keys" },
  perplexity: { label: "Perplexity", baseUrl: "https://api.perplexity.ai", model: "sonar-online", keyUrl: "https://www.perplexity.ai/settings/api" },
  ollama: { label: "Ollama (local)", baseUrl: "http://localhost:11434/v1", model: "mistral", keyUrl: null },
  lmstudio: { label: "LM Studio (local)", baseUrl: "http://localhost:1234/v1", model: "local-model", keyUrl: null },
};

function presetOf(provider) {
  return PRESETS[provider?.preset] ? provider.preset : "custom";
}

export default function Settings({ settings, onChange }) {
  const [open, setOpen] = useState(false);
  const [showProviders, setShowProviders] = useState(false);
  const initial = settings.provider || {};
  const [form, setForm] = useState({
    preset: presetOf(initial),
    baseUrl: initial.baseUrl ?? PRESETS[presetOf(initial)].baseUrl,
    model: initial.model ?? PRESETS[presetOf(initial)].model,
    apiKey: initial.apiKey ?? "",
  });
  const [saved, setSaved] = useState(true);

  const setTheme = (value) => {
    const previous = settings;
    onChange({ ...settings, theme: value }); // optimistic — apply immediately, don't wait on the round trip
    fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "theme", value }),
    })
      .then((r) => { if (!r.ok) throw new Error(); })
      .catch(() => onChange(previous)); // roll back — a save that silently failed shouldn't leave the UI claiming something that isn't true
  };

  const pickPreset = (preset) => {
    const p = PRESETS[preset];
    setForm({ preset, baseUrl: p.baseUrl, model: p.model, apiKey: "" }); // a key is provider-specific — carrying one over would silently send it to the wrong service
    setSaved(false);
  };

  const updateField = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  };

  const saveProvider = () => {
    const previous = settings;
    onChange({ ...settings, provider: form });
    setSaved(true);
    fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "provider", value: form }),
    })
      .then((r) => { if (!r.ok) throw new Error(); })
      .catch(() => { onChange(previous); setSaved(false); });
  };

  const preset = PRESETS[form.preset];

  return (
    <div className="settings">
      <button className="settings-toggle" onClick={() => setOpen((o) => !o)} aria-label="Settings">⚙</button>
      {open && (
        <div className="settings-panel">
          <label>
            Theme
            <select value={settings.theme} onChange={(e) => setTheme(e.target.value)}>
              <option value="light">Light (default)</option>
              <option value="dark">Dark</option>
            </select>
          </label>

          <div className="settings-divider" />

          <div style={{ marginBottom: "10px" }}>
            <div style={{ fontSize: "13px", color: "var(--text-dim)", marginBottom: "6px" }}>Provider</div>
            <button
              onClick={() => pickPreset("custom")}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "6px",
                border: form.preset === "custom" ? "1px solid var(--accent)" : "1px solid var(--border)",
                borderRadius: "4px",
                background: form.preset === "custom" ? "var(--accent)" : "var(--bg)",
                color: form.preset === "custom" ? "white" : "var(--text)",
                fontSize: "13px",
                cursor: "pointer",
                marginBottom: "6px"
              }}
            >
              Add your own
            </button>
            <button
              onClick={() => setShowProviders((s) => !s)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "6px",
                border: "1px solid var(--border)",
                borderRadius: "4px",
                background: "var(--bg)",
                color: "var(--text)",
                fontSize: "13px",
                cursor: "pointer",
                marginBottom: "6px"
              }}
            >
              {showProviders ? "▼" : "▶"} Browse providers
            </button>
            {showProviders && (
              <div style={{ marginLeft: "6px", borderLeft: "2px solid var(--border)", paddingLeft: "8px" }}>
                {Object.entries(PRESETS).filter(([k]) => k !== "custom").map(([key, p]) => (
                  <button
                    key={key}
                    onClick={() => { pickPreset(key); setShowProviders(false); }}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "6px",
                      border: form.preset === key ? "1px solid var(--accent)" : "1px solid var(--border)",
                      borderRadius: "4px",
                      background: form.preset === key ? "var(--accent)" : "var(--bg)",
                      color: form.preset === key ? "white" : "var(--text)",
                      fontSize: "12px",
                      cursor: "pointer",
                      marginBottom: "4px"
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <label>
            Base URL
            <input value={form.baseUrl} onChange={(e) => updateField("baseUrl", e.target.value)} placeholder="https://api.example.com/v1" />
          </label>
          <label>
            Model name
            <input value={form.model} onChange={(e) => updateField("model", e.target.value)} placeholder="model-id" />
          </label>
          <label>
            API key
            <input
              value={form.apiKey}
              onChange={(e) => updateField("apiKey", e.target.value)}
              type="password"
              placeholder={preset.keyUrl ? "paste your key" : "usually none for a local server"}
            />
          </label>
          {preset.keyUrl && (
            <div className="settings-hint">
              Get a key: <a href={preset.keyUrl} target="_blank" rel="noreferrer">{preset.keyUrl.replace("https://", "")}</a>
            </div>
          )}

          <div className="settings-hint">
            Free tiers from Mistral and Gemini may use your prompts for training data. A paid key generally avoids this.
          </div>
          <div className="settings-hint">
            Your API key is saved only on this machine — never sent anywhere but the provider you picked.
          </div>

          <button onClick={saveProvider} disabled={saved || !form.baseUrl || !form.model}>
            {saved ? "Saved" : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}
