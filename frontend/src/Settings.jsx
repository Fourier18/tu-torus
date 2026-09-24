import { useState } from "react";

// [DESIGN.md, Usage/context] "Default to the mid-tier Claude model, changeable
// in settings" — this is that setting, finally wired to a real control
// instead of only being editable by hand-editing .tutor/settings.json.
const MODELS = [
  { value: "haiku", label: "Haiku — fastest, cheapest" },
  { value: "sonnet", label: "Sonnet — balanced (default)" },
  { value: "opus", label: "Opus — most capable, slowest" },
];

export default function Settings({ settings, onChange }) {
  const [open, setOpen] = useState(false);

  const update = (key, value) => {
    const previous = settings;
    onChange({ ...settings, [key]: value }); // optimistic — apply immediately, don't wait on the network round trip
    fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    })
      .then((r) => { if (!r.ok) throw new Error(); })
      .catch(() => onChange(previous)); // roll back — otherwise a save that silently failed leaves the UI showing a value that isn't actually persisted, until the next reload reverts it with no explanation
  };

  return (
    <div className="settings">
      <button className="settings-toggle" onClick={() => setOpen((o) => !o)} aria-label="Settings">⚙</button>
      {open && (
        <div className="settings-panel">
          <label>
            Tutor model
            <select value={settings.model} onChange={(e) => update("model", e.target.value)}>
              {MODELS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </label>
          <label>
            Theme
            <select value={settings.theme} onChange={(e) => update("theme", e.target.value)}>
              <option value="light">Light (default)</option>
              <option value="dark">Dark</option>
            </select>
          </label>
        </div>
      )}
    </div>
  );
}
