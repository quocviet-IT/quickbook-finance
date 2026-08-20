/**
 * What-if financial analysis: hypothetical, balanced adjustments laid over
 * real ledger balances. Nothing in this module writes anywhere — the entire
 * point of the feature is that the analysis "does not save to the data"
 * (the requester's words). The one persistent artifact is a frozen snapshot,
 * and even that is a photograph of a rendering, never a journal entry.
 *
 * Design record: docs/superpowers/specs/2026-08-20-what-if-analysis-design.md
 */
import { z } from "zod";
import type { AccountType } from "@/lib/domain/accounts";
import type { BalanceSheet, LedgerBalance, ProfitAndLoss } from "@/lib/domain/reports";
import { buildBalanceSheet, buildProfitAndLoss } from "@/lib/domain/reports";

export interface AdjustmentLine {
  accountId: string;
  /** Signed, minor units: positive adds to the debit side, negative to credit. */
  deltaMinor: number;
}

export interface AnalysisAdjustment {
  /** Client-generated key, unique within one workspace session. */
  key: string;
  label: string;
  lines: AdjustmentLine[];
}

function money(minor: number): string {
  return (Math.abs(minor) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });
}

/** Null when the adjustment could be a real journal entry; a reason otherwise. */
export function validateAdjustment(adj: AnalysisAdjustment): string | null {
  if (adj.label.trim().length === 0) {
    return "Give the adjustment a label — a frozen report must say what was assumed.";
  }
  if (adj.lines.length < 2) {
    return "An adjustment needs at least two lines; one leg cannot balance.";
  }
  for (const line of adj.lines) {
    if (!Number.isInteger(line.deltaMinor)) {
      return "Amounts must be whole minor units.";
    }
    if (line.deltaMinor === 0) {
      return "A line of zero changes nothing — remove it or give it an amount.";
    }
  }
  const debits = adj.lines.reduce((s, l) => s + Math.max(l.deltaMinor, 0), 0);
  const credits = adj.lines.reduce((s, l) => s - Math.min(l.deltaMinor, 0), 0);
  if (debits !== credits) {
    return `Adjustment does not balance: debits ${money(debits)} vs credits ${money(credits)}.`;
  }
  return null;
}

export interface AdjustableAccount {
  accountId: string;
  accountCode: string;
  name: string;
  accountType: AccountType;
}

/**
 * Lay the adjustments over the balances, returning new rows.
 *
 * An account can carry an adjustment while having no activity in the period —
 * assuming rent for a company that has never paid rent is a normal what-if —
 * so missing rows are synthesized from the chart at zero. An account the
 * chart itself does not know is a caller bug, not a scenario, and throws.
 */
export function applyAdjustments(
  rows: LedgerBalance[],
  adjustments: AnalysisAdjustment[],
  accounts: AdjustableAccount[],
): LedgerBalance[] {
  const byId = new Map(rows.map((r) => [r.accountId, { ...r }]));
  const chart = new Map(accounts.map((a) => [a.accountId, a]));
  for (const adj of adjustments) {
    for (const line of adj.lines) {
      let row = byId.get(line.accountId);
      if (!row) {
        const account = chart.get(line.accountId);
        if (!account) throw new Error(`Unknown account in adjustment: ${line.accountId}`);
        row = {
          accountId: account.accountId,
          accountCode: account.accountCode,
          name: account.name,
          accountType: account.accountType,
          debitBase: 0,
          creditBase: 0,
        };
        byId.set(line.accountId, row);
      }
      if (line.deltaMinor > 0) row.debitBase += line.deltaMinor;
      else row.creditBase += -line.deltaMinor;
    }
  }
  return [...byId.values()];
}

export interface WhatIfAnalysis {
  pnl: { actual: ProfitAndLoss; adjusted: ProfitAndLoss };
  balanceSheet: { actual: BalanceSheet; adjusted: BalanceSheet };
}

/**
 * The same adjustments hit both row sets: a what-if entry is dated inside the
 * period, so it moves the period's P&L and the as-of sheet together. Because
 * buildBalanceSheet derives Current earnings from its own rows, a balanced
 * adjustment keeps the adjusted sheet balanced with no extra bookkeeping here.
 */
export function buildWhatIfAnalysis(
  pnlRows: LedgerBalance[],
  bsRows: LedgerBalance[],
  adjustments: AnalysisAdjustment[],
  accounts: AdjustableAccount[],
): WhatIfAnalysis {
  return {
    pnl: {
      actual: buildProfitAndLoss(pnlRows),
      adjusted: buildProfitAndLoss(applyAdjustments(pnlRows, adjustments, accounts)),
    },
    balanceSheet: {
      actual: buildBalanceSheet(bsRows),
      adjusted: buildBalanceSheet(applyAdjustments(bsRows, adjustments, accounts)),
    },
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const adjustmentLineSchema = z.object({
  accountId: z.string().uuid(),
  deltaMinor: z.number().int().refine((n) => n !== 0, "A line of zero changes nothing."),
});

const adjustmentSchema = z
  .object({
    key: z.string().min(1).max(64),
    label: z.string().trim().min(1, "Give the adjustment a label.").max(200),
    lines: z.array(adjustmentLineSchema).min(2).max(30),
  })
  .refine((adj) => validateAdjustment(adj) === null, {
    message: "Adjustment does not balance.",
  });

export const freezeAnalysisSchema = z
  .object({
    title: z.string().trim().min(1, "Give the analysis a title.").max(120),
    notes: z.string().trim().max(2000).nullable(),
    periodStart: z.string().regex(ISO_DATE),
    periodEnd: z.string().regex(ISO_DATE),
    adjustments: z.array(adjustmentSchema).min(1, "Freeze at least one adjustment.").max(50),
  })
  .refine((v) => v.periodEnd >= v.periodStart, {
    message: "The period cannot end before it starts.",
  });

export type FreezeAnalysisInput = z.infer<typeof freezeAnalysisSchema>;
