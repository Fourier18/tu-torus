// Text contrast in every theme, against WCAG 2.1 level AA: 4.5:1 for the
// app's text (most of it is 12–14px) and 3:1 for the outlines of input
// boxes and controls. Reads the theme files themselves, so a new theme or a changed
// color is checked as it is.
//
// usage: node scripts/check-contrast.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "frontend", "src");
const css = ["theme.css", "theme-dark.css", "themes.css"].map((f) => readFileSync(path.join(src, f), "utf8")).join("\n");

// Theme name → { token: color }. :root is the light theme and the fallback.
const themes = {};
for (const m of css.matchAll(/(:root|\[data-theme="([\w-]+)"\])\s*\{([^}]*)\}/g)) {
  const name = m[2] || "light";
  themes[name] = { ...(themes[name] || {}) };
  for (const v of m[3].matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})/g)) themes[name][v[1]] = v[2];
}
const base = themes.light;

const lum = (hex) => {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const PAIRS = [
  ["text", "bg", 4.5], ["text", "panel-bg", 4.5],
  ["text-dim", "bg", 4.5], ["text-dim", "panel-bg", 4.5],
  ["accent", "bg", 4.5], ["accent", "panel-bg", 4.5], // links
  ["on-accent", "accent", 4.5], // text on buttons
  ["error", "bg", 4.5], ["error", "panel-bg", 4.5],
  // Outlines of input boxes and controls (--control-border); the thin
  // decorative --border between panels has no minimum.
  ["control-border", "bg", 3], ["control-border", "panel-bg", 3],
];

let failed = 0;
for (const [name, own] of Object.entries(themes)) {
  const t = { "on-accent": "#ffffff", ...base, ...own };
  const rows = [];
  for (const [fg, bg, min] of PAIRS) {
    const r = ratio(t[fg], t[bg]);
    const ok = r >= min;
    if (!ok) failed++;
    rows.push(`${ok ? "  " : "✗ "} ${fg} on ${bg}: ${r.toFixed(2)} (needs ${min})`);
  }
  console.log(`${name}\n${rows.join("\n")}`);
}
console.log(`\n${failed ? `${failed} pair(s) below AA` : `all pairs meet AA in all ${Object.keys(themes).length} themes`}`);
process.exit(failed ? 1 : 0);
