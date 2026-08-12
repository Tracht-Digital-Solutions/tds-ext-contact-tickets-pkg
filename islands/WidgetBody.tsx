import { useCallback, useEffect, useState } from "react";
import { Skeleton } from "@tracht-digital-solutions/tds-shared/components";
import { apiFetch } from "@tracht-digital-solutions/tds-shared/api";

/** "Neue Anfragen" widget body — the count of unhandled contact messages. */
export default function NewContactCount() {
  const [n, setN] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      // Absolute, via apiFetch: a relative path resolves against the product
      // host, whose SPA fallback answers 200 + HTML — so `r.ok` is true, the
      // json() throws, and the catch below silently renders 0.
      const r = await apiFetch("/contact/summary");
      const d = r.ok ? await r.json() : { new: 0 };
      setN(Number(d.new ?? 0));
    } catch {
      setN(0);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Keep the dashboard tile honest while it is on screen: the shell's poller
  // announces every new request, and a widget still showing yesterday's count
  // next to a toast about a new one is worse than no widget.
  useEffect(() => {
    const onNotification = (event: Event) => {
      const detail = (event as CustomEvent<{ module?: string }>).detail;
      if (detail?.module === "contact-tickets") void load();
    };
    window.addEventListener("tds:notification", onNotification);
    return () => window.removeEventListener("tds:notification", onNotification);
  }, [load]);

  return (
    <p className="tds-widget__metric" aria-busy={n === null}>
      {n === null ? <Skeleton width="3ch" height="1.75rem" /> : n}
    </p>
  );
}
