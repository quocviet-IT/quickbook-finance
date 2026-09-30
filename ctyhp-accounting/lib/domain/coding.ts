/**
 * The one suggestion a waiting bank line gets, and how the screen says it.
 *
 * In order: a line already matched to the ledger gets none (coding it would
 * post a second entry for money already in the books, and
 * acc_categorise_bank_transaction refuses it anyway); then the first rule that
 * matches; then history; then nothing. Only an account a line can properly be
 * coded to is ever suggested — active, posting, not receivable or payable
 * (money from a customer or to a supplier is settled against a document), not a
 * holding account.
 *
 * Imported by scripts/*.mjs: relative imports only, types only across modules.
 */
import type { AccountType } from "./accounts.ts";
import { firstMatchingRule, type BankRule } from "./bank-rules.ts";
import { suggestFromHistory, type HistoryIndex } from "./coding-history.ts";
import { directionOf } from "./coding-names.ts";

/** The most lines one "Code all" posts. */
export const CODE_ALL_LIMIT = 100;

export interface CodingAccount {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  active: boolean;
  posting: boolean;
}

export function codingAccountOf(row: {
  id: string;
  account_code: string;
  name: string;
  account_type: AccountType;
  status: string;
  is_posting_account: boolean;
}): CodingAccount {
  return {
    id: row.id,
    code: row.account_code,
    name: row.name,
    type: row.account_type,
    active: row.status === "active",
    posting: row.is_posting_account,
  };
}

const HOLDING = /uncategori[sz]ed|suspense/i;

export function codableAccount(account: CodingAccount | undefined): boolean {
  return Boolean(
    account &&
      account.active &&
      account.posting &&
      account.type !== "accounts_receivable" &&
      account.type !== "accounts_payable" &&
      !HOLDING.test(account.name),
  );
}

export interface CodingLine {
  id: string;
  amountMinor: number;
  description: string;
  /** A bank feed's own clean name for the payee, when it gives one. */
  merchantName: string | null;
}

export type CodingSuggestion =
  | { source: "rule"; accountId: string; ruleId: string; ruleNumber: number; ruleText: string }
  | { source: "history"; accountId: string; hits: number; of: number; key: string };

export function suggestCoding(input: {
  line: CodingLine;
  rules: readonly BankRule[];
  index: HistoryIndex;
  accounts: ReadonlyMap<string, CodingAccount>;
  hasMatch: boolean;
}): CodingSuggestion | null {
  const { line, rules, index, accounts, hasMatch } = input;
  if (hasMatch) return null;
  const usable = (accountId: string) => codableAccount(accounts.get(accountId));

  const ordered = [...rules].sort((a, b) => a.position - b.position);
  const rule = firstMatchingRule(ordered, { description: line.description, amountMinor: line.amountMinor }, usable);
  if (rule) {
    return {
      source: "rule",
      accountId: rule.accountId,
      ruleId: rule.id,
      ruleNumber: ordered.indexOf(rule) + 1,
      ruleText: rule.matchText,
    };
  }

  const history = suggestFromHistory(index, [line.merchantName ?? "", line.description], directionOf(line.amountMinor));
  if (history && usable(history.accountId)) {
    return { source: "history", accountId: history.accountId, hits: history.hits, of: history.of, key: history.key };
  }
  return null;
}

/** What the Banking screen needs to show and use one suggestion. */
export interface CodingSuggestionView {
  transactionId: string;
  accountId: string;
  /** "6300 — Rent" */
  accountLabel: string;
  source: "rule" | "history";
  /** "Rule 3" or "11 of 11" — what fits under a 150px picker; `why` has the rest. */
  short: string;
  /** The whole reason, for a tooltip and the Code all list. */
  why: string;
}

export function codingView(line: CodingLine, suggestion: CodingSuggestion, account: CodingAccount): CodingSuggestionView {
  const accountLabel = `${account.code} — ${account.name}`;
  const named = `${account.code} ${account.name}`;
  if (suggestion.source === "rule") {
    return {
      transactionId: line.id,
      accountId: suggestion.accountId,
      accountLabel,
      source: "rule",
      short: `Rule ${suggestion.ruleNumber}`,
      why: `Rule ${suggestion.ruleNumber}: "${suggestion.ruleText}" → ${named}`,
    };
  }
  return {
    transactionId: line.id,
    accountId: suggestion.accountId,
    accountLabel,
    source: "history",
    short: `${suggestion.hits} of ${suggestion.of}`,
    why: `Coded to ${named} ${suggestion.hits} of the last ${suggestion.of} times for "${suggestion.key}"`,
  };
}
