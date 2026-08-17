import { describe, expect, it } from "vitest";
import {
  batchResultSeverity,
  describeBatchPreview,
  describeBatchResult,
  pruneSelection,
  splitBatchEligibility,
  summarizeBatchResults,
  type BatchActionOutcome,
} from "@/lib/domain/bank-transaction-batch";

// --- pruneSelection (RQ-03) --------------------------------------------------

describe("pruneSelection", () => {
  it("keeps a selected id that is still in the visible set", () => {
    // Fails if the filter predicate is inverted (keeping only ids NOT in
    // visible) or if the function returns an empty array unconditionally.
    expect(pruneSelection(["a", "b"], ["a", "b", "c"])).toEqual(["a", "b"]);
  });

  it("drops a selected id that dropped out of the filtered set", () => {
    // Fails if pruneSelection stops filtering (returns selectedIds
    // unchanged) — "b" is no longer reachable through any page of the
    // filtered result and must not stay selected.
    expect(pruneSelection(["a", "b"], ["a", "c"])).toEqual(["a"]);
  });

  it("drops every id when nothing selected remains visible", () => {
    expect(pruneSelection(["x", "y"], ["a", "b"])).toEqual([]);
  });

  it("keeps a selected id that is visible but on a different page of the same filtered set", () => {
    // This is the RQ-03 decision this module documents: pruning is against
    // the whole filtered set, not the current page, so turning the page
    // does not silently drop a selection the way narrowing the filter does.
    // Fails if visibleIds were (wrongly) scoped to one page instead of the
    // whole filtered result.
    expect(pruneSelection(["pageTwoRow"], ["pageOneRow", "pageTwoRow"])).toEqual(["pageTwoRow"]);
  });

  it("returns an empty array for an empty selection", () => {
    expect(pruneSelection([], ["a", "b"])).toEqual([]);
  });
});

// --- splitBatchEligibility (RQ-05) -------------------------------------------

interface Row {
  id: string;
  status: string;
}

describe("splitBatchEligibility", () => {
  it("treats an unmatched row as eligible", () => {
    // Fails if the eligibility check is inverted or drops the "unmatched"
    // branch entirely.
    const rows: Row[] = [{ id: "a", status: "unmatched" }];
    const { eligible, skipped } = splitBatchEligibility(rows);
    expect(eligible).toEqual(rows);
    expect(skipped).toEqual([]);
  });

  it("skips a matched row rather than including it as eligible", () => {
    // Fails if "matched" is (wrongly) treated as eligible, which would let a
    // batch action try to re-post a line that already carries an entry.
    const rows: Row[] = [{ id: "a", status: "matched" }];
    const { eligible, skipped } = splitBatchEligibility(rows);
    expect(eligible).toEqual([]);
    expect(skipped).toEqual(rows);
  });

  it("skips an ignored row the same way as a matched one", () => {
    const rows: Row[] = [{ id: "a", status: "ignored" }];
    expect(splitBatchEligibility(rows).skipped).toEqual(rows);
  });

  it("splits a mixed selection, keeping each row's original identity and order", () => {
    // Fails if the two output arrays are built from a re-sorted or deduped
    // copy of the input instead of a straight partition.
    const rows: Row[] = [
      { id: "a", status: "unmatched" },
      { id: "b", status: "matched" },
      { id: "c", status: "unmatched" },
      { id: "d", status: "ignored" },
    ];
    const { eligible, skipped } = splitBatchEligibility(rows);
    expect(eligible.map((r) => r.id)).toEqual(["a", "c"]);
    expect(skipped.map((r) => r.id)).toEqual(["b", "d"]);
  });

  it("returns two empty arrays for an empty selection", () => {
    expect(splitBatchEligibility([])).toEqual({ eligible: [], skipped: [] });
  });
});

// --- describeBatchPreview (RQ-05) --------------------------------------------

describe("describeBatchPreview", () => {
  it("names only the change count when nothing is skipped", () => {
    // Fails if the skip clause is always appended, even at zero.
    expect(describeBatchPreview(3, 0)).toBe("This will change 3 transactions.");
  });

  it("uses the singular for exactly one changed transaction", () => {
    expect(describeBatchPreview(1, 0)).toBe("This will change 1 transaction.");
  });

  it("names both counts when some rows are skipped", () => {
    // Fails if the skipped count is dropped from the sentence, or if it is
    // silently merged into the change count instead of stated separately.
    expect(describeBatchPreview(3, 2)).toBe(
      "This will change 3 transactions and skip 2 transactions already posted to the ledger.",
    );
  });

  it("uses the singular for exactly one skipped transaction", () => {
    expect(describeBatchPreview(1, 1)).toBe(
      "This will change 1 transaction and skip 1 transaction already posted to the ledger.",
    );
  });
});

