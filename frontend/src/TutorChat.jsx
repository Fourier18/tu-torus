import { useRef, useState } from "react";

const HISTORY_KEEP = 6; // trimmed — last few turns only, not the full session

// Fires only on: the "check my code" button or a typed question — never
// per keystroke, never on its own schedule. Each call sends the current
// code, any error from the last run, and a trimmed slice of recent chat
// history — not the full session.
export default function TutorChat({ lastRun, filename, code }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const send = async ({ trigger, question = null }) => {
    if (sending) return;
    if (trigger === "manual" && !question?.trim()) return;

    const history = messages
      .filter((m) => m.role === "user" || m.role === "tutor")
      .slice(-HISTORY_KEEP)
      .map((m) => ({ role: m.role === "tutor" ? "assistant" : "user", content: m.text }));

    if (trigger === "manual") setMessages((m) => [...m, { role: "user", text: question }]);
    else if (trigger === "check") setMessages((m) => [...m, { role: "user", text: "Check my code" }]);

    setInput("");
    setSending(true);

    try {
      const res = await fetch("/api/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trigger, question, lastRunPointer: lastRun?.pointer ?? null, filename, code, history }),
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
            reply += evt.value;
            setMessages((m) => [...m.slice(0, -1), { role: "tutor", text: reply }]);
          }
          if (evt.type === "error") throw new Error(evt.value);
        }
      }
    } catch {
      setMessages((m) => [...m, { role: "tutor", text: "Lost connection to the tutor. Try asking again." }]);
    } finally {
      setSending(false);
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
        <div className="chat-actions-row">
          <button className="check-code-btn" onClick={() => send({ trigger: "check" })} disabled={sending}>Check my code</button>
        </div>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send({ trigger: "manual", question: input })}
          placeholder="Ask the tutor…"
          disabled={sending}
        />
      </div>
    </div>
  );
}
