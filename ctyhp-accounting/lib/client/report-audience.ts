/**
 * Who a report is being read by.
 *
 * An accountant opens a statement to read figures and ties them out; a manager
 * opens the same statement to see the shape of the month. Both are legitimate,
 * and they want opposite things at the top of the page — so the reader says
 * which they are, once, and every report remembers.
 *
 * Same external-store shape as the launcher preference, so a Client Component
 * can read it with `useSyncExternalStore` and the server can render the default
 * without a hydration mismatch.
 */

export const REPORT_AUDIENCES = ["accountant", "management"] as const;
export type ReportAudience = (typeof REPORT_AUDIENCES)[number];

const AUDIENCE_KEY = "ctyhp.reports.audience";

/** Numbers first. This is an accounting product; the figures are the report. */
export const DEFAULT_REPORT_AUDIENCE: ReportAudience = "accountant";

const listeners = new Set<() => void>();

export function getReportAudience(): ReportAudience {
  if (typeof window === "undefined") return DEFAULT_REPORT_AUDIENCE;
  try {
    const stored = window.localStorage.getItem(AUDIENCE_KEY);
    return stored === "management" ? "management" : DEFAULT_REPORT_AUDIENCE;
  } catch {
    // Private-mode browsers throw on localStorage; the reports still work.
    return DEFAULT_REPORT_AUDIENCE;
  }
}

export function reportAudienceServerSnapshot(): ReportAudience {
  return DEFAULT_REPORT_AUDIENCE;
}

export function setReportAudience(audience: ReportAudience): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(AUDIENCE_KEY, audience);
    } catch {
      /* nothing to persist to; the current page still respects the choice */
    }
  }
  for (const listener of listeners) listener();
}

/** Also follows other tabs: `storage` fires there, not in the writing tab. */
export function subscribeReportAudience(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === AUDIENCE_KEY) listener();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

export function reportAudienceLabel(audience: ReportAudience): string {
  return audience === "management" ? "Management" : "Accountant";
}