// --- summarizeBatchResults / describeBatchResult / batchResultSeverity ------

function outcome(id: string, ok: boolean, error?: string): BatchActionOutcome {
  return { id, ok, error };
}

describe("summarizeBatchResults", () => {
  it("counts successes and failures from the outcome list, plus the skip count passed in", () => {
    // Fails if successCount is computed from outcomes.length alone (ignoring
    // failures), or if skippedCount is derived from outcomes instead of
    // taken from the caller — skips never reach the server call at all.
    const summary = summarizeBatchResults(
      [outcome("a", true), outcome("b", false, "Accounting period for 2026-07-15 is closed"), outcome("c", true)],
      4,
    );
    expect(summary).toEqual({
      successCount: 2,
      failureCount: 1,
      skippedCount: 4,
      failures: [{ id: "b", error: "Accounting period for 2026-07-15 is closed" }],
    });
  });

  it("keeps each failure's own reason rather than collapsing them to one message", () => {
    // Fails if failures are deduplicated by message or only the first
    // failure is kept — a closed-period row and a stale-status row must both
    // surface, each with its own real reason.
    const summary = summarizeBatchResults(
      [
        outcome("a", false, "Accounting period for 2026-07-15 is closed"),
        outcome("b", false, "This line is already matched. Only a line still awaiting review can be categorised."),
      ],
      0,
    );
    expect(summary.failures).toEqual([
      { id: "a", error: "Accounting period for 2026-07-15 is closed" },
      { id: "b", error: "This line is already matched. Only a line still awaiting review can be categorised." },
    ]);
  });

  it("falls back to a placeholder only when a failed outcome carries no message", () => {
    expect(summarizeBatchResults([outcome("a", false)], 0).failures).toEqual([
      { id: "a", error: "Unknown error" },
    ]);
  });

  it("reports zero failures and the full success count when every row succeeds", () => {
    expect(summarizeBatchResults([outcome("a", true), outcome("b", true)], 0)).toEqual({
      successCount: 2,
      failureCount: 0,
      skippedCount: 0,
      failures: [],
    });
  });
});

describe("describeBatchResult", () => {
  it("names only the success count when nothing failed or was skipped", () => {
    // Fails if the failed/skipped clauses are appended even when their counts
    // are zero, producing "3 updated, 0 failed, 0 skipped".
    expect(describeBatchResult({ successCount: 3, failureCount: 0, skippedCount: 0, failures: [] })).toBe(
      "3 updated",
    );
  });

  it("states a partial failure rather than letting it read as complete success", () => {
    // Fails if failureCount is not read into the sentence — the exact bug
    // RQ-05 forbids: a batch result that hides how many rows did not change.
    expect(
      describeBatchResult({ successCount: 2, failureCount: 1, skippedCount: 0, failures: [{ id: "x", error: "e" }] }),
    ).toBe("2 updated, 1 failed");
  });

  it("names the skip count and its reason", () => {
    expect(describeBatchResult({ successCount: 1, failureCount: 0, skippedCount: 5, failures: [] })).toBe(
      "1 updated, 5 skipped (already posted)",
    );
  });

  it("names all three together when a batch has successes, failures and skips at once", () => {
    expect(
      describeBatchResult({
        successCount: 1,
        failureCount: 1,
        skippedCount: 1,
        failures: [{ id: "x", error: "e" }],
      }),
    ).toBe("1 updated, 1 failed, 1 skipped (already posted)");
  });
});

describe("batchResultSeverity", () => {
  it("is success when nothing failed, even if rows were skipped", () => {
    // Fails if a nonzero skippedCount alone were treated as a failure —
    // skips were disclosed and confirmed before saving, so they are not one.
    expect(batchResultSeverity({ successCount: 4, failureCount: 0, skippedCount: 3, failures: [] })).toBe("success");
  });

  it("is warning when some rows failed but at least one succeeded", () => {
    expect(
      batchResultSeverity({ successCount: 3, failureCount: 1, skippedCount: 0, failures: [{ id: "x", error: "e" }] }),
    ).toBe("warning");
  });

  it("is error when every attempted row failed", () => {
    // Fails if the successCount === 0 branch is removed, always returning
    // "warning" for any failure regardless of how many rows succeeded.
    expect(
      batchResultSeverity({ successCount: 0, failureCount: 2, skippedCount: 0, failures: [{ id: "x", error: "e" }, { id: "y", error: "e" }] }),
    ).toBe("error");
  });
});
