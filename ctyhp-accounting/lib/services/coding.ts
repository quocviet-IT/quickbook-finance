import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountRow, BankTransactionRow } from "@/lib/db/types";
import {
  ruleMatches,
  validateRuleInput,
  type BankRule,
  type BankRuleInput,
  type RuleDirection,
  type RuleMatchKind,
} from "@/lib/domain/bank-rules";
import { buildHistoryIndex, type HistorySource } from "@/lib/domain/coding-history";
import {
  CODE_ALL_LIMIT,
  codableAccount,
  codingAccountOf,
  codingView,
  suggestCoding,
  type CodingSuggestionView,
} from "@/lib/domain/coding";
import type { CodingDirection } from "@/lib/domain/coding-names";
import { repaymentFor, type RepaymentAccount } from "@/lib/domain/repayments";
import { listAccounts } from "./accounts";
import { categoriseBankTransaction, listBankTransactions, listSuggestions } from "./banking";
import { repaymentContext } from "./repayment-register";
import { readAllPages } from "./paging";

/**
 * Coding that learns: bank rules, the history of how each name has been
 * coded, and the one suggestion each waiting bank line gets from them.
 *
 * Nothing here posts on its own. `codeFromSuggestions` posts only what a
 * person confirmed, through the same categorise call the Category cell uses,
 * and only where the suggestion — worked out again here — still stands.
 */
export class CodingError extends Error {}

const fail = (message: string) => new CodingError(message);
const RULE_COLUMNS = "id,position,match_kind,match_text,direction,min_minor,max_minor,account_id,is_active";

function ruleFromRow(row: Record<string, unknown>): BankRule {
  return {
    id: row.id as string,
    position: Number(row.position),
    matchKind: row.match_kind as RuleMatchKind,
    matchText: row.match_text as string,
    direction: row.direction as RuleDirection,
    minMinor: row.min_minor === null || row.min_minor === undefined ? null : Number(row.min_minor),
    maxMinor: row.max_minor === null || row.max_minor === undefined ? null : Number(row.max_minor),
    accountId: row.account_id as string,
    isActive: Boolean(row.is_active),
  };
}

export async function listBankRules(sb: SupabaseClient): Promise<BankRule[]> {
  const rows = await readAllPages<Record<string, unknown>>(
    (from, to) => sb.from("acc_bank_rule").select(RULE_COLUMNS).order("position").order("id").range(from, to),
    fail,
  );
  return rows.map(ruleFromRow);
}

export async function loadHistory(sb: SupabaseClient): Promise<HistorySource[]> {
  // entry_id is unique here: an entry is returned once, for its one bank leg.
  const rows = await readAllPages<Record<string, unknown>>(
    (from, to) => sb.rpc("acc_coding_history").order("entry_id").range(from, to),
    fail,
  );
  return rows.map((row) => ({
    entryId: row.entry_id as string,
    date: String(row.entry_date),
    direction: row.direction as CodingDirection,
    accountId: row.account_id as string,
    texts: [row.bank_description, row.entry_description, row.other_memo].filter(
      (text): text is string => typeof text === "string" && text.trim() !== "",
    ),
  }));
}

export interface CodingInputs {
  lines: BankTransactionRow[];
  rules: BankRule[];
  history: HistorySource[];
  accounts: AccountRow[];
  /** Lines with a match suggestion to the ledger: they get no coding suggestion. */
  matchedLineIds: ReadonlySet<string>;
  /** The register of cards and loans (0129). */
  repayments?: readonly RepaymentAccount[];
  /** Bank accounts in the base currency; a line elsewhere is never a repayment. */
  baseCurrencyBankIds?: ReadonlySet<string>;
}

const waiting = (row: BankTransactionRow) => row.status === "unmatched" && !row.pending;

