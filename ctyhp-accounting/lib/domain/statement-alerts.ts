/**
 * Two warnings about a bank account, from the client's prototype (`ghostGroups`
 * and `negativeWatch`, p45):
 *
 *  1. A run of entries that look like a statement's *Balance* column read as
 *     amounts. Real payments do not track the balance of the account they are
 *     paid from, so a run that lands on it, date after date, is not payments.
 *  2. A bank account that reads below zero since the last statement somebody
 *     agreed. Once a statement is agreed the balance was right on that day; what
 *     drags it under afterwards is far more often an entry that is not a payment
 *     than a real overdraft, which the bank would have printed.
 *
 * Both are pure functions over one bank account's posted lines. This module
 * reads nothing and writes nothing; it imports no service and no database
 * type, and the Exceptions report (`lib/domain/exceptions.ts`) builds on it.
 *
 * Money is integer minor units in the base currency. Every comparison below is
 * exact: an offset is "the same" only when it is the same number of minor
 * units, which is what the prototype's round-to-the-cent comes to.
 */

import { formatDate, plural, pluralWord } from "@/lib/format";

/** The fewest lines a payee needs before it can be a balance (prototype `GHOST_MIN`). */
export const GHOST_MIN = 3;
/** The share of a payee's lines that must agree (prototype `GHOST_SHARE`). */
export const GHOST_SHARE = 0.6;
/** The most outstanding payments the below-zero warning lists. */
export const OUTSTANDING_SHOWN = 6;
/** What a payee with no name is called, as in the prototype. */
export const NO_NAME = "(no name)";

/* ---------------------------------------------------------------- inputs */

/** One posted line on a bank account's ledger account. */
export interface BankLine {
  lineId: string;
  entryId: string;
  entryNumber: string;
  /** `YYYY-MM-DD`. */
  date: string;
  /** Debit minus credit, base currency minor units: money in is positive. */
  amountMinor: number;
  /** The entry's name: party, else description, else entry number. */
  payee: string;
  narration: string;
  /** The entry's other accounts, as labels ("1200 Accounts Receivable"). */
  codedTo: string[];
  sourceType: string;
  /** Ticked in a completed reconciliation. */
  cleared: boolean;
}

/** The latest completed reconciliation of the account, by statement ending date. */
export interface LastStatement {
  date: string;
  endingMinor: number;
}

/** An entry and the entry that reversed it (`acc_journal_reversal_link`). */
export interface ReversalPair {
  originalEntryId: string;
  reversalEntryId: string;
}

/**
 * The lines the detectors look at: the account's posted lines, less every
 * entry that has been reversed together with its reversal.
 *
 * OneBook removes an entry by reversing it, where the prototype deleted it, so
 * a group removed from the Reconcile screen stays in the ledger as pairs that
 * cancel. Counted, the originals would read as payments no statement has
 * shown, and they would dilute the next group of the same name: a series
 * removed once and imported again would agree on 5 lines of 10, under
 * GHOST_SHARE, and go unflagged.
 *
 * A pair is dropped only when both halves are among these lines. A reversal
 * swaps every line of its original, so the two cancel on this account and
 * today's balance is the same without them. An original whose reversal is not
 * here (voided since, say) still stands, and so does its line.
 */
export function withoutReversedPairs(lines: readonly BankLine[], pairs: readonly ReversalPair[]): BankLine[] {
  const present = new Set(lines.map((l) => l.entryId));
  const dropped = new Set<string>();
  for (const p of pairs) {
    if (present.has(p.originalEntryId) && present.has(p.reversalEntryId)) {
      dropped.add(p.originalEntryId);
      dropped.add(p.reversalEntryId);
    }
  }
  return lines.filter((l) => !dropped.has(l.entryId));
}

/* --------------------------------------------------------------- ordering */

const byPosting = (a: BankLine, b: BankLine): number =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : a.entryNumber < b.entryNumber ? -1 : a.entryNumber > b.entryNumber ? 1 : a.lineId < b.lineId ? -1 : a.lineId > b.lineId ? 1 : 0;

/** The end-of-day balances of lines already in posting order. */
function dayEnds(sorted: readonly BankLine[]): { date: string; balanceMinor: number }[] {
  const days: { date: string; balanceMinor: number }[] = [];
  let running = 0;
  for (const line of sorted) {
    running += line.amountMinor;
    const last = days[days.length - 1];
    if (last && last.date === line.date) last.balanceMinor = running;
    else days.push({ date: line.date, balanceMinor: running });
  }
  return days;
}

