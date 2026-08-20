/**
 * What-if financial analysis: hypothetical, balanced adjustments laid over
 * real ledger balances. Nothing in this module writes anywhere — the entire
 * point of the feature is that the analysis "does not save to the data"
 * (the requester's words). The one persistent artifact is a frozen snapshot,
 * and even that is a photograph of a rendering, never a journal entry.
 *
 * Design record: docs/superpowers/specs/2026-08-20-what-if-analysis-design.md
 */

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
