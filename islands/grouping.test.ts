import { describe, expect, it } from "vitest";
import {
  emailHost,
  groupMessages,
  isFreemail,
  registrableDomain,
  type GroupableMessage,
} from "./grouping";

const msg = (name: string, email: string, company: string | null = null): GroupableMessage => ({
  name,
  email,
  company,
});

describe("registrableDomain", () => {
  it("returns the domain of an ordinary address", () => {
    expect(registrableDomain("info@firma.de")).toBe("firma.de");
  });

  it("strips subdomains, which is the whole point of grouping by it", () => {
    // Everyone at one organisation must land in ONE group regardless of which
    // mail subdomain their address happens to use.
    expect(registrableDomain("a@mail.firma.de")).toBe("firma.de");
    expect(registrableDomain("b@smtp.eu.firma.de")).toBe("firma.de");
  });

  it("keeps three labels for a two-label public suffix", () => {
    expect(registrableDomain("a@firma.co.uk")).toBe("firma.co.uk");
    expect(registrableDomain("a@mail.firma.co.uk")).toBe("firma.co.uk");
    expect(registrableDomain("a@firma.com.au")).toBe("firma.com.au");
  });

  it("lowercases, because a group key must not split on capitalisation", () => {
    expect(registrableDomain("A@Firma.DE")).toBe("firma.de");
  });

  it("takes the LAST @ — a quoted local part may contain one", () => {
    expect(registrableDomain('"weird@local"@firma.de')).toBe("firma.de");
  });

  it("returns empty for something that is not an address", () => {
    expect(registrableDomain("kein-at-zeichen")).toBe("");
    expect(registrableDomain("")).toBe("");
  });

  it("degrades to a longer label rather than a wrong group on an unknown suffix", () => {
    // `com.mx` is not in the hand-kept list. The result is a coarser heading,
    // never a mix-up: the mapping stays deterministic.
    expect(registrableDomain("a@firma.com.mx")).toBe("com.mx");
    expect(registrableDomain("b@firma.com.mx")).toBe("com.mx");
  });
});

describe("emailHost / isFreemail", () => {
  it("reads the host", () => {
    expect(emailHost("a@Firma.DE")).toBe("firma.de");
  });

  it("knows the common German mailbox providers", () => {
    expect(isFreemail("gmx.de")).toBe(true);
    expect(isFreemail("web.de")).toBe(true);
    expect(isFreemail("t-online.de")).toBe(true);
    expect(isFreemail("firma.de")).toBe(false);
  });
});

describe("groupMessages", () => {
  const rows = [
    msg("Max Mustermann", "max@firma.de", "Firma GmbH"),
    msg("Erika Beispiel", "erika@mail.firma.de", "Firma GmbH"),
    msg("Klaus Klein", "klaus@gmx.de", null),
  ];

  it("returns one anonymous group when grouping is off", () => {
    const groups = groupMessages(rows, "");
    expect(groups).toHaveLength(1);
    expect(groups[0]!.items).toHaveLength(3);
  });

  it("groups by registrable domain across subdomains", () => {
    const groups = groupMessages(rows, "domain");
    expect(groups.map((g) => g.label)).toEqual(["firma.de", "gmx.de"]);
    expect(groups[0]!.items).toHaveLength(2);
  });

  it("marks a freemail domain group, so it does not read as one company", () => {
    const groups = groupMessages(rows, "domain");
    expect(groups[0]!.freemail).toBe(false);
    expect(groups[1]!.freemail).toBe(true);
  });

  it("does not mark freemail when grouping by something else", () => {
    // The flag is about the DOMAIN heading; on a name group it would be noise.
    const groups = groupMessages(rows, "email");
    expect(groups.every((g) => !g.freemail)).toBe(true);
  });

  it("groups by company and buckets the missing ones separately", () => {
    const groups = groupMessages(rows, "company");
    expect(groups.map((g) => g.label)).toEqual(["Firma GmbH", "Ohne Firma"]);
  });

  it("PRESERVES the server's order, both between groups and inside them", () => {
    // The server sorted by whatever the user picked in the select. Re-sorting
    // the groups alphabetically here would quietly override that choice.
    const ordered = [
      msg("Zoe", "zoe@zeta.de"),
      msg("Anna", "anna@alpha.de"),
      msg("Bert", "bert@zeta.de"),
    ];
    const groups = groupMessages(ordered, "domain");
    expect(groups.map((g) => g.label)).toEqual(["zeta.de", "alpha.de"]);
    expect(groups[0]!.items.map((i) => i.name)).toEqual(["Zoe", "Bert"]);
  });

  it("is case-insensitive on email but not on a typed name", () => {
    const groups = groupMessages([msg("A", "X@Firma.de"), msg("B", "x@firma.de")], "email");
    expect(groups).toHaveLength(1);
  });

  it("keeps an empty-key bucket from colliding with a real value", () => {
    // The empty bucket uses a key no address or company can produce.
    const groups = groupMessages([msg("A", "a@x.de", ""), msg("B", "b@x.de", "Ohne Firma")], "company");
    expect(groups).toHaveLength(2);
  });
});
