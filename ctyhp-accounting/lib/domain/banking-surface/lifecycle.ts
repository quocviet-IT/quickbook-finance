import type { KindFilter, SurfaceNouns } from "@/lib/domain/work-surface/lifecycle";

/**
 * What Banking calls things, and how it slices its own queue.
 *
 * Small on purpose. The rules — what a person may do to a piece of work, what
 * "overdue" and "mine" mean — are shared, because they are about work rather
 * than about banks. Only the nouns and the kind filters differ, and those are
 * exactly the parts that would read as nonsense if borrowed from another screen.
 */

export const BANKING_NOUNS: SurfaceNouns = {
  /** What a blocking item would block here. Nothing currently blocks. */
  blocking: "a reconciliation",
  /** What decides an item is finished: the imported activity, not the ledger. */
  records: "the bank feed",
};

export const BANKING_KIND_FILTERS: readonly KindFilter[] = [
  { id: "unmatched", label: "Unmatched", kinds: ["unmatched-bank"] },
  { id: "feeds", label: "Feeds", kinds: ["broken-feed"] },
  { id: "reconciliations", label: "Reconciliations", kinds: ["open-reconciliation"] },
];
