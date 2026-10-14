/**
 * The statement lines the books do not have, as "Add all N to the books"
 * adds them (1.82, after the prototype's recAddMissing in p24.html).
 *
 * Each line the pairing left "missing" is paired with the bank line it was
 * imported as — same date, amount, description and reference, the n-th of
 * identical lines with the n-th — and coded by that bank line's suggestion
 * (card, related company, rule, history) or, when nothing places it, to
 * Uncategorized Income or Expense by its direction, to be recoded later. A line
 * that cannot be added says why.
 *
 * Two kinds of line are held back from "Add all N" (2.03), each with its own
 * "Add anyway": a line the statement balances without, since a line the bank
 * never had is likely a misread (extraStatementLines); and a line the books
 * seem to hold already (acc_statement_line_duplicates). Both are warnings, not
 * blocks: two identical lines on one day can both be real.
 *
 * Pure: the service reads, this decides.
 */
import type { Standing } from "./reconcile-statement";
import { statementLineKey } from "./statement-bank-lines";
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

export type CannotAddReason = "not-found" | "coded" | "ignored" | "suggested" | "zero" | "signed";

export interface CannotAdd {
  lineNo: number;
  txnDate: string;
  description: string;
  amountMinor: number;
  reason: CannotAddReason;
  note: string;
}

/** A posted line the books hold that a statement line may be (acc_statement_line_duplicates). */
export interface DuplicateMatch {
  journalLineId: string;
  entryId: string;
  entryNumber: string | null;
  entryDate: string;
}

export type HeldReason = "extra" | "duplicate";

/** A line that could be added, held back from "Add all N": the screen offers "Add anyway" for it alone. */
export interface HeldLine extends AddItem {
  reason: HeldReason;
  note: string;
  /** What the books already hold that it looks like; empty for an extra line. */
  matches: DuplicateMatch[];
}

export interface AddMissingPlan {
  /** Statement lines the books do not have, dated on or before the statement date (none set aside). */
  missing: number;
  /** What "Add all N" adds: N is their count. */
  items: AddItem[];
  /** Lines that could be added but are held back, each with why. */
  held: HeldLine[];
  cannot: CannotAdd[];
  /** Of the items, how many go to Uncategorized. */
  uncategorized: number;
  /** Why nothing can be added from here, when nothing can. */
  blocked: string | null;
}

export const EXTRA_LINE_NOTE = "Extra — likely not a transaction: the statement already balances without it.";
/** The tag beside a held-back extra line in the statement lines table. */
export const EXTRA_LINE_TAG = "Extra";
/** Above the lines held back, in the Add missing box. */
export const HELD_BACK_HEADING = "Held back from Add all:";
/** The button that posts one held-back line alone. */
export const ADD_ANYWAY = "Add anyway";

/**
 * The statement lines the statement balances without: likely not
 * transactions. Only a line the books do not have (`missing`) can be one; a
 * line set aside counts for nothing, and a line dated after the statement is
 * never marked. Both rules need the opening and the closing the statement
 * prints.
 *
 * 1. The statement already balances on the lines the books pair with (its
 *    opening plus its paired lines is its closing): every missing line is
 *    extra.
 * 2. Otherwise, when the statement does not prove itself — its opening plus
 *    all its lines not set aside misses its closing by some amount — and
 *    exactly one missing line is that amount, that line alone is extra. Without
 *    it the statement balances. Two lines of that amount could be either, so
 *    neither is marked; a real line missing from the books (a fee) beside the
 *    misread one stays to be added.
 *
 * The one place this is decided: planAddMissing holds these lines back, and
 * the statement lines table marks the lines the plan holds back.
 */
