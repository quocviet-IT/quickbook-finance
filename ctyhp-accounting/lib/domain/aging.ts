/**
 * Pure AR/AP aging. Buckets an open-item list by days past due relative to an
 * as-of date. Credits/unapplied payments carry a negative balance and land in
 * "Current". The grand total equals the net subledger balance, which must match
 * the AR/AP control-account balance from the ledger.
 */
export const AGING_BUCKETS = [
  { key: "current", label: "Current" },
  { key: "d1_30", label: "1–30" },
  { key: "d31_60", label: "31–60" },
  { key: "d61_90", label: "61–90" },
  { key: "d90_plus", label: "90+" },
] as const;

export interface AgingItem {
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

export function computeAging(items: AgingItem[], asOf: string): { buckets: Record<string, number>; total: number } {
  const buckets: Record<string, number> = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
  let total = 0;
  for (const it of items) {
    buckets[bucketOf(it.dueDate, asOf)] += it.balanceMinor;
    total += it.balanceMinor;
  }
  return { buckets, total };
}

// --- By party, rather than by document --------------------------------------

export interface PartyAgingRow {
  entityId: string;
  entityName: string;
  /** One amount per bucket, in AGING_BUCKETS order. */
  buckets: Record<string, number>;
  /** Everything not in the current bucket: what is actually late. */
  overdueMinor: number;
  totalMinor: number;
  /** Oldest due date behind the overdue money, or null when nothing is late. */
  oldestDueDate: string | null;
}

export interface PartyAgingPivot {
  rows: PartyAgingRow[];
  /** Column totals, so the bottom line of each bucket is on the report. */
  bucketTotals: Record<string, number>;
  totalMinor: number;
  overdueMinor: number;
}

interface PivotInput {
  entityId: string;
  entityName: string;
  bucket: string;
  dueDate: string;
  balanceMinor: number;
}

function emptyBuckets(): Record<string, number> {
  return Object.fromEntries(AGING_BUCKETS.map((bucket) => [bucket.key, 0]));
}

/**
 * The aging report the way it is worked from: one line per customer or vendor,
 * a column per bucket, a total down the side and along the bottom.
 *
 * A document list answers "which invoices are late"; this answers "who is
 * late", which is the question a collections call or a payment run starts
 * from. Rows are ordered by overdue money first, then by total — the accounts
 * that need a call, in the order they need it.
 *
 * Credits (a payment on account, an unapplied credit memo) arrive as negative
 * balances and are kept: netting them away would overstate what is owed.
 */
export function pivotAgingByParty(rows: readonly PivotInput[]): PartyAgingPivot {
  const byParty = new Map<string, PartyAgingRow>();

  for (const row of rows) {
    let party = byParty.get(row.entityId);
    if (!party) {
      party = {
        entityId: row.entityId,
        entityName: row.entityName,
        buckets: emptyBuckets(),
        overdueMinor: 0,
        totalMinor: 0,
        oldestDueDate: null,
      };
      byParty.set(row.entityId, party);
    }
    party.buckets[row.bucket] = (party.buckets[row.bucket] ?? 0) + row.balanceMinor;
    party.totalMinor += row.balanceMinor;
    if (row.bucket !== "current") {
      party.overdueMinor += row.balanceMinor;
      if (party.oldestDueDate === null || row.dueDate < party.oldestDueDate) {
        party.oldestDueDate = row.dueDate;
      }
    }
  }

  const list = [...byParty.values()].sort((a, b) => {
    if (b.overdueMinor !== a.overdueMinor) return b.overdueMinor - a.overdueMinor;
    if (b.totalMinor !== a.totalMinor) return b.totalMinor - a.totalMinor;
    return a.entityName.localeCompare(b.entityName);
  });

  const bucketTotals = emptyBuckets();
  let totalMinor = 0;
  let overdueMinor = 0;
  for (const party of list) {
    for (const bucket of AGING_BUCKETS) {
      bucketTotals[bucket.key] += party.buckets[bucket.key];
    }
    totalMinor += party.totalMinor;
    overdueMinor += party.overdueMinor;
  }

  return { rows: list, bucketTotals, totalMinor, overdueMinor };
}
