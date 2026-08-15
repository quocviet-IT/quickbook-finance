import { describe, expect, it } from "vitest";
import { buildExportArchive } from "@/lib/services/company-export";

const EMPTY_TOTALS = {
  trialBalanceDebitMinor: 0,
  trialBalanceCreditMinor: 0,
  arTotalMinor: 0,
  apTotalMinor: 0,
  journalLineCount: 0,
};

/**
 * Pins the invariant docs/operations/backup-and-restore.md tells an operator
 * to rely on: a restore is checked against the manifest's own
 * `controlTotalsAsOf`, not "today" — which only holds if `controlTotalsAsOf`
 * can never disagree with `generatedAt`, the timestamp right next to it in
 * the same manifest.
 */
describe("buildExportArchive's manifest clock", () => {
  it("takes controlTotalsAsOf from generatedAt's own date, not a second reading", async () => {
    const archive = await buildExportArchive({
      datasets: [],
      controlTotals: EMPTY_TOTALS,
      schemaVersion: "0114_backups.sql",
      generatedAt: "2026-07-29T23:59:59.999Z",
    });
    expect(archive.manifest.generatedAt).toBe("2026-07-29T23:59:59.999Z");
    expect(archive.manifest.controlTotalsAsOf).toBe("2026-07-29");
  });

  it("agrees with itself for any generatedAt, including right after UTC midnight", async () => {
    // The scenario the review flagged: a Promise.all straddling midnight used
    // to leave one date read for the control totals and a later, different
    // one read for the manifest. There is now only one date fed in here, so
    // there is nothing left to straddle.
    const archive = await buildExportArchive({
      datasets: [],
      controlTotals: EMPTY_TOTALS,
      schemaVersion: "0114_backups.sql",
      generatedAt: "2026-07-30T00:00:00.001Z",
    });
    expect(archive.manifest.controlTotalsAsOf).toBe(archive.manifest.generatedAt.slice(0, 10));
  });
});
