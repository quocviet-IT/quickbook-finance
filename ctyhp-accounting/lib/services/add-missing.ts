/**
 * Adding the statement lines the books do not have (1.82): what the
 * reconciliation's box shows, worked out from the kept statement, the books,
 * the account's bank lines and their coding suggestions; and the click that
 * posts them through acc_add_statement_lines_to_books, then pairs and ticks.
 *
 * 2.03: a line the statement balances without, or one the books seem to hold
 * already, is held back from "Add all N"; the screen offers "Add anyway" for
 * it alone.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  chooseLinesToAdd,
  linesToCheckForDuplicates,
  planAddMissing,
  type AddBankLine,
  type AddMissingPlan,
  type AddSuggestion,
  type ChosenLine,
} from "@/lib/domain/add-missing";
import { reconciliationStandings, type PairingOutcome } from "@/lib/domain/reconcile-statement";
import { holdingAccountsOf } from "@/lib/domain/uncategorized";
import { listAccounts } from "./accounts";
import { listSuggestions } from "./banking";
import { getReconciliationLines, getReconciliationStatement, listReconciliations, pairAndTick } from "./bankrec";
import { codingSuggestions } from "./coding";
import { statementLineDuplicates } from "./reconcile-history";
import { bankLinesBetween } from "./statement-bank-lines";

export class AddMissingError extends Error {}

/**
 * What "Add all N to the books" would add to this reconciliation, what is held
 * back from it, and what cannot be added. The books are asked about the lines
 * "Add all" would add, and only when there are some.
 */
export async function getAddMissingPlan(sb: SupabaseClient, reconciliationId: string): Promise<AddMissingPlan> {
  const [statement, book] = await Promise.all([
    getReconciliationStatement(sb, reconciliationId),
    getReconciliationLines(sb, reconciliationId),
  ]);
  const standings = reconciliationStandings(statement, book);
  const balances = { openingMinor: statement.openingMinor, closingMinor: statement.closingMinor };
  const missingDates = statement.lines.filter((_, i) => standings.standings[i]?.kind === "missing").map((l) => l.txnDate).sort();
  if (!missingDates.length || standings.flipped) {
    return planAddMissing({
      lines: statement.lines,
      standings: standings.standings,
      flipped: standings.flipped,
      transactions: [],
      suggestions: new Map(),
      holding: { income: null, expense: null },
      ...balances,
    });
  }

  const bankAccountId = statement.bankAccountId;
  const [rows, matches, coding, accounts, reconciliations] = await Promise.all([
    bankLinesBetween(sb, bankAccountId, missingDates[0], missingDates[missingDates.length - 1]),
    listSuggestions(sb, bankAccountId),
    codingSuggestions(sb, bankAccountId),
    listAccounts(sb),
    listReconciliations(sb, bankAccountId),
  ]);
  // The newest month signed off before this one: a line dated in it is not added from here.
  const signedThrough =
    reconciliations
      .filter((r) => r.status === "completed" && r.statement_ending_date < statement.endingDate)
      .map((r) => r.statement_ending_date)
      .sort()
      .at(-1) ?? null;
  const suggested = new Set(matches.map((m) => m.bank_transaction_id));
  const transactions: AddBankLine[] = rows.map((row) => ({
    id: row.id,
    txnDate: row.txnDate,
    description: row.description,
    reference: row.reference,
    amountMinor: row.amountMinor,
    status: row.status,
    suggested: suggested.has(row.id),
  }));
  const suggestions = new Map<string, AddSuggestion>(
    coding.map((s) => [s.transactionId, { accountId: s.accountId, accountLabel: s.accountLabel, source: s.source, short: s.short, why: s.why }]),
  );
  const base = {
    lines: statement.lines,
    standings: standings.standings,
    flipped: false,
    transactions,
    suggestions,
    holding: holdingAccountsOf(accounts),
    signedThrough,
    ...balances,
  };
  const plan = planAddMissing(base);
  const asked = linesToCheckForDuplicates(plan);
  if (!asked.length) return plan;
  const duplicates = await statementLineDuplicates(sb, reconciliationId, asked);
  return duplicates.size ? planAddMissing({ ...base, duplicates }) : plan;
}

export interface AddedLines {
  added: number;
  uncategorized: number;
  /** Null when pairing failed after the lines were posted. */
  outcome: PairingOutcome | null;
  /** Why pairing failed, when it did: the lines are in the books, not yet ticked. */
  pairingError: string | null;
}

/** Shown to the person: a line and the account it would post to. */
export type ShownItem = ChosenLine;

export const PLAN_CHANGED = "The lines to add changed since this page was drawn, so nothing was posted. Look them over again.";

/**
 * Posts the lines asked for, every one or none; then pairs and ticks. The plan
 * is worked out again here, and each line must still be in it as the person
 * was shown it: in "Add all N", or held back and chosen with "Add anyway" (the
 * line numbers in `anyway`), posting to the same account. A suggestion or a
 * bank line that changed since is not posted unseen.
 */
export async function addMissingLines(
  sb: SupabaseClient,
  reconciliationId: string,
  shown: readonly ShownItem[],
  anyway: readonly number[] = [],
): Promise<AddedLines> {
  const plan = await getAddMissingPlan(sb, reconciliationId);
  if (plan.blocked) throw new AddMissingError(plan.blocked);
  if (!plan.items.length && !plan.held.length) throw new AddMissingError("There is nothing to add");
  const chosen = chooseLinesToAdd(plan, shown, anyway);
  if (!chosen?.length) throw new AddMissingError(PLAN_CHANGED);
  const { error } = await sb.rpc("acc_add_statement_lines_to_books", {
    p_reconciliation_id: reconciliationId,
    p_items: chosen.map((item) => ({ line_no: item.lineNo, bank_transaction_id: item.transactionId, account_id: item.accountId })),
  });
  if (error) throw new AddMissingError(error.message);
  // The lines are in the books now, whatever happens next: a pairing that fails
  // is said as such, never as lines that were not added.
  const added = { added: chosen.length, uncategorized: chosen.filter((item) => item.source === "uncategorized").length };
  try {
    return { ...added, outcome: await pairAndTick(sb, reconciliationId), pairingError: null };
  } catch (e) {
    return { ...added, outcome: null, pairingError: e instanceof Error ? e.message : "an unexpected error" };
  }
}
