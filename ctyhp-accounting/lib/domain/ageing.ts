/**
 * Pure AR/AP ageing. Buckets an open-item list by days past due relative to an
 * as-of date. Credits/unapplied payments carry a negative balance and land in
 * "Current". The grand total equals the net subledger balance, which must match
 * the AR/AP control-account balance from the ledger.
 */
export const AGEING_BUCKETS = [
  { key: "current", label: "Current" },
  { key: "d1_30", label: "1–30" },
  { key: "d31_60", label: "31–60" },
  { key: "d61_90", label: "61–90" },
  { key: "d90_plus", label: "90+" },
] as const;

export interface AgeingItem {
  dueDate: string;
  balanceMinor: number;
}

/** Whole days between two ISO dates (asOf - dueDate), UTC, calendar-day based. */
function daysPastDue(dueDate: string, asOf: string): number {
  const d = (s: string) => {
    const [y, m, day] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, day);
  };
  return Math.round((d(asOf) - d(dueDate)) / 86_400_000);
}

export function bucketOf(dueDate: string, asOf: string): string {
  const n = daysPastDue(dueDate, asOf);
  if (n <= 0) return "current";
  if (n <= 30) return "d1_30";
  if (n <= 60) return "d31_60";
  if (n <= 90) return "d61_90";
  return "d90_plus";
}

export function computeAgeing(items: AgeingItem[], asOf: string): { buckets: Record<string, number>; total: number } {
  const buckets: Record<string, number> = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
  let total = 0;
  for (const it of items) {
    buckets[bucketOf(it.dueDate, asOf)] += it.balanceMinor;
    total += it.balanceMinor;
  }
  return { buckets, total };
}
