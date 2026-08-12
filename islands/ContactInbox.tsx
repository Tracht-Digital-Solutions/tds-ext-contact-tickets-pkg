import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Spinner, toast } from "@tracht-digital-solutions/tds-shared/components";
import { apiFetch } from "@tracht-digital-solutions/tds-shared/api";
import {
  GROUP_LABELS,
  groupMessages,
  type GroupKey,
  type Group,
} from "./grouping";

interface Message {
  id: number;
  name: string;
  email: string;
  company: string | null;
  subject: string | null;
  /** First ~160 characters of the body — the form collects no subject. */
  excerpt?: string | null;
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

/**
 * Never a bare relative path: the panel is a static site on its own host, so
 * `fetch("/contact/messages")` would hit the product host, get the SPA
 * fallback HTML with a 200, and end up in the catch below as an empty inbox.
 */
const api = apiFetch;

/** Sort options, in the order the select offers them. */
const SORTS: { value: string; dir: "asc" | "desc"; label: string }[] = [
  { value: "created_at", dir: "desc", label: "Neueste zuerst" },
  { value: "created_at", dir: "asc", label: "Älteste zuerst" },
  { value: "name", dir: "asc", label: "Name A–Z" },
  { value: "name", dir: "desc", label: "Name Z–A" },
  { value: "email", dir: "asc", label: "E-Mail A–Z" },
  { value: "company", dir: "asc", label: "Firma A–Z" },
  { value: "status", dir: "asc", label: "Status" },
];

const STATUS_CHIPS: { value: string; label: string }[] = [
  { value: "new", label: "Neu" },
  { value: "handled", label: "Erledigt" },
  { value: "spam", label: "Spam" },
  { value: "", label: "Alle" },
];

/**
 * Contact-form inbox: list + status filter + free-text search + sorting +
 * grouping, and the detail view (full body, reply history, email reply).
 *
 * Live: the shell's notification poller dispatches `tds:notification` for every
 * new request, so an inbox left open updates itself instead of going stale
 * behind a toast that says something arrived.
 */
export default function ContactInbox() {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [filter, setFilter] = useState<string>("new");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState(""); // debounced `search`
  const [sortIndex, setSortIndex] = useState(0);
  const [groupBy, setGroupBy] = useState<GroupKey>("");
  const [failed, setFailed] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);

