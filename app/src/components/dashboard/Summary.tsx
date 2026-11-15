import { summaryParts } from '@/lib/alerts';
import type { Alert } from '@/lib/types';

/** The plain-language alert sentence, with node names in bold. */
export function Summary({ alert }: { alert: Alert }) {
  return (
    <>
      {summaryParts(alert).map((p, i) =>
        p.strong ? <b key={i}>{p.text}</b> : <span key={i}>{p.text}</span>,
      )}
    </>
  );
}
