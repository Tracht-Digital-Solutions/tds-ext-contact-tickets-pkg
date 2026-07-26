import { useEffect, useState } from "react";

/** "Neue Anfragen" widget body — the count of unhandled contact messages. */
export default function NewContactCount() {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/contact/summary", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { new: 0 }))
      .then((d) => alive && setN(Number(d.new ?? 0)))
      .catch(() => alive && setN(0));
    return () => {
      alive = false;
    };
  }, []);
  return <p className="tds-widget__metric">{n === null ? "…" : n}</p>;
}