/** The balance after the last day-end dated on or before `date`; zero before the first. */
function balanceOn(days: readonly { date: string; balanceMinor: number }[], date: string): number {
  let lo = 0;
  let hi = days.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (days[mid].date <= date) lo = mid + 1;
    else hi = mid;
  }
  return lo === 0 ? 0 : days[lo - 1].balanceMinor;
}

/* ------------------------------------------------- a balance read as payments */

export interface GhostRow {
  lineId: string;
  entryId: string;
  entryNumber: string;
  date: string;
  /** The line as posted, signed. */
  amountMinor: number;
  /** What the account comes to at the end of that date with the whole group taken out. */
  balanceMinor: number;
  /** |amount| minus that balance. Zero means it lands exactly on the balance. */
  differenceMinor: number;
  codedTo: string[];
  sourceType: string;
}

export interface GhostGroup {
  /** The name as written on the first line of the group, trimmed. */
  payee: string;
  /** The agreeing lines only, in posting order. */
  rows: GhostRow[];
  /** How many lines agree, and how many lines the payee has on the account. */
  agree: number;
  of: number;
  /** The most frequent good offset, minor units (zero: lands exactly). */
  offsetMinor: number;
  /** How many different good offsets there are: a file read wrongly twice leaves two. */
  runs: number;
  /** The agreeing lines' signed total. */
  totalMinor: number;
  /** The distinct entries behind the agreeing lines, in posting order. */
  entryIds: string[];
}

/** The key payees are grouped by: trimmed, lower-case, an empty name as "(no name)". */
export function payeeKeyOf(name: string): string {
  const key = name.trim().toLowerCase();
  return key === "" ? NO_NAME : key;
}

const payeeKey = (line: BankLine): string => payeeKeyOf(line.payee);

/**
 * Groups of entries for one payee that land on what the account comes to.
 *
 * For each payee with at least `GHOST_MIN` lines the rest of the account is
 * walked on its own, and each line of the payee is compared with the rest's
 * balance at the end of its date — "once the group itself is taken out", so
 * the test is not an argument with itself.
 *
 * The test is per offset, not one offset for the whole group: a file read
 * wrongly twice leaves two runs, each a fixed distance from the clean balance.
 * An offset seen on three or more lines is good; so is an offset of zero seen
 * at all, because a line that lands exactly on the balance needs no
 * corroboration.
 *
 * An account whose every entry is one payee proves nothing: with the rest
 * empty (or barely there) the "balance" is zero or a few figures, and it is the
 * group that is moving it. The rest must hold at least three lines, and the
 * agreeing lines must show three different balances and three different
 * amounts, because a running balance moves and so do the figures that track it.
 *
 * Largest group first.
 */
