import { describe, expect, it } from "vitest";
import { getApAging, getArAging } from "@/lib/services/aging";
import { pivotAgingByParty } from "@/lib/domain/aging";
import { closeE2eSession, openE2eSession } from "./support/session";

/**
 * The by-party view is what the reports now open on, so it has to agree with
 * the document list it is built from — and with the control account the report
 * reconciles to. Read-only: it runs both aging reports against the live ledger
 * and checks the arithmetic.
 */
describe("aging by party over HTTPS", () => {
  it("rolls the document list up to vendors and customers without losing a cent", async () => {
    const { sb, today } = await openE2eSession();

    try {
      for (const [side, report] of [
        ["payables", await getApAging(sb, today)],
        ["receivables", await getArAging(sb, today)],
      ] as const) {
        const pivot = pivotAgingByParty(report.rows);

        expect(pivot.totalMinor, `${side}: the party rollup must equal the report total`).toBe(
          report.total,
        );
        for (const bucket of ["current", "d1_30", "d31_60", "d61_90", "d90_plus"]) {
          expect(
            pivot.bucketTotals[bucket],
            `${side}: bucket ${bucket} must match the report's own bucket`,
          ).toBe(report.buckets[bucket] ?? 0);
        }

        // Overdue is everything outside Current, however the buckets fall.
        const expectedOverdue = report.total - (report.buckets.current ?? 0);
        expect(pivot.overdueMinor, `${side}: overdue total`).toBe(expectedOverdue);

        // A party with money outside Current must name the oldest date behind it.
        for (const party of pivot.rows) {
          if (party.overdueMinor !== 0) {
            expect(party.oldestDueDate, `${side}: ${party.entityName} oldest due date`).not.toBeNull();
            expect(party.oldestDueDate! < today, `${side}: oldest due date is in the past`).toBe(
              true,
            );
          } else {
            expect(party.oldestDueDate).toBeNull();
          }
        }
      }
    } finally {
      await closeE2eSession(sb);
    }
  });
});
