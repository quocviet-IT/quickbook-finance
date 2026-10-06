/**
 * The statement lines the books do not have, as "Add all N to the books"
 * adds them (1.82, after the prototype's recAddMissing in p24.html).
 *
 * Each line the pairing left "missing" is paired with the bank line it was
 * imported as — same date, amount, description and reference, the n-th of
 * identical lines with the n-th — and coded by that bank line's suggestion
 * (card, related company, rule, history) or, when nothing places it, to
 * Uncategorized Income or Expense by its direction, to be recoded later. A line
 * that cannot be added says why. Pure: the service reads, this decides.
 */
import type { Standing } from "./reconcile-statement";
import type { HoldingAccounts } from "./uncategorized";

/** The most lines one click adds; matches acc_add_statement_lines_to_books. */
export const ADD_MISSING_LIMIT = 500;

export interface AddStatementLine {
  lineNo: number;
  txnDate: string;
  description: string;
  reference: string | null;
  amountMinor: number;
}

export interface AddBankLine {
  id: string;
  txnDate: string;
  description: string | null;
  reference: string | null;
  amountMinor: number;
  status: string;
  /** The matcher suggests a book line for it: it may already be in the books. */
  suggested: boolean;
}

export interface AddSuggestion {
  accountId: string;
  accountLabel: string;
  source: "rule" | "history" | "card" | "related";
  /** "Rule 3", "11 of 11", "Card" */
  short: string;
  why: string;
}

export type AddSource = AddSuggestion["source"] | "uncategorized";

export interface AddItem {
  lineNo: number;
  txnDate: string;
  description: string;
  amountMinor: number;
  transactionId: string;
  accountId: string;
  accountLabel: string;
  source: AddSource;
  short: string;
  why: string;
}

export type CannotAddReason = "not-found" | "coded" | "ignored" | "suggested";

export interface CannotAdd {
  lineNo: number;
  txnDate: string;
  description: string;
  amountMinor: number;
  reason: CannotAddReason;
  note: string;
}

export interface AddMissingPlan {
  /** Statement lines the books do not have, dated on or before the statement date. */
  missing: number;
  items: AddItem[];
  cannot: CannotAdd[];
  /** Of the items, how many go to Uncategorized. */
  uncategorized: number;
  /** Why nothing can be added from here, when nothing can. */
  blocked: string | null;
}

export const CANNOT_ADD_NOTE: Record<CannotAddReason, string> = {
  "not-found": "Not in Bank Transactions — import the statement again, or add it there.",
  coded: "Already in the books — click Match again.",
  ignored: "Excluded in Bank Transactions — include it there to add it.",
  suggested: "Bank Transactions suggests a match in the books for it — approve or reject that first.",
};

export const ADD_BLOCKED = {
  flipped:
    "This statement shows money in and out the other way around from the books, so nothing is added from here. Check the signs of its lines in Bank Transactions.",
  tooMany: `More than ${ADD_MISSING_LIMIT} lines — code them in Bank Transactions.`,
  noHolding: "This company has no Uncategorized accounts yet, so lines nothing places cannot be added from here.",
} as const;

export const UNCATEGORIZED_WHY = "Nothing places this line, so it goes to Uncategorized, to recode later.";

/**
 * The key a statement line and its bank line share. The statement keeps a
 * description cut to 500 characters and a reference trimmed to 80, where the
 * bank line keeps them as the file gave them — so both are read the same way.
 */
function lineKey(txnDate: string, amountMinor: number, description: string | null, reference: string | null): string {
  const ref = (reference ?? "").trim().slice(0, 80);
  return JSON.stringify([txnDate, amountMinor, (description ?? "").slice(0, 500), ref]);
}

export function planAddMissing(input: {
  lines: readonly AddStatementLine[];
  /** One per line, in the same order (reconciliationStandings). */
  standings: readonly Standing[];
  flipped: boolean;
  /** The bank account's lines; identical lines in the order they were imported. */
  transactions: readonly AddBankLine[];
  /** The suggestion for each waiting bank line, by its id. */
  suggestions: ReadonlyMap<string, AddSuggestion>;
  holding: HoldingAccounts;
}): AddMissingPlan {
  const missingLines = input.lines.filter((_, i) => input.standings[i]?.kind === "missing");
  const empty = (blocked: string | null): AddMissingPlan => ({
    missing: missingLines.length,
    items: [],
    cannot: [],
    uncategorized: 0,
    blocked,
  });
  if (!missingLines.length) return empty(null);
  if (input.flipped) return empty(ADD_BLOCKED.flipped);

  const groups = new Map<string, AddBankLine[]>();
  for (const txn of input.transactions) {
    const key = lineKey(txn.txnDate, txn.amountMinor, txn.description, txn.reference);
    groups.set(key, [...(groups.get(key) ?? []), txn]);
  }
  const taken = new Set<string>();

  const items: AddItem[] = [];
  const cannot: CannotAdd[] = [];
  for (const line of missingLines) {
    const group = groups.get(lineKey(line.txnDate, line.amountMinor, line.description, line.reference)) ?? [];
    const free = group.find((txn) => !taken.has(txn.id) && txn.status === "unmatched" && !txn.suggested);
    const said = { lineNo: line.lineNo, txnDate: line.txnDate, description: line.description, amountMinor: line.amountMinor };
    if (!free) {
      const rest = group.filter((txn) => !taken.has(txn.id));
      const reason: CannotAddReason = rest.some((t) => t.status === "unmatched" && t.suggested)
        ? "suggested"
        : rest.some((t) => t.status === "matched")
          ? "coded"
          : rest.some((t) => t.status === "ignored")
            ? "ignored"
            : "not-found";
      cannot.push({ ...said, reason, note: CANNOT_ADD_NOTE[reason] });
      continue;
    }
    taken.add(free.id);
    const suggestion = input.suggestions.get(free.id);
    if (suggestion) {
      items.push({
        ...said,
        transactionId: free.id,
        accountId: suggestion.accountId,
        accountLabel: suggestion.accountLabel,
        source: suggestion.source,
        short: suggestion.short,
        why: suggestion.why,
      });
      continue;
    }
    const holding = line.amountMinor > 0 ? input.holding.income : input.holding.expense;
    if (!holding) return { ...empty(ADD_BLOCKED.noHolding), cannot };
    items.push({
      ...said,
      transactionId: free.id,
      accountId: holding.id,
      accountLabel: holding.label,
      source: "uncategorized",
      short: "",
      why: UNCATEGORIZED_WHY,
    });
  }

  const blocked = items.length > ADD_MISSING_LIMIT ? ADD_BLOCKED.tooMany : null;
  return {
    missing: missingLines.length,
    items: blocked ? [] : items,
    cannot,
    uncategorized: blocked ? 0 : items.filter((item) => item.source === "uncategorized").length,
    blocked,
  };
}

/** The message after adding: "3 entries added from the statement and ticked; 1 went to Uncategorized." */
export function addedMessage(added: number, uncategorized: number): string {
  const head = `${added} ${added === 1 ? "entry" : "entries"} added from the statement and ticked`;
  return uncategorized ? `${head}; ${uncategorized} went to Uncategorized.` : `${head}.`;
}
