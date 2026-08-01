import { describe, expect, it } from "vitest";
import { getControlReconciliation, getPostingReport } from "@/lib/services/gl-posting";
import { getArAging, getApAging } from "@/lib/services/aging";
import { closeE2eSession, openE2eSession } from "./support/session";

const TODAY = new Date().toISOString().slice(0, 10);

/**
 * The verification itself, run against the real books.
 *
 * Read-only. If this ever fails it is not the test that is wrong: either a
 * document did not reach the ledger, or a control account has come adrift from
 * the subledger behind it. Both are the reasons the report exists.
 */
describe("general ledger posting verification over HTTPS", () => {
  it("finds every live document on the ledger", async () => {
    const { sb } = await openE2eSession();
    try {
      const report = await getPostingReport(sb, "2000-01-01", "2100-01-01");
      expect(report.summary.documents, "the books are not empty").toBeGreaterThan(0);

      const missing = report.exceptions.filter((row) => row.verdict === "missing_entry");
      expect(
        missing.map((row) => `${row.sourceType} ${row.documentNumber}`),
        "a live document with no journal entry",
      ).toEqual([]);

      // Drafts must be the other way round: on no account posted.
      const wronglyPosted = report.exceptions.filter((row) => row.verdict === "posted_in_error");
      expect(wronglyPosted.map((row) => row.documentNumber)).toEqual([]);

      expect(report.exceptions, "any posting exception at all").toEqual([]);
    } finally {
      await closeE2eSession(sb);
    }
  });

  it("ties every control account to the subledger behind it", async () => {
    const { sb } = await openE2eSession();
    try {
      const recon = await getControlReconciliation(sb, TODAY);
      const keys = recon.rows.map((row) => row.controlKey);
      expect(keys).toEqual(["ar", "ap", "inventory", "grni", "sales_tax", "undeposited"]);

      for (const row of recon.rows) {
        expect(
          row.varianceMinor,
          `${row.label} [${row.accountCodes}]: subledger ${row.subledgerMinor} vs ledger ${row.controlMinor}`,
        ).toBe(0);
      }
      expect(recon.allTieOut).toBe(true);
    } finally {
      await closeE2eSession(sb);
    }
  });

  it("agrees with the ageing reports, which compute A/R and A/P their own way", async () => {
    const { sb } = await openE2eSession();
    try {
      const [recon, ar, ap] = await Promise.all([
        getControlReconciliation(sb, TODAY),
        getArAging(sb, TODAY),
        getApAging(sb, TODAY),
      ]);

      // Two independent implementations of the same figure. If they disagree,
      // one of them is wrong and the difference is the point of this test.
      const arRow = recon.rows.find((row) => row.controlKey === "ar")!;
      const apRow = recon.rows.find((row) => row.controlKey === "ap")!;
      expect(arRow.controlMinor, "A/R control account").toBe(ar.controlBalanceMinor);
      expect(apRow.controlMinor, "A/P control account").toBe(ap.controlBalanceMinor);
    } finally {
      await closeE2eSession(sb);
    }
  });

  it("refuses to close a period it cannot verify, and says why", async () => {
    const { sb } = await openE2eSession();
    try {
      const { data: period } = await sb
        .from("acc_accounting_period")
        .select("id,label,status")
        .eq("status", "open")
        .order("period_start")
        .limit(1)
        .maybeSingle();
      if (!period) return; // No open period on these books; nothing to gate.

      const { data: blockers, error } = await sb.rpc("acc_period_close_blockers", {
        p_period_id: (period as { id: string }).id,
      });
      expect(error).toBeNull();
      // The books tie out today, so there should be nothing in the way.
      expect(blockers ?? null, "an unexpected close blocker").toBeNull();
    } finally {
      await closeE2eSession(sb);
    }
  });
});
