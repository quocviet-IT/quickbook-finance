import type { SupabaseClient } from "@supabase/supabase-js";
import {
  approvalsControl,
  bankReconciliationControl,
  periodStatusControl,
  subledgerControl,
  trialBalanceControl,
  unavailableControl,
} from "@/lib/domain/accounting-dashboard/control-status";
import type { AccountingControl } from "@/lib/domain/accounting-dashboard/types";
import { buildTrialBalance } from "@/lib/domain/reports";
import { getControlReconciliation } from "@/lib/services/gl-posting";
import { getLedgerBalances } from "@/lib/services/reports";
import type { AccountingDashboardContext } from "./context";

/**
 * Every accounting control, evaluated as of the dashboard's date.
 *
 * Each check is settled on its own. A failure to *evaluate* one control leaves
 * it `unavailable` and lets the other six report — the alternative is a page
 * that tells an accountant nothing because one query timed out. What must
 * never happen, and is why `unavailableControl` exists, is a control that
 * could not be computed rendering as one that passed.
 */
export async function getAccountingControls(
  sb: SupabaseClient,
  context: AccountingDashboardContext,
): Promise<AccountingControl[]> {
  const evaluatedAt = new Date().toISOString();
  const { asOf } = context;

  const [ledger, reconciliation, approvals, bank, unmatched] = await Promise.allSettled([
    getLedgerBalances(sb, null, asOf),
    getControlReconciliation(sb, asOf),
    sb
      .from("acc_approval_request")
      .select("requested_at", { count: "exact" })
      .eq("status", "pending")
      .order("requested_at", { ascending: true })
      .limit(1),
    sb
      .from("acc_statement_reconciliation")
      .select("statement_ending_date")
      .eq("status", "completed")
      .order("statement_ending_date", { ascending: false })
      .limit(1),
    sb
      .from("acc_bank_transaction")
      .select("id", { count: "exact", head: true })
      .eq("status", "unmatched")
      .eq("pending", false)
      .is("provider_removed_at", null)
      .lte("txn_date", asOf),
  ]);

  const controls: AccountingControl[] = [];

  // --- Trial balance ---------------------------------------------------
  if (ledger.status === "fulfilled") {
    const tb = buildTrialBalance(ledger.value);
    controls.push(
      trialBalanceControl({
        balanced: tb.balanced,
        differenceMinor: tb.totalDebit - tb.totalCredit,
        evaluatedAt,
      }),
    );
  } else {
    controls.push(
      unavailableControl("trial-balance", "The ledger did not answer in time.", evaluatedAt),
    );
  }

  // --- Subledgers against their control accounts -----------------------
  const SUBLEDGERS = [
    { key: "ar-to-gl", controlKey: "ar" },
    { key: "ap-to-gl", controlKey: "ap" },
    { key: "inventory-to-gl", controlKey: "inventory" },
  ] as const;
  for (const { key, controlKey } of SUBLEDGERS) {
    if (reconciliation.status !== "fulfilled") {
      controls.push(
        unavailableControl(key, "The control reconciliation did not answer.", evaluatedAt),
      );
      continue;
    }
    const row = reconciliation.value.rows.find((r) => r.controlKey === controlKey);
    // Inventory with no subledger row is not a failure: a company that sells
    // no stock has nothing to tie out. It is simply not applicable, and the
    // honest report of "no data" is `unavailable`, not a passing tick.
    controls.push(
      subledgerControl(key, {
        differenceMinor: row ? row.varianceMinor : null,
        evaluatedAt,
      }),
    );
  }

  // --- Accounting periods ----------------------------------------------
  controls.push(
    periodStatusControl({
      openCount: context.periods.filter((p) => p.status === "open").length,
      overdueCount: context.overduePeriods.length,
      evaluatedAt,
    }),
  );

  // --- Controlled actions ----------------------------------------------
  if (approvals.status === "fulfilled" && !approvals.value.error) {
    const oldest = approvals.value.data?.[0]?.requested_at as string | undefined;
    controls.push(
      approvalsControl({
        pendingCount: approvals.value.count ?? 0,
        oldestAgeDays: oldest ? daysBetween(asOf, String(oldest).slice(0, 10)) : null,
        evaluatedAt,
      }),
    );
  } else {
    controls.push(
      unavailableControl("pending-approvals", "The approval queue did not answer.", evaluatedAt),
    );
  }

  // --- Bank reconciliation ----------------------------------------------
  const bankOk = bank.status === "fulfilled" && !bank.value.error;
  const unmatchedOk = unmatched.status === "fulfilled" && !unmatched.value.error;
  if (bankOk && unmatchedOk) {
    controls.push(
      bankReconciliationControl({
        lastCompletedOn:
          (bank.value.data?.[0]?.statement_ending_date as string | undefined) ?? null,
        unmatchedCount: unmatched.value.count ?? 0,
        evaluatedAt,
      }),
    );
  } else {
    controls.push(
      unavailableControl("bank-reconciliation", "The banking tables did not answer.", evaluatedAt),
    );
  }

  return controls;
}

const DAY_MS = 24 * 60 * 60 * 1_000;

function daysBetween(later: string, earlier: string): number {
  return Math.max(
    0,
    Math.round(
      (Date.parse(`${later}T00:00:00.000Z`) - Date.parse(`${earlier}T00:00:00.000Z`)) / DAY_MS,
    ),
  );
}