/** Pure: the suggestion for every waiting line that has one. */
export function suggestionsFrom(inputs: CodingInputs): CodingSuggestionView[] {
  const accounts = new Map(inputs.accounts.map((row) => [row.id, codingAccountOf(row)]));
  const index = buildHistoryIndex(inputs.history, (id) => codableAccount(accounts.get(id)));
  const views: CodingSuggestionView[] = [];
  for (const row of inputs.lines) {
    if (!waiting(row)) continue;
    const line = {
      id: row.id,
      amountMinor: Number(row.amount_minor),
      description: row.description ?? "",
      merchantName: row.merchant_name ?? null,
    };
    const repayment = inputs.repayments?.length
      ? repaymentFor(
          inputs.repayments,
          { description: line.description, amountMinor: line.amountMinor, inBaseCurrency: inputs.baseCurrencyBankIds?.has(row.bank_account_id) ?? false },
          accounts,
        )
      : null;
    const suggestion = suggestCoding({ line, rules: inputs.rules, index, accounts, hasMatch: inputs.matchedLineIds.has(row.id), repayment });
    const account = suggestion ? accounts.get(suggestion.accountId) : undefined;
    if (suggestion && account) views.push(codingView(line, suggestion, account));
  }
  return views;
}

export async function codingSuggestions(sb: SupabaseClient, bankAccountId: string | null): Promise<CodingSuggestionView[]> {
  const [lines, rules, history, accounts, matches, context] = await Promise.all([
    listBankTransactions(sb, bankAccountId),
    listBankRules(sb),
    loadHistory(sb),
    listAccounts(sb),
    listSuggestions(sb, bankAccountId),
    repaymentContext(sb),
  ]);
  return suggestionsFrom({
    lines,
    rules,
    history,
    accounts,
    matchedLineIds: new Set(matches.map((match) => match.bank_transaction_id)),
    repayments: context.repayments,
    baseCurrencyBankIds: context.baseCurrencyBankIds,
  });
}

export interface CodeItem {
  transactionId: string;
  /** The account the person was shown, so a suggestion that changed since is not posted. */
  accountId: string;
}

export interface CodeOutcome {
  id: string;
  ok: boolean;
  entry_number?: string | null;
  error?: string;
}

export interface CodeDeps {
  suggestions: (sb: SupabaseClient) => Promise<CodingSuggestionView[]>;
  categorise: (sb: SupabaseClient, transactionId: string, accountId: string) => Promise<{ entry_number: string | null }>;
}

const defaultDeps: CodeDeps = {
  suggestions: (sb) => codingSuggestions(sb, null),
  categorise: categoriseBankTransaction,
};

/** Post what a person confirmed, one line at a time, where the suggestion still stands. */
export async function codeFromSuggestions(
  sb: SupabaseClient,
  items: readonly CodeItem[],
  deps: CodeDeps = defaultDeps,
): Promise<CodeOutcome[]> {
  if (items.length > CODE_ALL_LIMIT) throw new CodingError(`Code at most ${CODE_ALL_LIMIT} lines at a time`);
  // Worked out again here: what the browser was shown may be minutes old.
  const current = new Map((await deps.suggestions(sb)).map((s) => [s.transactionId, s]));
  const outcomes: CodeOutcome[] = [];
  for (const item of items) {
    const suggestion = current.get(item.transactionId);
    if (!suggestion) {
      outcomes.push({ id: item.transactionId, ok: false, error: "This line has no suggestion any more, so nothing was posted" });
      continue;
    }
    if (suggestion.accountId !== item.accountId) {
      outcomes.push({
        id: item.transactionId,
        ok: false,
        error: `The suggestion for this line changed to ${suggestion.accountLabel}, so nothing was posted`,
      });
      continue;
    }
    try {
      const posted = await deps.categorise(sb, item.transactionId, suggestion.accountId);
      outcomes.push({ id: item.transactionId, ok: true, entry_number: posted.entry_number });
    } catch (error) {
      outcomes.push({ id: item.transactionId, ok: false, error: error instanceof Error ? error.message : "Could not post this line" });
    }
  }
  return outcomes;
}