export function ghostGroups(lines: readonly BankLine[]): GhostGroup[] {
  if (lines.length < 4) return [];
  const all = [...lines].sort(byPosting);

  const byPayee = new Map<string, BankLine[]>();
  for (const line of all) {
    const key = payeeKey(line);
    const bucket = byPayee.get(key);
    if (bucket) bucket.push(line);
    else byPayee.set(key, [line]);
  }

  const flagged: GhostGroup[] = [];
  for (const group of byPayee.values()) {
    if (group.length < GHOST_MIN) continue;
    const inGroup = new Set(group.map((l) => l.lineId));
    const rest = all.filter((l) => !inGroup.has(l.lineId));
    if (rest.length < GHOST_MIN) continue;
    const days = dayEnds(rest);

    const measured = group.map((line) => {
      const balanceMinor = balanceOn(days, line.date);
      return { line, balanceMinor, differenceMinor: Math.abs(line.amountMinor) - balanceMinor };
    });

    const seen = new Map<number, number>();
    for (const m of measured) seen.set(m.differenceMinor, (seen.get(m.differenceMinor) ?? 0) + 1);
    const good = new Map<number, number>();
    for (const [offset, count] of seen) if (count >= 3 || offset === 0) good.set(offset, count);

    const agreeing = measured.filter((m) => good.has(m.differenceMinor));
    if (agreeing.length < GHOST_MIN || agreeing.length / group.length < GHOST_SHARE) continue;
    if (new Set(agreeing.map((m) => m.balanceMinor)).size < 3) continue;
    if (new Set(agreeing.map((m) => Math.abs(m.line.amountMinor))).size < 3) continue;

    // The most frequent good offset; a tie goes to the one nearer zero, then the smaller.
    const best = [...good.entries()].sort(
      (x, y) => y[1] - x[1] || Math.abs(x[0]) - Math.abs(y[0]) || x[0] - y[0],
    )[0][0];

    flagged.push({
      payee: group[0].payee.trim() === "" ? NO_NAME : group[0].payee.trim(),
      rows: agreeing.map((m) => ({
        lineId: m.line.lineId,
        entryId: m.line.entryId,
        entryNumber: m.line.entryNumber,
        date: m.line.date,
        amountMinor: m.line.amountMinor,
        balanceMinor: m.balanceMinor,
        differenceMinor: m.differenceMinor,
        codedTo: m.line.codedTo,
        sourceType: m.line.sourceType,
      })),
      agree: agreeing.length,
      of: group.length,
      offsetMinor: best,
      runs: good.size,
      totalMinor: agreeing.reduce((sum, m) => sum + m.line.amountMinor, 0),
      entryIds: [...new Set(agreeing.map((m) => m.line.entryId))],
    });
  }
  return flagged.sort((x, y) => y.agree - x.agree || x.payee.localeCompare(y.payee));
}

/* ------------------------------------------------ below zero since a statement */

export interface OutstandingPayment {
  lineId: string;
  entryId: string;
  entryNumber: string;
  date: string;
  name: string;
  /** Negative: money out. */
  amountMinor: number;
  codedTo: string[];
}

export interface NegativeWatch {
  /** The balance at the end of the last day with a posting. */
  nowMinor: number;
  /** The latest agreed statement, or null when nothing has been reconciled. */
  last: LastStatement | null;
  /** The lowest day-end balance after the last statement; null when only today is negative. */
  worst: { date: string; balanceMinor: number } | null;
  /** The largest payments after the last statement that no statement holds, largest first. */
  outstanding: OutstandingPayment[];
  /** How many such payments there are in all, not only those listed. */
  outstandingCount: number;
}

/**
 * Whether the account reads below zero, now or since its last agreed statement.
 *
 * The prototype tests `< -0.004` in dollars. In whole minor units that is any
 * balance below zero: the smallest negative balance, one cent, is already past
 * −0.4 cents, and zero is not. So the test here is simply `< 0`.
 *
 * A dip counts only after an agreed statement. An account nobody has
 * reconciled has no proved balance to measure from, so a dip in its past is
 * history; it is flagged only while it is negative now.
 */
export function negativeWatch(
  lines: readonly BankLine[],
  lastCompleted: LastStatement | null,
): NegativeWatch | null {
  if (lines.length === 0) return null;
  const sorted = [...lines].sort(byPosting);
  const days = dayEnds(sorted);
  const nowMinor = days[days.length - 1].balanceMinor;

  const from = lastCompleted?.date ?? "";
  const under = lastCompleted ? days.filter((d) => d.balanceMinor < 0 && d.date > from) : [];
  if (nowMinor >= 0 && under.length === 0) return null;

  let worst: NegativeWatch["worst"] = null;
  for (const d of under) if (worst === null || d.balanceMinor < worst.balanceMinor) worst = { ...d };

  const open = sorted
    .filter((l) => l.date > from && !l.cleared && l.amountMinor < 0)
    .sort((x, y) => x.amountMinor - y.amountMinor || byPosting(x, y));

  return {
    nowMinor,
    last: lastCompleted,
    worst,
    outstanding: open.slice(0, OUTSTANDING_SHOWN).map((l) => ({
      lineId: l.lineId,
      entryId: l.entryId,
      entryNumber: l.entryNumber,
      date: l.date,
      name: l.payee,
      amountMinor: l.amountMinor,
      codedTo: l.codedTo,
    })),
    outstandingCount: open.length,
  };
}

/** Both detectors over one account. */
export interface StatementAlerts {
  ghosts: GhostGroup[];
  negative: NegativeWatch | null;
}

