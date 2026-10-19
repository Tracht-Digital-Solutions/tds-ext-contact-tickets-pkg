import { SummaryMetric } from "@tracht-digital-solutions/tds-shared/components";

/**
 * "Neue Anfragen" widget body — the count of unhandled contact messages.
 *
 * It reloads whenever the shell's poller announces a new request
 * (`refreshOnModule`): a tile still showing yesterday's count next to a toast
 * about a new one is worse than no tile.
 */
export default function NewContactCount() {
  return (
    <SummaryMetric<{ new?: number }>
      endpoint="/contact/summary"
      value={(d) => Number(d.new ?? 0)}
      refreshOnModule="contact-tickets"
    />
  );
}