export function extraStatementLines(input: {
  lines: readonly Pick<AddStatementLine, "lineNo" | "amountMinor">[];
  /** One per line, in the same order (reconciliationStandings). */
  standings: readonly Standing[];
  openingMinor?: number | null;
  closingMinor?: number | null;
}): Set<number> {
  const opening = input.openingMinor ?? null;
  const closing = input.closingMinor ?? null;
  if (opening === null || closing === null) return new Set();
  const kindOf = (i: number) => input.standings[i]?.kind;
  const missing = input.lines.filter((_, i) => kindOf(i) === "missing");
  if (!missing.length) return new Set();

  const pairedMinor = input.lines.reduce((sum, line, i) => (kindOf(i) === "paired" ? sum + line.amountMinor : sum), 0);
  if (opening + pairedMinor === closing) return new Set(missing.map((line) => line.lineNo));

  const linesMinor = input.lines.reduce((sum, line, i) => (kindOf(i) === "aside" ? sum : sum + line.amountMinor), 0);
  const outMinor = opening + linesMinor - closing;
  if (outMinor === 0) return new Set();
  const theOne = missing.filter((line) => line.amountMinor === outMinor);
  return theOne.length === 1 ? new Set([theOne[0].lineNo]) : new Set();
}

/** The statement lines the plan holds back as extra, by line number; none without a plan. */
export function extraLineNos(plan: Pick<AddMissingPlan, "held"> | null): Set<number> {
  return new Set((plan?.held ?? []).filter((line) => line.reason === "extra").map((line) => line.lineNo));
}

/** "Looks like JE-000123 already in the books.", "Looks like JE-000123 and 2 more already in the books." */
export function duplicateNote(matches: readonly DuplicateMatch[]): string {
  const entries = [...new Map(matches.map((m) => [m.entryId, m])).values()];
  const first = entries[0]?.entryNumber ?? "an entry";
  const more = entries.length > 1 ? ` and ${entries.length - 1} more` : "";
  return `Looks like ${first}${more} already in the books.`;
}

export const CANNOT_ADD_NOTE: Record<CannotAddReason, string> = {
  "not-found": "Not in Bank Transactions — import the statement again, or add it there.",
  coded: "Already in the books — click Match again.",
  ignored: "Excluded in Bank Transactions — include it there to add it.",
  suggested: "Bank Transactions suggests a match in the books for it — approve or reject that first.",
  zero: "A line of 0.00 has nothing to post.",
  signed: "Dated in a month already reconciled — add it in Bank Transactions if it belongs there.",
};

export const ADD_BLOCKED = {
  flipped:
    "This statement shows money in and out the other way around from the books, so nothing is added from here. Check the signs of its lines in Bank Transactions.",
  tooMany: `More than ${ADD_MISSING_LIMIT} lines — code them in Bank Transactions.`,
  noHolding: "This company has no active Uncategorized accounts, so lines nothing places cannot be added from here.",
} as const;