export function statementAlerts(lines: readonly BankLine[], lastCompleted: LastStatement | null): StatementAlerts {
  return { ghosts: ghostGroups(lines), negative: negativeWatch(lines, lastCompleted) };
}

/* ------------------------------------------------------------------- copy */

/** A run of words in a sentence, so a screen can set the payee and figures in bold without parsing text. */
export interface Segment {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

/** How money and dates are written: the screen passes its own formatter, this module has no currency. */
export interface CopyFormat {
  money: (minor: number) => string;
  /** Defaults to `09/26/2026`. */
  date?: (iso: string) => string;
}

const dateOf = (fmt: CopyFormat) => fmt.date ?? formatDate;

/** The plain text of a sentence. */
export function segmentsText(segments: readonly Segment[]): string {
  return segments.map((s) => s.text).join("");
}

const plain = (text: string): Segment => ({ text });
const bold = (text: string): Segment => ({ text, bold: true });

export interface GhostCard {
  title: string;
  body: Segment[];
  showWorkings: string;
  hideWorkings: string;
  /** "Remove these N entries". */
  removeLabel: string;
  /** What the button says after the first click. */
  confirmLabel: string;
  workingsColumns: readonly ["Date", "Posted as", "This account on that date", "Difference", "Coded to"];
  workingsFootnote: string;
  /** The toast after a removal. */
  removedMessage: (n: number) => string;
  /** What the action says when the payee is no longer flagged. */
  goneMessage: string;
  /** "—" under half a cent; otherwise the money. */
  difference: (minor: number) => string;
}

export const GHOST_GONE = "Those entries are no longer here.";

/** The number of entries a flagged group would remove. */
export const ghostEntryCount = (group: Pick<GhostGroup, "entryIds">): number => group.entryIds.length;

export function ghostCard(group: GhostGroup, fmt: CopyFormat): GhostCard {
  const n = ghostEntryCount(group);
  const ending =
    group.runs > 1
      ? ", each run of them a fixed distance from it"
      : group.offsetMinor !== 0
        ? `, give or take ${fmt.money(Math.abs(group.offsetMinor))} that is outstanding for other reasons`
        : "";
  return {
    title: `${plural(n, "entry", "entries")} here ${pluralWord(n, "looks", "look")} like the statement's balance, not payments`,
    body: [
      plain("Every one of them is named "),
      bold(group.payee),
      plain(
        `, and ${group.agree} of the ${group.of} land exactly on what this account comes to on their own date once the group itself is taken out${ending}. A payment does not track the balance of the account it is paid from. These are almost certainly a `,
      ),
      { text: "Balance", italic: true },
      plain(` column read as amounts, and together they move ${fmt.money(group.totalMinor)}.`),
    ],
    showWorkings: "Show me the workings",
    hideWorkings: "Hide the workings",
    removeLabel: `Remove these ${plural(n, "entry", "entries")}`,
    confirmLabel: `Confirm — remove all ${n}`,
    workingsColumns: ["Date", "Posted as", "This account on that date", "Difference", "Coded to"],
    workingsFootnote: "The middle column is worked out with these entries removed, so it is not an argument with itself.",
    removedMessage: (count) => `${plural(count, "entry", "entries")} removed. They were balances, not payments.`,
    goneMessage: GHOST_GONE,
    difference: (minor) => (minor === 0 ? "—" : fmt.money(minor)),
  };
}

export interface NegativeCard {
  title: string;
  body: Segment[];
  /** Null when nothing is outstanding. */
  listHeading: string | null;
  listColumns: readonly ["Date", "Name", "Amount", "Coded to"];
  footer: string;
}

export function negativeCard(accountName: string, watch: NegativeWatch, fmt: CopyFormat): NegativeCard {
  const date = dateOf(fmt);
  const body: Segment[] = [];
  if (watch.last) {
    body.push(
      plain("The last statement you agreed on this account closed at "),
      bold(fmt.money(watch.last.endingMinor)),
      plain(` on ${date(watch.last.date)}, so the balance was right on the day it was proved. `),
    );
  } else {
    body.push(plain("Nothing has been reconciled on this account yet, so there is no agreed figure to measure from. "));
  }
  if (watch.worst) {
    body.push(
      plain("Since then it drops to "),
      bold(fmt.money(watch.worst.balanceMinor)),
      plain(` on ${date(watch.worst.date)}. `),
    );
  }
  body.push(
    plain(
      `It reads ${fmt.money(watch.nowMinor)} today. A bank would have charged you for an overdraft and shown it on the statement; where it has not, what is dragging it under is usually an entry that is not a payment — a balance posted as one, or the same thing entered twice.`,
    ),
  );
  return {
    title: `${accountName} reads below zero${watch.nowMinor < 0 ? ", and still does today" : " at some point since the last statement"}`,
    body,
    listHeading:
      watch.outstanding.length > 0
        ? `The largest ${watch.outstanding.length} of the ${watch.outstandingCount} payments not yet on a statement:`
        : null,
    listColumns: ["Date", "Name", "Amount", "Coded to"],
    footer: "Reconcile the next statement and whatever the bank has never seen is left standing on its own.",
  };
}

/* ------------------------------------------------------------ balance sheet */

/** A bank account the Balance Sheet found below zero at its end date. */
export interface BelowZeroAccount {
  bankAccountId: string;
  accountName: string;
  /** Entries in this account's flagged groups; zero when none is flagged. */
  ghostEntries: number;
}

/** The address of the Reconcile start screen for one bank account. */
export function reconcileHref(bankAccountId: string): string {
  return `/banking/reconcile?account=${encodeURIComponent(bankAccountId)}`;
}

/* -------------------------------------------------------------- exceptions */

/** One bank account's findings, as the Exceptions report reads them. */
export interface BankAccountAlerts {
  bankAccountId: string;
  accountName: string;
  ghosts: GhostGroup[];
  negative: NegativeWatch | null;
}

export interface StatementBalanceRow {
  bankAccountId: string;
  accountName: string;
  payee: string;
  entryCount: number;
  totalMinor: number;
}

export interface BelowZeroRow {
  bankAccountId: string;
  accountName: string;
  nowMinor: number;
  worstMinor: number | null;
  worstDate: string | null;
  /** The last agreed statement's date; null for never. */
  lastStatementDate: string | null;
  outstandingCount: number;
}

/** One row per flagged group, largest total first. */
export function statementBalanceRows(accounts: readonly BankAccountAlerts[]): StatementBalanceRow[] {
  return accounts
    .flatMap((a) =>
      a.ghosts.map((g) => ({
        bankAccountId: a.bankAccountId,
        accountName: a.accountName,
        payee: g.payee,
        entryCount: g.entryIds.length,
        totalMinor: g.totalMinor,
      })),
    )
    .sort(
      (x, y) =>
        Math.abs(y.totalMinor) - Math.abs(x.totalMinor) ||
        x.accountName.localeCompare(y.accountName) ||
        x.payee.localeCompare(y.payee),
    );
}

/** One row per flagged account, lowest balance first. */
export function belowZeroRows(accounts: readonly BankAccountAlerts[]): BelowZeroRow[] {
  const rows: BelowZeroRow[] = [];
  for (const a of accounts) {
    if (!a.negative) continue;
    rows.push({
      bankAccountId: a.bankAccountId,
      accountName: a.accountName,
      nowMinor: a.negative.nowMinor,
      worstMinor: a.negative.worst?.balanceMinor ?? null,
      worstDate: a.negative.worst?.date ?? null,
      lastStatementDate: a.negative.last?.date ?? null,
      outstandingCount: a.negative.outstandingCount,
    });
  }
  return rows.sort(
    (x, y) => Math.min(x.nowMinor, x.worstMinor ?? 0) - Math.min(y.nowMinor, y.worstMinor ?? 0) || x.accountName.localeCompare(y.accountName),
  );
}

/** The words of a Statement-balance row in the Exceptions sheet. */
export const statementBalanceSheetText = (row: StatementBalanceRow) => ({
  type: plural(row.entryCount, "entry", "entries"),
  name: row.payee,
});

/** The words of a below-zero row in the Exceptions sheet; `money` writes a plain number. */
export function belowZeroSheetText(row: BelowZeroRow, money: (minor: number) => string) {
  const lowest = row.worstMinor !== null ? `Lowest ${money(row.worstMinor)} · ` : "";
  return {
    type: `Last reconciled ${row.lastStatementDate ?? "never"}`,
    name: `${lowest}${plural(row.outstandingCount, "payment")} not yet on a statement`,
  };
}
