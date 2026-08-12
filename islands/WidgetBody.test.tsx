// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import WidgetBody from "./WidgetBody";

/**
 * The "Neue Anfragen" widget: how many contact-form submissions nobody has
 * answered yet.
 *
 * NOTE — this widget falls back to `0` on a failure, where the lexware and
 * time-tracker widgets render `—`. Pinned as-is, but worth knowing: a 500 makes
 * the tile read "0 neue Anfragen", which is exactly the state that makes an
 * admin stop checking the inbox.
 */

let reply: { status: number; body: unknown } | "reject" = { status: 200, body: { new: 0 } };

beforeEach(() => {
  reply = { status: 200, body: { new: 0 } };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      if (reply === "reject") throw new TypeError("offline");
      return {
        ok: reply.status < 300,
        status: reply.status,
        json: async () => (reply === "reject" ? {} : reply.body),
      } as Response;
    }),
  );
});

afterEach(() => cleanup());

describe("the widget", () => {
  it("fetches its summary endpoint with credentials, on the API host", () => {
    // Absolute, not relative: the panel is a static site on its own host, and
    // its SPA fallback would answer a relative path with 200 + HTML — so the
    // json() throws and the catch renders a confident, permanently wrong 0.
    render(<WidgetBody />);
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.tracht-digital.de/contact/summary");
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ credentials: "include" });
  });

  it("shows a placeholder before the request resolves", () => {
    render(<WidgetBody />);
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  it("renders the number of unanswered requests", async () => {
    reply = { status: 200, body: { new: 5 } };
    render(<WidgetBody />);
    expect(await screen.findByText("5")).toBeTruthy();
  });

  it("renders a real zero when the inbox is clear", async () => {
    render(<WidgetBody />);
    expect(await screen.findByText("0")).toBeTruthy();
  });

  it("coerces a string count from the API to a number", async () => {
    // PDO hands back strings for integer columns. `"5"` renders identically
    // either way, so this uses a value where the coercion is VISIBLE: a
    // zero-padded string would reach the tile verbatim as "05".
    reply = { status: 200, body: { new: "05" } };
    render(<WidgetBody />);
    const metric = await screen.findByText("5");
    expect(metric.textContent).toBe("5");
    expect(screen.queryByText("05")).toBeNull();
  });

  it("treats a missing count as zero rather than rendering NaN", async () => {
    reply = { status: 200, body: {} };
    render(<WidgetBody />);
    expect(await screen.findByText("0")).toBeTruthy();
    expect(screen.queryByText("NaN")).toBeNull();
  });

  it("does not render a count carried by a NON-OK response", async () => {
    reply = { status: 403, body: { new: 99 } };
    render(<WidgetBody />);
    expect(await screen.findByText("0")).toBeTruthy();
    expect(screen.queryByText("99")).toBeNull();
  });

  it("still resolves to a rendered tile when the request rejects", async () => {
    reply = "reject";
    render(<WidgetBody />);
    expect(await screen.findByText("0")).toBeTruthy();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });
});
