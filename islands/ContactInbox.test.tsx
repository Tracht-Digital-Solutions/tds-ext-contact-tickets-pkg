// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ContactInbox from "./ContactInbox";

/**
 * The contact-form inbox: triage (new → handled/spam) and the detail view with
 * its email reply.
 *
 * Every message here came from a stranger on the public marketing site, and the
 * reply goes out as a real email through the core Mailer. So the assertions
 * concentrate on:
 *
 *  - the triage PATCH sending the status that was ASKED FOR, and the reload
 *    afterwards keeping the CURRENT filter (reloading under a different filter
 *    would show the admin a list that does not match the chip they are on);
 *  - the reply distinguishing "mail is not configured" (503) from any other
 *    failure — the first means the message was never sent AND never will be
 *    until the host is fixed, which is not something to bury under a generic
 *    error;
 *  - a non-OK list response never populating the inbox.
 */

interface Reply {
  status: number;
  body: unknown;
}
type Handler = (url: string, init?: RequestInit) => Reply | undefined;

let calls: Array<{ url: string; method: string; body: unknown }> = [];
let handlers: Handler[] = [];
let gate: { match: RegExp; promise: Promise<void> } | null = null;

/** Keep matching requests in flight until the returned function is called. */
function holdRequests(match: RegExp) {
  let release!: () => void;
  const promise = new Promise<void>((r) => (release = r));
  gate = { match, promise };
  return () => {
    gate = null;
    release();
  };
}

function respond(match: RegExp, body: unknown, status = 200, method?: string) {
  handlers.unshift((url, init) => {
    if (!match.test(url)) return undefined;
    if (method && (init?.method ?? "GET") !== method) return undefined;
    return { status, body };
  });
}

const MESSAGE = {
  id: 7,
  name: "Erika Muster",
  email: "erika@example.de",
  company: "Muster KG",
  subject: "Angebot Website",
  status: "new" as const,
  created_at: "2026-07-20T09:00:00Z",
};
const DETAIL = {
  ...MESSAGE,
  message: "Guten Tag, wir bräuchten eine neue Website.",
  replies: [] as Array<{ id: number; body: string; sent_by: string | null; created_at: string }>,
};

beforeEach(() => {
  calls = [];
  gate = null;
  handlers = [() => ({ status: 200, body: {} })];
  respond(/^\/contact\/messages(\?|$)/, { messages: [] });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
      const g = gate;
      if (g && g.match.test(url)) await g.promise;
      const reply = handlers.map((h) => h(url, init)).find((r) => r !== undefined)!;
      return { ok: reply.status < 300, status: reply.status, json: async () => reply.body } as Response;
    }),
  );
});

afterEach(() => cleanup());

const user = () => userEvent.setup({ delay: null });
const sent = (method: string, match: RegExp) => calls.filter((c) => c.method === method && match.test(c.url));

async function open(messages: unknown[] = []) {
  respond(/^\/contact\/messages(\?|$)/, { messages }, 200, "GET");
  render(<ContactInbox />);
  const u = user();
  await waitFor(() => expect(calls.length).toBeGreaterThan(0));
  return u;
}

/** Open the detail view of the first row. */
async function openDetail(u: ReturnType<typeof user>, detail: unknown = DETAIL) {
  respond(/^\/contact\/messages\/7$/, detail, 200, "GET");
  await u.click(await screen.findByRole("button", { name: /Erika Muster/ }));
  await screen.findByRole("heading", { level: 2 });
}

