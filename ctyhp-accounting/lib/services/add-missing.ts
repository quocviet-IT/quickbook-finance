/**
 * Adding the statement lines the books do not have (1.82): what the
 * reconciliation's box shows, worked out from the kept statement, the books,
 * the account's bank lines and their coding suggestions; and the click that
 * posts them all through acc_add_statement_lines_to_books, then pairs and ticks.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { planAddMissing, type AddBankLine, type AddMissingPlan, type AddSuggestion } from "@/lib/domain/add-missing";
import { reconciliationStandings, type PairingOutcome } from "@/lib/domain/reconcile-statement";
import { holdingAccountsOf } from "@/lib/domain/uncategorized";
import { listAccounts } from "./accounts";
import { listSuggestions } from "./banking";
import { getReconciliationLines, getReconciliationStatement, listReconciliations, pairAndTick } from "./bankrec";
import { codingSuggestions } from "./coding";
import { bankLinesBetween } from "./statement-bank-lines";

export class AddMissingError extends Error {}

/** What "Add all N to the books" would add to this reconciliation, and what it cannot. */
export async function getAddMissingPlan(sb: SupabaseClient, reconciliationId: string): Promise<AddMissingPlan> {
  const [statement, book] = await Promise.all([
    getReconciliationStatement(sb, reconciliationId),
    getReconciliationLines(sb, reconciliationId),
  ]);
  const standings = reconciliationStandings(statement, book);
  const missingDates = statement.lines.filter((_, i) => standings.standings[i]?.kind === "missing").map((l) => l.txnDate).sort();
  if (!missingDates.length || standings.flipped) {
    return planAddMissing({
      lines: statement.lines,
      standings: standings.standings,
      flipped: standings.flipped,
      transactions: [],
      suggestions: new Map(),
      holding: { income: null, expense: null },
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
  return planAddMissing({
    lines: statement.lines,
    standings: standings.standings,
    flipped: false,
    transactions,
    suggestions,
    holding: holdingAccountsOf(accounts),
    signedThrough,
  });
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
export interface ShownItem {
  lineNo: number;
  accountId: string;
}

const sameItems = (a: readonly ShownItem[], b: readonly ShownItem[]) => {
  const key = (items: readonly ShownItem[]) => items.map((i) => `${i.lineNo}:${i.accountId}`).sort().join(",");
  return key(a) === key(b);
};

/**
 * Posts every line the plan adds, or none; then pairs and ticks. The plan is
 * worked out again here, and it must be the one the person was shown: a
 * suggestion or a bank line that changed since is not posted unseen.
 */
export async function addMissingLines(sb: SupabaseClient, reconciliationId: string, shown: readonly ShownItem[]): Promise<AddedLines> {
  const plan = await getAddMissingPlan(sb, reconciliationId);
  if (plan.blocked) throw new AddMissingError(plan.blocked);
  if (!plan.items.length) throw new AddMissingError("There is nothing to add");
  if (!sameItems(plan.items, shown)) {
    throw new AddMissingError("The lines to add changed since this page was drawn, so nothing was posted. Look them over again.");
  }
  const { error } = await sb.rpc("acc_add_statement_lines_to_books", {
    p_reconciliation_id: reconciliationId,
    p_items: plan.items.map((item) => ({ line_no: item.lineNo, bank_transaction_id: item.transactionId, account_id: item.accountId })),
  });
  if (error) throw new AddMissingError(error.message);
  // The lines are in the books now, whatever happens next: a pairing that fails
  // is said as such, never as lines that were not added.
  const added = { added: plan.items.length, uncategorized: plan.uncategorized };
  try {
    return { ...added, outcome: await pairAndTick(sb, reconciliationId), pairingError: null };
  } catch (e) {
    return { ...added, outcome: null, pairingError: e instanceof Error ? e.message : "an unexpected error" };
  }
}
