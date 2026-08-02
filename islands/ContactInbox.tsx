import { useEffect, useState } from "react";
import { Spinner } from "@tracht-digital-solutions/tds-shared/components";

interface Message {
  id: number;
  name: string;
  email: string;
  company: string | null;
  subject: string | null;
  status: "new" | "handled" | "spam";
  created_at: string;
}

interface Reply {
  id: number;
  body: string;
  sent_by: string | null;
  created_at: string;
}

interface MessageDetail extends Message {
  message: string;
  replies: Reply[];
}

const api = (path: string, init?: RequestInit) => fetch(path, { credentials: "include", ...init });

/**
 * Contact-form inbox (CP1: list + filter + status) and the CP2 detail view —
 * open a message to read the full body + reply history and send an email reply
 * (via the core Mailer; a reply moves a "new" message to "handled").
 */
export default function ContactInbox() {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [filter, setFilter] = useState<string>("new");
  const [openId, setOpenId] = useState<number | null>(null);

  const load = (status: string) =>
    api(`/contact/messages${status ? `?status=${status}` : ""}`)
      .then((r) => (r.ok ? r.json() : { messages: [] }))
      .then((d) => setMessages(d.messages ?? []))
      .catch(() => setMessages([]));

  useEffect(() => {
    load(filter);
  }, [filter]);

  const setStatus = async (m: Message, status: string) => {
    await api(`/contact/messages/${m.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    load(filter);
  };

  if (openId !== null) {
    return (
      <MessageView
        id={openId}
        onBack={() => {
          setOpenId(null);
          load(filter);
        }}
      />
    );
  }

  return (
    <div className="tds-stack">
      <div className="tds-toolbar">
        {["new", "handled", "spam", ""].map((s) => (
          <button
            key={s || "all"}
            type="button"
            className={`chip chip--${filter === s ? "info" : "neutral"}`}
            aria-pressed={filter === s}
            onClick={() => setFilter(s)}
          >
            {s === "" ? "Alle" : s === "new" ? "Neu" : s === "handled" ? "Erledigt" : "Spam"}
          </button>
        ))}
      </div>

      {messages === null ? (
        <p><Spinner /></p>
      ) : messages.length === 0 ? (
        <p className="tds-empty">Keine Anfragen.</p>
      ) : (
        <ul className="tds-list">
          {messages.map((m) => (
            <li key={m.id} className="tds-list__row">
              <button type="button" className="btn btn-ghost tds-row" onClick={() => setOpenId(m.id)}>
                <span>
                  <strong>{m.name}</strong> &lt;{m.email}&gt;
                  {m.company ? <em> · {m.company}</em> : null}
                </span>
                {m.subject ? <span>{m.subject}</span> : null}
              </button>
              <span className="tds-toolbar">
                {m.status !== "handled" ? (
                  <button type="button" className="btn btn-ghost" onClick={() => setStatus(m, "handled")}>
                    Erledigt
                  </button>
                ) : null}
                {m.status !== "spam" ? (
                  <button type="button" className="btn btn-danger" onClick={() => setStatus(m, "spam")}>
                    Spam
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MessageView({ id, onBack }: { id: number; onBack: () => void }) {
  const [msg, setMsg] = useState<MessageDetail | null>(null);
  const [reply, setReply] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api(`/contact/messages/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setMsg(d))
      .catch(() => setMsg(null));

  useEffect(() => {
    load();
  }, [id]);

  const send = async () => {
    if (reply.trim().length < 2) {
      setStatus("Antwort darf nicht leer sein.");
      return;
    }
    setBusy(true);
    setStatus(null);
    const res = await api(`/contact/messages/${id}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: reply }),
    });
    setBusy(false);
    if (res.ok) {
      setReply("");
      setStatus("Antwort gesendet.");
      load();
    } else if (res.status === 503) {
      setStatus("E-Mail-Versand ist nicht konfiguriert.");
    } else {
      setStatus(`Fehler (HTTP ${res.status}).`);
    }
  };

  return (
    <div className="tds-stack">
      <button type="button" className="btn btn-ghost" onClick={onBack}>
        ← Posteingang
      </button>
      {msg === null ? (
        <p><Spinner /></p>
      ) : (
        <>
          <header className="tds-row tds-row--between">
            <h2>{msg.subject || "Ohne Betreff"}</h2>
            <p>
              <strong>{msg.name}</strong> &lt;{msg.email}&gt;
              {msg.company ? <em> · {msg.company}</em> : null}
            </p>
            <span className={`chip chip--${msg.status === "new" ? "warning" : msg.status === "spam" ? "danger" : "success"}`}>
              {msg.status === "new" ? "Neu" : msg.status === "spam" ? "Spam" : "Erledigt"}
            </span>
          </header>

          <div className="tds-stack">{msg.message}</div>

          {msg.replies.length > 0 ? (
            <div className="tds-stack">
              <h3>Antworten</h3>
              <ul>
                {msg.replies.map((r) => (
                  <li key={r.id}>
                    <div className="marginalia">
                      {r.sent_by ?? "Admin"} · {r.created_at}
                    </div>
                    <div>{r.body}</div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="tds-compose">
            <h3>Antworten</h3>
            <textarea
              className="field-boxed"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              rows={8}
              placeholder={`Antwort an ${msg.name} …`}
            />
            {status ? <p className="tds-alert" role="status">{status}</p> : null}
            <button
              type="button"
              className="btn btn-primary"
              onClick={send}
              disabled={busy}
              aria-busy={busy}
            >
              {busy ? <Spinner size="sm" /> : null}
              Antwort senden
            </button>
          </div>
        </>
      )}
    </div>
  );
}
