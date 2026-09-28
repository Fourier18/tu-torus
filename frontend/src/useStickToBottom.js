import { useLayoutEffect, useRef } from "react";

// Keeps a scrolling panel pinned to its newest content, like a terminal:
// follows new output while the reader is at (or near) the bottom, and
// leaves them alone once they scroll up to read something. Without it the
// output panel stayed at the top while a loop printed below, hiding the
// line that said why the run ended.
export default function useStickToBottom(dep) {
  const ref = useRef(null);
  const atBottom = useRef(true);
  const onScroll = () => {
    const el = ref.current;
    if (el) atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [dep]);
  return { ref, onScroll };
}
