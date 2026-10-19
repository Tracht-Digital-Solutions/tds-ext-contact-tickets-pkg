/**
 * Grouping helpers for the contact inbox.
 *
 * Grouping is CLIENT-side over the rows the server returned. The server already
 * filters and sorts; grouping is a view over the result, and the list is capped
 * at 500 rows, so there is nothing to gain from a second round trip. The one
 * thing to keep in mind: if the cap is ever reached, the groups describe the
 * TRUNCATED list, not the whole table.
 */

export type GroupKey = "" | "email" | "name" | "company" | "domain";

export interface GroupableMessage {
  name: string;
  email: string;
  company: string | null;
}

export interface Group<T> {
  /** Stable identity for React and for the "is this freemail" lookup. */
  key: string;
  /** What the group heading shows. */
  label: string;
  /** True when `key` is a freemail host and the grouping is by domain. */
  freemail: boolean;
  items: T[];
}

/**
 * Public suffixes that are two labels long and actually occur in this inbox's
 * mail. Deliberately a short hand-kept list rather than a Public Suffix List
 * dependency: the customer base is effectively `.de`, and shipping (and
 * refreshing) the full PSL to shorten a group heading is not a trade worth
 * making. A suffix that is missing here only costs a slightly longer label —
 * `firma.co.nz` groups as `co.nz` instead of `firma.co.nz` — never a wrong
 * group, because the mapping stays deterministic.
 */
const MULTI_LABEL_SUFFIXES = new Set([
  "co.uk",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "com.au",
  "net.au",
  "org.au",
  "co.jp",
  "com.br",
  "co.za",
  "com.tr",
  "com.pl",
  "co.nz",
]);

/**
 * Mailbox providers, so a domain group can say so.
 *
 * Ten `gmx.de` addresses are ten unrelated people; without the marker the group
 * heading reads exactly like a company with ten employees writing in.
 */
const FREEMAIL = new Set([
  "gmail.com",
  "googlemail.com",
  "gmx.de",
  "gmx.net",
  "gmx.at",
  "gmx.ch",
  "web.de",
  "t-online.de",
  "freenet.de",
  "outlook.com",
  "outlook.de",
  "hotmail.com",
  "hotmail.de",
  "live.com",
  "live.de",
  "yahoo.com",
  "yahoo.de",
  "icloud.com",
  "me.com",
  "aol.com",
  "posteo.de",
  "mailbox.org",
  "protonmail.com",
  "proton.me",
]);

/** The host part of an address, lowercased. `""` when there isn't one. */
export function emailHost(email: string): string {
  const at = String(email ?? "").lastIndexOf("@");
  if (at < 0) return "";
  return email.slice(at + 1).trim().toLowerCase();
}

/**
 * The registrable ("main") domain of an address — `mail.firma.co.uk` →
 * `firma.co.uk`, `info@firma.de` → `firma.de`.
 *
 * This is what "gruppieren nach Hauptdomain" means: everyone writing from the
 * same organisation lands in one group regardless of which mail subdomain they
 * happen to use.
 */
export function registrableDomain(email: string): string {
  const host = emailHost(email);
  if (host === "") return "";
  const labels = host.split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");

  const lastTwo = labels.slice(-2).join(".");
  if (MULTI_LABEL_SUFFIXES.has(lastTwo)) {
    return labels.slice(-3).join(".");
  }
  return lastTwo;
}

export function isFreemail(domain: string): boolean {
  return FREEMAIL.has(domain);
}

/** The German label for each grouping mode, for the select. */
export const GROUP_LABELS: Readonly<Record<GroupKey, string>> = {
  "": "Keine Gruppierung",
  email: "E-Mail",
  name: "Name",
  company: "Firma",
  domain: "Hauptdomain",
};

const EMPTY_LABEL: Readonly<Record<GroupKey, string>> = {
  "": "",
  email: "Ohne E-Mail",
  name: "Ohne Namen",
  company: "Ohne Firma",
  domain: "Ohne Domain",
};

/**
 * Bucket rows by the chosen key, preserving the server's order both between
 * groups (first appearance wins) and inside them.
 *
 * Preserving order matters: the server sorted by whatever the user picked, and
 * re-sorting the groups alphabetically here would quietly override that.
 */
export function groupMessages<T extends GroupableMessage>(items: T[], by: GroupKey): Group<T>[] {
  if (by === "") {
    return [{ key: "", label: "", freemail: false, items }];
  }

  const buckets = new Map<string, Group<T>>();
  for (const item of items) {
    const raw =
      by === "email"
        ? String(item.email ?? "").trim().toLowerCase()
        : by === "name"
          ? String(item.name ?? "").trim()
          : by === "company"
            ? String(item.company ?? "").trim()
            : registrableDomain(item.email);

    const key = raw === "" ? "\u0000empty" : raw;
    let bucket = buckets.get(key);
    if (bucket === undefined) {
      bucket = {
        key,
        label: raw === "" ? EMPTY_LABEL[by] : raw,
        freemail: by === "domain" && raw !== "" && isFreemail(raw),
        items: [],
      };
      buckets.set(key, bucket);
    }
    bucket.items.push(item);
  }
  return [...buckets.values()];
}
