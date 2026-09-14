import { defineExtension } from "@tracht-digital-solutions/tds-frontend-contract";

/**
 * Contact-tickets extension — the public **contact-form inbox**. The marketing
 * site's contact form submits to a public endpoint; each submission becomes a
 * `contact_message` an admin triages in the panel (new → handled/spam) and can
 * reply to by email (via the core Mailer). Standalone: its own table, separate
 * from the support-ticket system.
 *
 * `contact:read`/`contact:write` gate the admin inbox (admins bypass); the
 * public submit endpoint needs no permission.
 */
export default defineExtension({
  id: "contact-tickets",
  name: "Kontaktanfragen",
  version: "0.1.0",
  permissions: [
    { id: "contact:read", label: "Kontaktanfragen ansehen", group: "contact-tickets" },
    { id: "contact:write", label: "Kontaktanfragen bearbeiten", group: "contact-tickets" },
  ],
  nav: [
    {
      id: "contact-tickets",
      label: "Kontaktanfragen",
      href: "/kontakt",
      icon: "inbox",
      group: "support",
      order: 20,
      permission: "contact:read",
    },
  ],
  widgets: [
    {
      id: "contact-new",
      title: "Neue Anfragen",
      island: "@tracht-digital-solutions/tds-ext-contact-tickets/widgets/Widget.astro",
      size: "sm",
      permission: "contact:read",
      dataEndpoint: "/contact/summary",
      order: 20,
    },
  ],
  // No `settings` section. It used to render "Kontaktanfragen-Einstellungen
  // (Benachrichtigungs-Empfänger folgt)." on the production settings page — a
  // placeholder with nothing to set. Add the contribution back together with
  // the first real setting.
  routes: [
    {
      pattern: "/kontakt",
      entrypoint: "@tracht-digital-solutions/tds-ext-contact-tickets/pages/Index.astro",
      permission: "contact:read",
    },
  ],
  i18n: {
    de: { "contact.title": "Kontaktanfragen", "contact.new": "Neue Anfragen" },
    en: { "contact.title": "Contact requests", "contact.new": "New requests" },
  },
});
