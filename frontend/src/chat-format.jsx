// Tutor replies are Markdown-ish text. The chat used to show them raw, so a
// code block appeared as literal ``` lines around the code. This renders the
// few pieces the tutor actually uses — ``` code blocks, `inline code` and
// **bold** — as React elements (never as HTML, so nothing in a reply can
// inject markup). A block still streaming in (no closing ``` yet) shows as
// code too.
export function formatReply(text) {
  const out = [];
  const fence = /```[^\n]*\n?([\s\S]*?)(?:```|$)/g;
  let last = 0, m, k = 0;
  while ((m = fence.exec(text)) !== null) {
    if (m.index > last) out.push(...inline(text.slice(last, m.index), k++));
    out.push(<pre key={`c${k++}`} className="chat-code"><code>{m[1].replace(/\n$/, "")}</code></pre>);
    last = fence.lastIndex;
    if (m[0].length === 0) break;
  }
  if (last < text.length) out.push(...inline(text.slice(last), k++));
  return out;
}

function inline(text, key) {
  const parts = text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g);
  return parts.map((p, i) => {
    if (/^`[^`]+`$/.test(p)) return <code key={`${key}-${i}`} className="chat-inline-code">{p.slice(1, -1)}</code>;
    if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={`${key}-${i}`}>{p.slice(2, -2)}</strong>;
    return p;
  });
}
