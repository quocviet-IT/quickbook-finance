/**
 * A statement's lines that Bank Transactions already holds under ANOTHER bank
 * account (3.0.22).
 *
 * Every duplicate rule before this one looked inside the bank account being
 * imported into: a line's own key, and a line from another source on the same
 * day for the same amount (statement-repeats.ts). So a company that added a
 * second bank account for the same real account, and chose the same statement
 * file again, was given every line a second time — nothing in that account
 * said they were there — and coding them put the same money in the books twice,
 * on a second ledger account.
 *
 * The rule here reads across the company's other bank accounts:
 *   - a line is the same line when the other account holds one on the same day,
 *     for the same amount, with the same words (case and spacing aside). The
 *     words are compared here, unlike inside one account: two accounts at one
 *     bank really do both pay "Monthly Service Fee" on one day;
 *   - counted one for one, as every rule about repeats is;
 *   - one chance match is left alone. Two or more lines one other account
 *     holds, or the statement's only line, are marked: skipped unless ticked
 *     back;
 *   - a statement of two or more lines that one other account holds every line
 *     of is that account's statement, and is refused whole;
 *   - the same statement read from another kind of file carries other words (a
 *     PDF's description is not its CSV's). So a statement of three or more
 *     lines is also that account's when, over the statement's days, the account
 *     holds exactly its lines by day and amount: every one of them, and no
 *     other. "No other" is what tells it from an account that only moves the
 *     same money: a checking account swept into savings each day holds every
 *     deposit the savings statement shows, and the sweeps out beside them.
 *     Short of that, day and amount prove nothing across two accounts, and
 *     nothing is marked on them.
 *
 * Pure, and free of node:crypto, so the import dialog uses it in the browser
 * and the server runs the same rule again on what was sent.
 */
import { plural, pluralWord } from "@/lib/format";
import type { RepeatLine } from "./statement-repeats";

/** A bank line of another bank account of this company, on the file's days. */
export interface ElsewhereBankLine {
  id: string;
  bankAccountId: string;
  txnDate: string;
  amountMinor: number;
  description: string | null;
}

/** A line of the file another bank account already holds: skipped unless ticked back. */
export interface OtherAccountLine {
  /** Its index in the lines read. */
  index: number;
  /** The bank account that holds it. */
  bankAccountId: string;
  /** The bank line it stands for. */
  bankLineId: string;
}

export interface OtherAccountsCheck {
  /** The lines another bank account already holds, in file order. */
  lines: OtherAccountLine[];
  /** The bank account that holds every line of a statement of two or more lines; null otherwise. */
  whole: string | null;
}

export const NO_OTHER_ACCOUNTS: OtherAccountsCheck = { lines: [], whole: null };

type FileLine = Pick<RepeatLine, "txn_date" | "amount_minor" | "description">;