describe("the inbox", () => {
  it("shows the NEW requests first — the ones nobody has answered", async () => {
    await open();
    expect(calls[0]!.url).toBe("/contact/messages?status=new");
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ credentials: "include" });
  });

  it("shows a loading line until the list arrives", () => {
    render(<ContactInbox />);
    expect(screen.getByText("Wird geladen …")).toBeTruthy();
  });

  it("offers every triage filter", async () => {
    await open();
    for (const name of ["Neu", "Erledigt", "Spam", "Alle"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
  });

  it("filters to handled", async () => {
    const u = await open();
    await u.click(screen.getByRole("button", { name: "Erledigt" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/contact/messages?status=handled")).toBe(true));
  });

  it("filters to spam", async () => {
    const u = await open();
    await u.click(screen.getByRole("button", { name: "Spam" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/contact/messages?status=spam")).toBe(true));
  });

  it("drops the filter entirely for Alle", async () => {
    // `?status=` would filter for the empty status, not for "no filter".
    const u = await open();
    await u.click(screen.getByRole("button", { name: "Alle" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/contact/messages")).toBe(true));
  });

  it("marks the active filter", async () => {
    const u = await open();
    expect(screen.getByRole("button", { name: "Neu" }).className).toContain("chip--info");
    await u.click(screen.getByRole("button", { name: "Spam" }));
    expect(screen.getByRole("button", { name: "Spam" }).className).toContain("chip--info");
    expect(screen.getByRole("button", { name: "Neu" }).className).toContain("chip--neutral");
  });

  it("says so when the filter matches nothing", async () => {
    await open();
    expect(await screen.findByText("Keine Anfragen.")).toBeTruthy();
  });

  it("shows who wrote, from where, and about what", async () => {
    await open([MESSAGE]);
    const row = await screen.findByRole("button", { name: /Erika Muster/ });
    expect(row.textContent).toContain("erika@example.de");
    expect(row.textContent).toContain("Muster KG");
    expect(row.textContent).toContain("Angebot Website");
  });

  it("copes with a message that has no company or subject", async () => {
    await open([{ ...MESSAGE, company: null, subject: null }]);
    const row = await screen.findByRole("button", { name: /Erika Muster/ });
    expect(row.textContent).toContain("erika@example.de");
  });

  it("does NOT populate the inbox from a non-OK response", async () => {
    // These are strangers' names and email addresses; a denied response must
    // not put them on screen.
    respond(/^\/contact\/messages(\?|$)/, { messages: [MESSAGE] }, 403, "GET");
    render(<ContactInbox />);
    expect(await screen.findByText("Keine Anfragen.")).toBeTruthy();
    expect(screen.queryByText(/Erika Muster/)).toBeNull();
  });

  it("leaves the loading state even when the request rejects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    render(<ContactInbox />);
    expect(await screen.findByText("Keine Anfragen.")).toBeTruthy();
  });

  it("tolerates a response with no messages field", async () => {
    respond(/^\/contact\/messages(\?|$)/, {}, 200, "GET");
    render(<ContactInbox />);
    expect(await screen.findByText("Keine Anfragen.")).toBeTruthy();
  });
});

describe("triage", () => {
  /**
   * The filter chips are named "Erledigt" and "Spam" too, so a row action has
   * to be looked up inside its own row.
   */
  const action = async (name: string, contains = "Erika Muster") => {
    await screen.findByText(new RegExp(contains));
    const row = screen.getAllByRole("listitem").find((li) => li.textContent!.includes(contains))!;
    return within(row).getByRole("button", { name });
  };

  it("marks a message handled", async () => {
    const u = await open([MESSAGE]);
    await u.click(await action("Erledigt"));
    await waitFor(() => expect(sent("PATCH", /messages\/7$/)).toHaveLength(1));
    expect(sent("PATCH", /messages\/7$/)[0]!.body).toEqual({ status: "handled" });
  });

  it("marks a message as spam", async () => {
    const u = await open([MESSAGE]);
    await u.click(await action("Spam"));
    await waitFor(() => expect(sent("PATCH", /messages\/7$/)).toHaveLength(1));
    expect(sent("PATCH", /messages\/7$/)[0]!.body).toEqual({ status: "spam" });
  });

  it("patches the message whose button was pressed", async () => {
    const u = await open([MESSAGE, { ...MESSAGE, id: 8, name: "Max Zweit" }]);
    await screen.findByText("Max Zweit");
    const row = screen.getAllByRole("listitem").find((li) => li.textContent!.includes("Max Zweit"))!;
    await u.click(within(row).getByRole("button", { name: "Erledigt" }));
    await waitFor(() => expect(sent("PATCH", /messages\/8$/)).toHaveLength(1));
    expect(sent("PATCH", /messages\/7$/)).toHaveLength(0);
  });

  it("RELOADS under the filter the admin is looking at", async () => {
    // Reloading with a different status would swap the list out from under
    // the chip that is highlighted.
    const u = await open([MESSAGE]);
    await u.click(screen.getByRole("button", { name: "Alle" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/contact/messages")).toBe(true));
    await u.click(await action("Erledigt"));
    await waitFor(() => expect(sent("PATCH", /messages\/7$/)).toHaveLength(1));
    const after = calls.slice(calls.findIndex((c) => c.method === "PATCH"));
    expect(after.some((c) => c.method === "GET" && c.url === "/contact/messages")).toBe(true);
    expect(after.some((c) => c.url === "/contact/messages?status=new")).toBe(false);
  });

  it("hides the Erledigt action on an already-handled message", async () => {
    await open([{ ...MESSAGE, status: "handled" }]);
    await screen.findByText(/Erika Muster/);
    const row = screen.getAllByRole("listitem")[0]!;
    expect(within(row).queryByRole("button", { name: "Erledigt" })).toBeNull();
    expect(within(row).getByRole("button", { name: "Spam" })).toBeTruthy();
  });

  it("hides the Spam action on an already-spam message", async () => {
    await open([{ ...MESSAGE, status: "spam" }]);
    await screen.findByText(/Erika Muster/);
    const row = screen.getAllByRole("listitem")[0]!;
    expect(within(row).queryByRole("button", { name: "Spam" })).toBeNull();
    expect(within(row).getByRole("button", { name: "Erledigt" })).toBeTruthy();
  });
});

describe("reading a message", () => {
  it("loads the full message on open", async () => {
    const u = await open([MESSAGE]);
    await openDetail(u);
    expect(sent("GET", /^\/contact\/messages\/7$/)).toHaveLength(1);
    expect(screen.getByText("Guten Tag, wir bräuchten eine neue Website.")).toBeTruthy();
  });

  it("shows the subject as the heading", async () => {
    const u = await open([MESSAGE]);
    await openDetail(u);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Angebot Website");
  });

  it("falls back to a placeholder heading with no subject", async () => {
    const u = await open([MESSAGE]);
    await openDetail(u, { ...DETAIL, subject: null });
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Ohne Betreff");
  });

  it("badges a new message as new", async () => {
    const u = await open([MESSAGE]);
    await openDetail(u);
    expect(screen.getByText("Neu").className).toContain("chip--warning");
  });

  it("badges a spam message as spam", async () => {
    const u = await open([MESSAGE]);
    await openDetail(u, { ...DETAIL, status: "spam" });
    const chip = screen.getAllByText("Spam").find((e) => e.className.includes("chip--danger"))!;
    expect(chip).toBeTruthy();
  });

  it("badges a handled message as handled", async () => {
    const u = await open([MESSAGE]);
    await openDetail(u, { ...DETAIL, status: "handled" });
    expect(screen.getByText("Erledigt").className).toContain("chip--success");
  });

  it("lists previous replies with who sent them", async () => {
    const u = await open([MESSAGE]);
    await openDetail(u, {
      ...DETAIL,
      replies: [{ id: 1, body: "Gerne, wir melden uns.", sent_by: "julian@tracht-digital.de", created_at: "2026-07-20" }],
    });
    expect(screen.getByText("Gerne, wir melden uns.")).toBeTruthy();
    expect(screen.getByText(/julian@tracht-digital\.de/)).toBeTruthy();
  });

  it("attributes an unattributed reply to Admin", async () => {
    const u = await open([MESSAGE]);
    await openDetail(u, {
      ...DETAIL,
      replies: [{ id: 1, body: "Gerne.", sent_by: null, created_at: "2026-07-20" }],
    });
    expect(screen.getByText(/Admin/)).toBeTruthy();
  });

  it("shows no reply section when there are none yet", async () => {
    const u = await open([MESSAGE]);
    await openDetail(u);
    // Only the compose heading remains.
    expect(screen.getAllByText("Antworten")).toHaveLength(1);
  });

  it("addresses the compose box to the sender", async () => {
    const u = await open([MESSAGE]);
    await openDetail(u);
    expect(screen.getByPlaceholderText("Antwort an Erika Muster …")).toBeTruthy();
  });

  it("does NOT render a message body carried by a non-OK response", async () => {
    // These are a stranger's words to us; a denied response must not show
    // them. (The view then stays on its loading line — pinned as the current
    // behaviour, though a real error state would be friendlier.)
    const u = await open([MESSAGE]);
    respond(/^\/contact\/messages\/7$/, DETAIL, 403, "GET");
    await u.click(await screen.findByRole("button", { name: /Erika Muster/ }));
    await waitFor(() => expect(sent("GET", /^\/contact\/messages\/7$/)).toHaveLength(1));
    expect(screen.queryByText("Guten Tag, wir bräuchten eine neue Website.")).toBeNull();
    expect(screen.getByText("Wird geladen …")).toBeTruthy();
  });

  it("returns to the inbox and re-reads the list", async () => {
    const u = await open([MESSAGE]);
    await openDetail(u);
    const before = sent("GET", /^\/contact\/messages\?/).length;
    await u.click(screen.getByRole("button", { name: "← Posteingang" }));
    await waitFor(() => expect(sent("GET", /^\/contact\/messages\?/).length).toBeGreaterThan(before));
    expect(await screen.findByRole("button", { name: "Neu" })).toBeTruthy();
  });
});

describe("replying by email", () => {
  async function openReply(detail: unknown = DETAIL) {
    const u = await open([MESSAGE]);
    await openDetail(u, detail);
    return u;
  }
  const box = () => screen.getByPlaceholderText(/Antwort an/);
  const replies = () => sent("POST", /messages\/7\/reply$/);

  it("refuses to send an empty reply", async () => {
    const u = await openReply();
    await u.click(screen.getByRole("button", { name: "Antwort senden" }));
    expect(await screen.findByText("Antwort darf nicht leer sein.")).toBeTruthy();
    expect(replies()).toHaveLength(0);
  });

  it("refuses to send whitespace", async () => {
    const u = await openReply();
    await u.type(box(), "    ");
    await u.click(screen.getByRole("button", { name: "Antwort senden" }));
    expect(await screen.findByText("Antwort darf nicht leer sein.")).toBeTruthy();
    expect(replies()).toHaveLength(0);
  });

  it("refuses a single character — that is a misfire, not an answer", async () => {
    const u = await openReply();
    await u.type(box(), "k");
    await u.click(screen.getByRole("button", { name: "Antwort senden" }));
    expect(await screen.findByText("Antwort darf nicht leer sein.")).toBeTruthy();
    expect(replies()).toHaveLength(0);
  });

  it("posts the reply body", async () => {
    const u = await openReply();
    await u.type(box(), "Guten Tag, gerne. Wir melden uns morgen.");
    await u.click(screen.getByRole("button", { name: "Antwort senden" }));
    await waitFor(() => expect(replies()).toHaveLength(1));
    expect(replies()[0]!.body).toEqual({ body: "Guten Tag, gerne. Wir melden uns morgen." });
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const call = fetchMock.mock.calls.find((c) => (c[1] as RequestInit)?.method === "POST")!;
    expect((call[1] as RequestInit).headers).toMatchObject({ "Content-Type": "application/json" });
  });

  it("confirms, clears the box and re-reads the thread", async () => {
    const u = await openReply();
    await u.type(box(), "Guten Tag, gerne.");
    await u.click(screen.getByRole("button", { name: "Antwort senden" }));
    expect(await screen.findByText("Antwort gesendet.")).toBeTruthy();
    expect((box() as HTMLTextAreaElement).value).toBe("");
    await waitFor(() => expect(sent("GET", /^\/contact\/messages\/7$/).length).toBeGreaterThan(1));
  });

  it("NAMES an unconfigured mailer instead of a generic error", async () => {
    // A 503 here means the reply was never sent and will not be until the host
    // is fixed — burying it under "Fehler (HTTP 503)" reads as a hiccup.
    respond(/reply$/, { error: "no mailer" }, 503, "POST");
    const u = await openReply();
    await u.type(box(), "Guten Tag, gerne.");
    await u.click(screen.getByRole("button", { name: "Antwort senden" }));
    expect(await screen.findByText("E-Mail-Versand ist nicht konfiguriert.")).toBeTruthy();
  });

  it("reports any other failure with its status", async () => {
    respond(/reply$/, { error: "nope" }, 500, "POST");
    const u = await openReply();
    await u.type(box(), "Guten Tag, gerne.");
    await u.click(screen.getByRole("button", { name: "Antwort senden" }));
    expect(await screen.findByText("Fehler (HTTP 500).")).toBeTruthy();
  });

  it("does NOT claim the reply was sent when it failed", async () => {
    respond(/reply$/, { error: "nope" }, 500, "POST");
    const u = await openReply();
    await u.type(box(), "Guten Tag, gerne.");
    await u.click(screen.getByRole("button", { name: "Antwort senden" }));
    await screen.findByText("Fehler (HTTP 500).");
    expect(screen.queryByText("Antwort gesendet.")).toBeNull();
  });

  it("KEEPS the typed reply when sending fails", async () => {
    // Losing a hand-written answer to a customer is not recoverable.
    respond(/reply$/, { error: "nope" }, 500, "POST");
    const u = await openReply();
    await u.type(box(), "Guten Tag, gerne.");
    await u.click(screen.getByRole("button", { name: "Antwort senden" }));
    await screen.findByText("Fehler (HTTP 500).");
    expect((box() as HTMLTextAreaElement).value).toBe("Guten Tag, gerne.");
  });

  it("does not re-read the thread after a failed send", async () => {
    respond(/reply$/, { error: "nope" }, 500, "POST");
    const u = await openReply();
    await u.type(box(), "Guten Tag, gerne.");
    await u.click(screen.getByRole("button", { name: "Antwort senden" }));
    await screen.findByText("Fehler (HTTP 500).");
    expect(sent("GET", /^\/contact\/messages\/7$/)).toHaveLength(1);
  });

  it("clears a previous error the MOMENT the retry starts", async () => {
    // Asserting only the end state passes without the reset, because the
    // success message replaces the error anyway. What matters is that a stale
    // "Antwort darf nicht leer sein." is not still on screen while the retry
    // is in flight — that reads as the retry having failed too.
    const u = await openReply();
    await u.click(screen.getByRole("button", { name: "Antwort senden" }));
    await screen.findByText("Antwort darf nicht leer sein.");
    const release = holdRequests(/reply$/);
    await u.type(box(), "Guten Tag, gerne.");
    await u.click(screen.getByRole("button", { name: "Antwort senden" }));
    await waitFor(() => expect(replies()).toHaveLength(1));
    expect(screen.queryByText("Antwort darf nicht leer sein.")).toBeNull();
    release();
    await screen.findByText("Antwort gesendet.");
  });

  it("re-enables the send button afterwards", async () => {
    const u = await openReply();
    await u.type(box(), "Guten Tag, gerne.");
    const button = screen.getByRole("button", { name: "Antwort senden" }) as HTMLButtonElement;
    await u.click(button);
    await screen.findByText("Antwort gesendet.");
    expect(button.disabled).toBe(false);
  });
});
