import { useEffect, useState } from "react";

// The tutor's own notes about the learner (it keeps them up to date itself).
// Shown here so nothing it remembers is hidden, and so a wrong note can be
// corrected or wiped. Reloaded each time Settings opens, since the tutor may
// have changed them since.
function LearnerNotes() {
  const [notes, setNotes] = useState("");
  const [max, setMax] = useState(1200);
  const [status, setStatus] = useState("loading"); // loading | saved | edited | error

  useEffect(() => {
    fetch("/api/learner-notes")
      .then((r) => r.json())
      .then((d) => { setNotes(d.notes); setMax(d.max); setStatus("saved"); })
      .catch(() => setStatus("error"));
  }, []);

  const save = (value) => {
    fetch("/api/learner-notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notes: value }) })
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d) => { setNotes(d.notes); setStatus("saved"); })
      .catch(() => setStatus("error"));
  };

  return (
    <div>
      <div style={{ fontSize: "13px", color: "var(--text-dim)", marginBottom: "6px" }}>What the tutor remembers about you</div>
      <textarea
        value={notes}
        maxLength={max}
        rows={5}
        style={{ width: "100%", boxSizing: "border-box", fontSize: "12px", fontFamily: "inherit" }}
        placeholder={status === "loading" ? "Loading…" : "Nothing yet — the tutor adds notes as it gets to know how you're doing."}
        onChange={(e) => { setNotes(e.target.value); setStatus("edited"); }}
      />
      <div style={{ display: "flex", gap: "6px", marginTop: "4px" }}>
        <button onClick={() => save(notes)} disabled={status !== "edited"}>{status === "edited" ? "Save notes" : "Saved"}</button>
        <button onClick={() => { setNotes(""); save(""); }} disabled={!notes}>Clear</button>
      </div>
      {status === "error" && <div className="settings-hint">Couldn't reach the app's server — notes not saved.</div>}
    </div>
  );
}

// Deliberately no hardcoded `model` values here. A specific model ID
// (e.g. a frozen Groq snapshot name) goes stale the moment that provider
// retires it — this app would keep silently offering a dead default with
// no way to notice short of someone hitting the error. baseUrl and keyUrl
// are structural (a provider's API endpoint and signup page don't change
// week to week); modelsUrl points at that provider's own live, current
// model list, so "what's the right model name" is always answered by the
// provider's own page, not by a string we'd have to keep maintaining here.
const PRESETS = {
  custom: { label: "Add your own", baseUrl: "", keyUrl: null, modelsUrl: null },
  mistral: { label: "Mistral", baseUrl: "https://api.mistral.ai/v1", keyUrl: "https://console.mistral.ai/api-keys", modelsUrl: "https://docs.mistral.ai/getting-started/models/models_overview/" },
  gemini: { label: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/", keyUrl: "https://aistudio.google.com/apikey", modelsUrl: "https://ai.google.dev/gemini-api/docs/models" },
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", keyUrl: "https://openrouter.ai/keys", modelsUrl: "https://openrouter.ai/models" },
  groq: { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", keyUrl: "https://console.groq.com/keys", modelsUrl: "https://console.groq.com/docs/models" },
  deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", keyUrl: "https://platform.deepseek.com/api_keys", modelsUrl: "https://api-docs.deepseek.com/quick_start/pricing" },
  together: { label: "Together AI", baseUrl: "https://api.together.xyz/v1", keyUrl: "https://api.together.xyz/settings/keys", modelsUrl: "https://www.together.ai/models" },
  perplexity: { label: "Perplexity", baseUrl: "https://api.perplexity.ai", keyUrl: "https://www.perplexity.ai/settings/api", modelsUrl: "https://docs.perplexity.ai/getting-started/models" },
  ollama: { label: "Ollama (local)", baseUrl: "http://localhost:11434/v1", keyUrl: null, modelsUrl: "https://ollama.com/library" },
  lmstudio: { label: "LM Studio (local)", baseUrl: "http://localhost:1234/v1", keyUrl: null, modelsUrl: null },
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
    model: initial.model ?? "",
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
    setForm({ preset, baseUrl: p.baseUrl, model: "", apiKey: "" }); // a key is provider-specific — carrying one over would silently send it to the wrong service; model is left blank on purpose, see PRESETS comment
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
          {preset.modelsUrl && (
            <div className="settings-hint">
              See current models: <a href={preset.modelsUrl} target="_blank" rel="noreferrer">{preset.modelsUrl.replace("https://", "")}</a> — copy the exact model ID from there, since provider lineups change over time.
            </div>
          )}
          <label>
            Model name
            <input value={form.model} onChange={(e) => updateField("model", e.target.value)} placeholder={preset.modelsUrl ? "paste the model ID from the link above" : "model-id"} />
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

          <div className="settings-divider" />
          <LearnerNotes />
        </div>
      )}
    </div>
  );
}