const words = (text: string | null | undefined) => (text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const lineKey = (date: string, amountMinor: number, description: string | null | undefined) => `${date}|${amountMinor}|${words(description)}`;
const dayAndAmount = (date: string, amountMinor: number) => `${date}|${amountMinor}`;

/** The fewest lines a statement must have before day and amount alone can make it another account's. */
export const WHOLE_BY_AMOUNT_MIN_LINES = 3;

/**
 * The file's lines one account holds, one of its lines for one of the file's:
 * the index of each line found, and the bank line that stands for it.
 */
function heldBy<T>(
  considered: readonly number[],
  lines: readonly FileLine[],
  heldLines: readonly ElsewhereBankLine[],
  keyOfLine: (line: FileLine) => T,
  keyOfHeld: (held: ElsewhereBankLine) => T,
): Map<number, string> {
  const free = new Map<T, string[]>();
  for (const held of heldLines) {
    const key = keyOfHeld(held);
    const ids = free.get(key);
    if (ids) ids.push(held.id);
    else free.set(key, [held.id]);
  }
  const found = new Map<number, string>();
  for (const index of considered) {
    const id = free.get(keyOfLine(lines[index]))?.shift();
    if (id) found.set(index, id);
  }
  return found;
}

/**
 * Which of a statement's lines another bank account already holds. `aside` is
 * the indexes ticked Not a transaction: they are not sent, so they are neither
 * marked nor counted in the whole. `elsewhere` is the other accounts' bank
 * lines over the file's days: every one of them, for the rule that reads a
 * whole statement by day and amount counts them.
 */
export function otherAccountLines(
  lines: readonly FileLine[],
  aside: Iterable<number>,
  elsewhere: readonly ElsewhereBankLine[],
): OtherAccountsCheck {
  if (!elsewhere.length) return NO_OTHER_ACCOUNTS;
  const setAside = new Set(aside);
  const considered = lines.map((_, index) => index).filter((index) => !setAside.has(index));
  if (!considered.length) return NO_OTHER_ACCOUNTS;

  const byAccount = new Map<string, ElsewhereBankLine[]>();
  for (const held of elsewhere) {
    const list = byAccount.get(held.bankAccountId);
    if (list) list.push(held);
    else byAccount.set(held.bankAccountId, [held]);
  }

  // Each account on its own: one of its lines accounts for one line of the file.
  const matches: { bankAccountId: string; found: Map<number, string> }[] = [];
  for (const [bankAccountId, heldLines] of byAccount) {
    // The whole statement by day and amount, and nothing else in those days:
    // the same statement, read from another kind of file.
    if (considered.length >= WHOLE_BY_AMOUNT_MIN_LINES && heldLines.length === considered.length) {
      const byAmount = heldBy(
        considered,
        lines,
        heldLines,
        (line) => dayAndAmount(line.txn_date, line.amount_minor),
        (held) => dayAndAmount(held.txnDate, held.amountMinor),
      );
      if (byAmount.size === considered.length) {
        matches.push({ bankAccountId, found: byAmount });
        continue;
      }
    }
    const found = heldBy(
      considered,
      lines,
      heldLines,
      (line) => lineKey(line.txn_date, line.amount_minor, line.description),
      (held) => lineKey(held.txnDate, held.amountMinor, held.description),
    );
    // One chance match says nothing; the statement's only line does.
    if (found.size >= 2 || (found.size === 1 && considered.length === 1)) matches.push({ bankAccountId, found });
  }
  if (!matches.length) return NO_OTHER_ACCOUNTS;

  // A line two accounts hold belongs with the account holding more of the statement.
  matches.sort((a, b) => b.found.size - a.found.size || (a.bankAccountId < b.bankAccountId ? -1 : 1));
  const taken = new Map<number, OtherAccountLine>();
  for (const { bankAccountId, found } of matches) {
    for (const [index, bankLineId] of found) {
      if (!taken.has(index)) taken.set(index, { index, bankAccountId, bankLineId });
    }
  }
  const whole =
    considered.length >= 2 ? (matches.find((m) => m.found.size === considered.length)?.bankAccountId ?? null) : null;
  return { lines: [...taken.values()].sort((a, b) => a.index - b.index), whole };
}

// --- Saying it -----------------------------------------------------------------

/**
 * Edit account, on Bank Transactions: the way to correct a bank account's name
 * or number, named here once so the sentences that send someone to it and the
 * button itself cannot drift apart.
 */
export const EDIT_BANK_ACCOUNT = {
  button: "Edit account",
  title: "Edit bank account",
  needsOne: "Choose a single account to edit",
  nameLabel: "Bank name",
  nameRequired: "Enter the bank account's name",
  numberLabel: "Account number (masked)",
  saved: "Bank account updated",
  failed: "The bank account could not be updated",
  /** Under the form: what is not offered, and why. */
  ledgerNote: (ledgerAccount: string) =>
    `Posted to ${ledgerAccount}. The ledger account and the currency are not changed here: lines are already posted to them.`,
} as const;

const UNNAMED = "another bank account";

/** "8 of 30 lines are already in Bank Transactions under First Checking · 1015" */
export function otherAccountTitle(count: number, total: number, label: string | undefined): string {
  return `${count.toLocaleString("en-US")} of ${plural(total, "line")} ${pluralWord(count, "is", "are")} already in Bank Transactions under ${label || UNNAMED}`;
}

/** Said under the warning: those lines are skipped by default, and each can be ticked back. */
export const OTHER_ACCOUNT_NOTE =
  "A statement belongs to one bank account, so these lines are skipped: importing them here as well would put the same money in the books twice. Tick one to import it as well.";

/** Why a statement another bank account holds every line of is not imported again. */
export function wholeStatementElsewhere(label: string | undefined, here: string | undefined): string {
  return (
    `Every line of this statement is already in Bank Transactions under ${label || UNNAMED}, so it is not imported into ${here || "this bank account"} as well: ` +
    `the same money would be in the books twice. To correct a bank account's name or number, use ${EDIT_BANK_ACCOUNT.button} on Bank Transactions.`
  );
}

/** The lines one other bank account holds, as the dialog lists them. */
export interface OtherAccountGroup {
  bankAccountId: string;
  label: string;
  /** Their indexes in the lines read, in file order. */
  indexes: number[];
  title: string;
}

/**
 * The marked lines by the account that holds them, the account holding most
 * first. `total` is how many lines the statement sends (those ticked Not a
 * transaction left out).
 */
export function otherAccountGroups(
  check: OtherAccountsCheck,
  labels: Readonly<Record<string, string>>,
  total: number,
): OtherAccountGroup[] {
  const groups = new Map<string, number[]>();
  for (const line of check.lines) {
    const list = groups.get(line.bankAccountId);
    if (list) list.push(line.index);
    else groups.set(line.bankAccountId, [line.index]);
  }
  return [...groups]
    .sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1))
    .map(([bankAccountId, indexes]) => ({
      bankAccountId,
      label: labels[bankAccountId] || UNNAMED,
      indexes,
      title: otherAccountTitle(indexes.length, total, labels[bankAccountId]),
    }));
}

// --- Two bank accounts with one number ---------------------------------------

const digits = (text: string | null | undefined) => (text ?? "").replace(/\D/g, "");

/** Whether two account numbers, as typed, are the same digits. A number with no digits matches nothing. */
export function sameAccountNumber(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = digits(a);
  return left !== "" && left === digits(b);
}

/** Why a second bank account with a number already in use is not added. */
export function sameNumberRefusal(label: string, number: string): string {
  return (
    `${label} already has the account number ending ${digits(number).slice(-4)}. If this is that account, use ${EDIT_BANK_ACCOUNT.button} to correct its name instead of adding it again. ` +
    "If it is a different account, enter more digits of its number so the two can be told apart."
  );
}