export const UNCATEGORIZED_WHY = "Nothing places this line, so it goes to Uncategorized, to recode later.";

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
  /**
   * The statement date of the account's newest completed reconciliation before
   * this one, when there is one: a line dated on or before it belongs to a
   * month somebody signed off, and is not added from here.
   */
  signedThrough?: string | null;
  /** The balances the statement prints; null when it prints none. */
  openingMinor?: number | null;
  closingMinor?: number | null;
  /** What the books already hold that each line may be, by line number. */
  duplicates?: ReadonlyMap<number, readonly DuplicateMatch[]>;
}): AddMissingPlan {
  const missingLines = input.lines.filter((_, i) => input.standings[i]?.kind === "missing");
  const empty = (blocked: string | null): AddMissingPlan => ({
    missing: missingLines.length,
    items: [],
    held: [],
    cannot: [],
    uncategorized: 0,
    blocked,
  });
  if (!missingLines.length) return empty(null);
  if (input.flipped) return empty(ADD_BLOCKED.flipped);

  // The lines the statement balances without are likely not transactions.
  const extra = extraStatementLines(input);

  const groups = new Map<string, AddBankLine[]>();
  for (const txn of input.transactions) {
    const key = statementLineKey(txn);
    groups.set(key, [...(groups.get(key) ?? []), txn]);
  }
  const taken = new Set<string>();

  const items: AddItem[] = [];
  const held: HeldLine[] = [];
  const cannot: CannotAdd[] = [];
  const place = (item: AddItem) => {
    const matches = input.duplicates?.get(item.lineNo) ?? [];
    if (extra.has(item.lineNo)) held.push({ ...item, reason: "extra", note: EXTRA_LINE_NOTE, matches: [] });
    else if (matches.length) held.push({ ...item, reason: "duplicate", note: duplicateNote(matches), matches: [...matches] });
    else items.push(item);
  };
  for (const line of missingLines) {
    const group = groups.get(statementLineKey(line)) ?? [];
    const free = group.find((txn) => !taken.has(txn.id) && txn.status === "unmatched" && !txn.suggested);
    const said = { lineNo: line.lineNo, txnDate: line.txnDate, description: line.description, amountMinor: line.amountMinor };
    if (line.amountMinor === 0 || (input.signedThrough && line.txnDate <= input.signedThrough)) {
      const reason: CannotAddReason = line.amountMinor === 0 ? "zero" : "signed";
      cannot.push({ ...said, reason, note: CANNOT_ADD_NOTE[reason] });
      continue;
    }
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
      place({
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
    place({
      ...said,
      transactionId: free.id,
      accountId: holding.id,
      accountLabel: holding.label,
      source: "uncategorized",
      short: "",
      why: UNCATEGORIZED_WHY,
    });
  }

  // One click adds at most the limit, whether through "Add all" or "Add anyway".
  const blocked = items.length + held.length > ADD_MISSING_LIMIT ? ADD_BLOCKED.tooMany : null;
  return {
    missing: missingLines.length,
    items: blocked ? [] : items,
    held: blocked ? [] : held,
    cannot,
    uncategorized: blocked ? 0 : items.filter((item) => item.source === "uncategorized").length,
    blocked,
  };
}

/** The line numbers worth asking acc_statement_line_duplicates about: the ones "Add all N" would add. */
export function linesToCheckForDuplicates(plan: AddMissingPlan): number[] {
  return plan.blocked ? [] : plan.items.map((item) => item.lineNo);
}

/** A line the person asked to add, as the screen showed it: the line and the account it would post to. */
export interface ChosenLine {
  lineNo: number;
  accountId: string;
}

/**
 * The lines to post, as the plan worked out again on the server has them: each
 * one asked for must be in "Add all N", or held back and chosen with "Add
 * anyway", and post to the account the person was shown. Null when the plan no
 * longer says what the person saw — nothing is posted unseen.
 */
export function chooseLinesToAdd(
  plan: AddMissingPlan,
  chosen: readonly ChosenLine[],
  anyway: readonly number[],
): AddItem[] | null {
  const addAnyway = new Set(anyway);
  const byLine = new Map<number, AddItem>(plan.items.map((item) => [item.lineNo, item]));
  for (const line of plan.held) if (addAnyway.has(line.lineNo)) byLine.set(line.lineNo, line);
  const asked = new Set<number>();
  for (const line of chosen) {
    const item = byLine.get(line.lineNo);
    if (!item || item.accountId !== line.accountId || asked.has(line.lineNo)) return null;
    asked.add(line.lineNo);
  }
  // In statement order.
  return [...byLine.values()].filter((item) => asked.has(item.lineNo)).sort((a, b) => a.lineNo - b.lineNo);
}

/** When the lines were posted but pairing them afterwards failed: they are in the books, not yet ticked. */
export function addedNotPairedMessage(added: number, uncategorized: number, problem: string): string {
  const them = added === 1 ? "it" : "them";
  const head = `${added} ${added === 1 ? "entry" : "entries"} added from the statement`;
  const holding = uncategorized ? `, ${uncategorized} to Uncategorized` : "";
  return `${head}${holding}, but pairing ${them} with the statement failed (${problem}). Click Match again to tick ${them}.`;
}

/** The message after adding: "3 entries added from the statement and ticked; 1 went to Uncategorized." */
export function addedMessage(added: number, uncategorized: number): string {
  const head = `${added} ${added === 1 ? "entry" : "entries"} added from the statement and ticked`;
  return uncategorized ? `${head}; ${uncategorized} went to Uncategorized.` : `${head}.`;
}