// --- Rules -----------------------------------------------------------------------

export interface RulePreviewInput {
  matchKind: RuleMatchKind;
  matchText: string;
  direction: RuleDirection;
  minMinor: number | null;
  maxMinor: number | null;
}

export interface RulePreview {
  count: number;
  examples: { id: string; txnDate: string; description: string; amountMinor: number }[];
}

async function waitingLines(sb: SupabaseClient): Promise<BankTransactionRow[]> {
  return (await listBankTransactions(sb, null)).filter(waiting);
}

const asTarget = (row: BankTransactionRow) => ({ description: row.description ?? "", amountMinor: Number(row.amount_minor) });

/** How many waiting lines a rule being written would match, with a few of them. */
export async function previewBankRule(sb: SupabaseClient, input: RulePreviewInput): Promise<RulePreview> {
  const problem = validateRuleInput({ ...input, accountId: "preview", isActive: true });
  if (problem) throw new CodingError(problem);
  const rule: BankRule = { ...input, id: "preview", position: 0, accountId: "preview", isActive: true };
  const hits = (await waitingLines(sb)).filter((row) => ruleMatches(rule, asTarget(row)));
  return {
    count: hits.length,
    examples: hits.slice(0, 5).map((row) => ({
      id: row.id,
      txnDate: row.txn_date,
      description: row.description ?? "",
      amountMinor: Number(row.amount_minor),
    })),
  };
}

/** For Banking › Rules: how many waiting lines each rule matches on its own. */
export async function ruleWaitingCounts(
  sb: SupabaseClient,
  rules: readonly BankRule[],
  lines?: readonly BankTransactionRow[],
): Promise<Record<string, number>> {
  const waitingRows = lines ? lines.filter(waiting) : await waitingLines(sb);
  return Object.fromEntries(
    rules.map((rule) => [rule.id, waitingRows.filter((row) => ruleMatches({ ...rule, isActive: true }, asTarget(row))).length]),
  );
}

export async function saveBankRule(sb: SupabaseClient, id: string | null, input: BankRuleInput): Promise<string> {
  const problem = validateRuleInput(input);
  if (problem) throw new CodingError(problem);
  const row = (await listAccounts(sb)).find((account) => account.id === input.accountId);
  if (!codableAccount(row ? codingAccountOf(row) : undefined)) {
    throw new CodingError("A rule codes only to an active posting account that is not receivable, payable or a holding account");
  }
  const fields = {
    match_kind: input.matchKind,
    match_text: input.matchText.trim(),
    direction: input.direction,
    min_minor: input.minMinor,
    max_minor: input.maxMinor,
    account_id: input.accountId,
    is_active: input.isActive,
  };
  if (id) {
    const { data, error } = await sb.from("acc_bank_rule").update(fields).eq("id", id).select("id").single();
    if (error) throw new CodingError(error.message);
    return (data as { id: string }).id;
  }
  const { data: last, error: lastError } = await sb
    .from("acc_bank_rule")
    .select("position")
    .order("position", { ascending: false })
    .limit(1);
  if (lastError) throw new CodingError(lastError.message);
  const position = (last?.[0] ? Number((last[0] as { position: number }).position) : 0) + 1;
  const { data, error } = await sb.from("acc_bank_rule").insert({ ...fields, position }).select("id").single();
  if (error) throw new CodingError(error.message);
  return (data as { id: string }).id;
}

export async function deleteBankRule(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.from("acc_bank_rule").delete().eq("id", id);
  if (error) throw new CodingError(error.message);
}

export async function reorderBankRules(sb: SupabaseClient, ids: readonly string[]): Promise<void> {
  const { error } = await sb.rpc("acc_reorder_bank_rules", { p_ids: ids });
  if (error) throw new CodingError(error.message);
}
