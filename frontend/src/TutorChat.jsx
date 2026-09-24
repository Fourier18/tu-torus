import { useState } from "react";

// [DESIGN.md, Panel 3] Strictly reactive — sends only on user submit, never
// polls or auto-triggers. Attaches the last run's pointer line (not its
// contents) so the tutor knows a run exists and reads it itself if needed.
export default function TutorChat({ lastRunPointer }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!input.trim() || sending) return;
    const userText = input;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: userText }]);
    setSending(true);

    // No error handling here used to mean a dead backend — at connect time
    // or mid-stream — left `sending` stuck true forever, permanently
    // disabling the input with no way to recover short of a page reload.
    // Confirmed by killing the backend mid-response before this fix.
    try {
      const res = await fetch("/api/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userText, lastRunPointer }),
      });
      if (!res.ok || !res.body) throw new Error(`Tutor request failed (${res.status})`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let reply = "";
      setMessages((m) => [...m, { role: "tutor", text: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of decoder.decode(value).split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const evt = JSON.parse(line.slice(6));
          if (evt.type === "text") {
            reply += Array.isArray(evt.value) ? evt.value.map((b) => b.text || "").join("") : evt.value;
            setMessages((m) => [...m.slice(0, -1), { role: "tutor", text: reply }]);
          }
          if (evt.type === "error") throw new Error(evt.value);
        }
      }
    } catch {
      setMessages((m) => [...m, { role: "tutor", text: "Lost connection to the tutor. Try asking again." }]);
    } finally {
      setSending(false); // must always run, however the request ended
    }
  };

  return (
    <div className="panel tutor-chat">
      <div className="chat-messages">
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg chat-${m.role}`}>{m.text}</div>
        ))}
      </div>
      <div className="chat-input-row">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Ask the tutor…"
          disabled={sending}
        />
      </div>
    </div>
  );
}