  // Debounce the search box so typing "mustermann" is one request, not eleven.
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const sort = SORTS[sortIndex] ?? SORTS[0]!;

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (filter) params.set("status", filter);
    if (query) params.set("q", query);
    params.set("sort", sort.value);
    params.set("dir", sort.dir);
    try {
      const res = await api(`/contact/messages?${params}`);
      if (!res.ok) {
        // A load failure is a persistent state, not a transient outcome, so it
        // belongs in the flow — and it must be distinguishable from "no
        // results", which is what an empty list used to render for both.
        setFailed(true);
        setMessages([]);
        return;
      }
      const data = await res.json();
      setFailed(false);
      setMessages(data.messages ?? []);
    } catch {
      setFailed(true);
      setMessages([]);
    }
  }, [filter, query, sort.value, sort.dir]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live refresh. `load` is a useCallback over the CURRENT filter/search/sort,
  // so the reload keeps what the user is looking at — reloading under a
  // hardcoded filter would swap the list out from under the highlighted chip.
  useEffect(() => {
    const onNotification = (event: Event) => {
      const detail = (event as CustomEvent<{ module?: string }>).detail;
      if (detail?.module === "contact-tickets") void load();
    };
    window.addEventListener("tds:notification", onNotification);
    return () => window.removeEventListener("tds:notification", onNotification);
  }, [load]);

  const setStatus = async (m: Message, status: string) => {
    const res = await api(`/contact/messages/${m.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      // Never swallow the response: a 403 used to reload the list and leave the
      // row exactly where it was, which reads as "the click did nothing".
      toast.danger(`Status konnte nicht geändert werden (HTTP ${res.status}).`);
      return;
    }
    void load();
  };

  const groups = useMemo(
    () => groupMessages(messages ?? [], groupBy),
    [messages, groupBy],
  );

  if (openId !== null) {
    return (
      <MessageView
        id={openId}
        onBack={() => {
          setOpenId(null);
          void load();
        }}
      />
    );
  }

  return (
    <div className="tds-stack">
      <div className="tds-toolbar">
        {STATUS_CHIPS.map((s) => (
          <button
            key={s.value || "all"}
            type="button"
            className={`chip chip--${filter === s.value ? "info" : "neutral"}`}
            aria-pressed={filter === s.value}
            onClick={() => setFilter(s.value)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* .tds-toolbar wraps; a hand-rolled flex row would push the group
          select off-screen on a phone, where body{overflow-x:hidden} CLIPS it
          rather than revealing a scrollbar. */}
      <div className="tds-toolbar">
        <label className="tds-field-row">
          Suche
          <input
            className="field"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, E-Mail, Firma, Betreff …"
          />
        </label>
        <label className="tds-field-row">
          Sortierung
          <select
            className="field"
            value={String(sortIndex)}
            onChange={(e) => setSortIndex(Number(e.target.value))}
          >
            {SORTS.map((s, i) => (
              <option key={`${s.value}-${s.dir}`} value={i}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="tds-field-row">
          Gruppieren
          <select
            className="field"
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as GroupKey)}
          >
            {(Object.keys(GROUP_LABELS) as GroupKey[]).map((key) => (
              <option key={key || "none"} value={key}>
                {GROUP_LABELS[key]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {failed ? (
        <p className="tds-alert tds-alert--danger" role="alert">
          Anfragen konnten nicht geladen werden.
        </p>
      ) : null}

      {messages === null ? (
        <p>
          <Spinner />
        </p>
      ) : messages.length === 0 ? (
        <p className="tds-empty">
          {failed ? "Keine Daten." : query ? "Keine Treffer." : "Keine Anfragen."}
        </p>
      ) : (
        groups.map((group) => (
          <GroupSection key={group.key} group={group} grouped={groupBy !== ""}>
            <ul className="tds-list">
              {group.items.map((m) => (
                <Row key={m.id} message={m} onOpen={() => setOpenId(m.id)} onStatus={setStatus} />
              ))}
            </ul>
          </GroupSection>
        ))
      )}
    </div>
  );
}

function GroupSection({
  group,
  grouped,
  children,
}: {
  group: Group<Message>;
  grouped: boolean;
  children: ReactNode;
}) {
  if (!grouped) return <>{children}</>;
  return (
    <section className="tds-stack tds-stack--tight">
      <h3 className="tds-row">
        <span>{group.label}</span>
        <span className="chip chip--neutral">{group.items.length}</span>
        {/* Ten gmx.de addresses are ten unrelated people. Without this the
            heading reads exactly like one company writing in ten times. */}
        {group.freemail ? <span className="chip chip--warning">Freemail</span> : null}
      </h3>
      {children}
    </section>
  );
}

function Row({
  message: m,
  onOpen,
  onStatus,
}: {
  message: Message;
  onOpen: () => void;
  onStatus: (m: Message, status: string) => void;
}) {
  // The public form collects no subject, so the excerpt is what makes a row
  // triageable without opening it.
  const secondary = m.subject || m.excerpt || null;
  return (
    <li className="tds-list__row">
      <button type="button" className="btn btn-ghost tds-row" onClick={onOpen}>
        <span>
          <strong>{m.name}</strong> &lt;{m.email}&gt;
          {m.company ? <em> · {m.company}</em> : null}
        </span>
        {secondary ? <span>{secondary}</span> : null}
      </button>
      <span className="tds-toolbar">
        {m.status !== "handled" ? (
          <button type="button" className="btn btn-ghost" onClick={() => onStatus(m, "handled")}>
            Erledigt
          </button>
        ) : null}
        {m.status !== "spam" ? (
          <button type="button" className="btn btn-danger" onClick={() => onStatus(m, "spam")}>
            Spam
          </button>
        ) : null}
      </span>
    </li>
  );
}

function MessageView({ id, onBack }: { id: number; onBack: () => void }) {
  const [msg, setMsg] = useState<MessageDetail | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reply, setReply] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api(`/contact/messages/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        setMsg(d);
        setLoadFailed(false);
      })
      .catch(() => setLoadFailed(true));

  useEffect(() => {
    void load();
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
      toast.success("Antwort gesendet.");
      setStatus(null);
      void load();
    } else if (res.status === 503) {
      setStatus("E-Mail-Versand ist nicht konfiguriert.");
    } else {
      toast.danger(`Antwort konnte nicht gesendet werden (HTTP ${res.status}).`);
    }
  };

  return (
    <div className="tds-stack">
      <button type="button" className="btn btn-ghost" onClick={onBack}>
        ← Posteingang
      </button>
      {loadFailed ? (
        // Used to sit on "Wird geladen …" forever on a failed load.
        <p className="tds-alert tds-alert--danger" role="alert">
          Anfrage konnte nicht geladen werden.
        </p>
      ) : msg === null ? (
        <p>
          <Spinner />
        </p>
      ) : (
        <>
          <header className="tds-row tds-row--between">
            <h2>{msg.subject || "Ohne Betreff"}</h2>
            <p>
              <strong>{msg.name}</strong> &lt;{msg.email}&gt;
              {msg.company ? <em> · {msg.company}</em> : null}
            </p>
            <span
              className={`chip chip--${msg.status === "new" ? "warning" : msg.status === "spam" ? "danger" : "success"}`}
            >
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
            {/* Validation and the "email not configured" hint stay here —
                the first names something to fix in the box above it, the second
                something an operator has to go and set. */}
            {status ? (
              <p className="tds-alert tds-alert--danger" role="alert">
                {status}
              </p>
            ) : null}
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
