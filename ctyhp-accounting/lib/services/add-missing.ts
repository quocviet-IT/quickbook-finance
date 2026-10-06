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
import { getReconciliationLines, getReconciliationStatement, pairAndTick } from "./bankrec";
import { codingSuggestions } from "./coding";
import { readAllPages } from "./paging";

export class AddMissingError extends Error {}

async function bankLinesBetween(sb: SupabaseClient, bankAccountId: string, from: string, to: string) {
  // Paged, oldest first; the id settles lines of one day, so identical lines
  // keep one order however many pages the read takes.
  return readAllPages<Record<string, unknown>>(
    (start, end) =>
      sb
        .from("acc_bank_transaction")
        .select("id,txn_date,description,reference,amount_minor,status")
        .eq("bank_account_id", bankAccountId)
        .is("provider_removed_at", null)
        .gte("txn_date", from)
        .lte("txn_date", to)
        .order("txn_date")
        .order("id")
        .range(start, end),
    (message) => new AddMissingError(message),
  );
}

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
  const [rows, matches, coding, accounts] = await Promise.all([
    bankLinesBetween(sb, bankAccountId, missingDates[0], missingDates[missingDates.length - 1]),
    listSuggestions(sb, bankAccountId),
    codingSuggestions(sb, bankAccountId),
    listAccounts(sb),
  ]);
  const suggested = new Set(matches.map((m) => m.bank_transaction_id));
  const transactions: AddBankLine[] = rows.map((row) => ({
    id: row.id as string,
    txnDate: row.txn_date as string,
    description: (row.description as string | null) ?? null,
    reference: (row.reference as string | null) ?? null,
    amountMinor: Number(row.amount_minor),
    status: row.status as string,
    suggested: suggested.has(row.id as string),
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
  });
}

export interface AddedLines {
  added: number;
  uncategorized: number;
  outcome: PairingOutcome;
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
  const outcome = await pairAndTick(sb, reconciliationId);
  return { added: plan.items.length, uncategorized: plan.uncategorized, outcome };
}
