/**
 * Reconciling a run of statements in one pass — after the client's prototype
 * (Accounting System 2.28, src/p44b.html: batchRead, batchRun, batchTick, and
 * src/p44.html: readStatementText), in integer cents.
 *
 * Pure: the browser reads the files into statements, `checkRun` says which can
 * be reconciled and what stops a run, and `simulateRun` walks the months against
 * the books' open lines without writing anything. Signing is the server's, one
 * month at a time (statement-actions.ts).
 *
 * OneBook departs from the prototype in two places, each marked "OneBook:":
 *   1. a CSV listed newest first is read oldest first before it is cut into
 *      months, so a month never opens or closes on the wrong line of its first
 *      or last day;
 *   2. a month that agrees only on its balance stops the run for a person, where
 *      the prototype ticks every line and signs it.
 */
import { shortDate } from "./pdf-statement-view";
import { statementProof, toStatementLines, type PdfStatement } from "./pdf-statement";
import {
  bringForwardAdvice,
  statementStandings,
  type BringForwardAdvice,
  type BroughtForwardPreview,
  type Standing,
} from "./reconcile-statement";
import type { StatementLine } from "./statement-import";

export type RunSource = "PDF" | "CSV";

/** One statement of a run: a PDF statement, or one month of a CSV. */
export interface RunStatement {
  /** Unique within the run. */
  key: string;
  /** Kept with the reconciliation as its statement's name. */
  fileName: string;
  source: RunSource;
  from: string | null;
  /** The statement date; null when none could be read. */
  to: string | null;
  openingMinor: number | null;
  closingMinor: number | null;
  lines: StatementLine[];
  /** Why this statement cannot prove a month, when it cannot. */
  problem: string | null;
  /** A PDF's own proof: closing less (opening + lines); null when it prints no balances or is a CSV month. */
  outByMinor: number | null;
}

export const RUN_MESSAGES = {
  noClosing: "Cannot prove a month — no closing balance",
  noDate: "No statement date could be found",
  balancesDoNotFollow: "The running balances do not follow the lines",
  notThisAccount: "Not this account",
  noBalanceFormat: "OFX, QFX, QBO and QIF files carry no running balance, so they cannot prove a month",
  noLines: "No dated amounts could be read out of this file",
} as const;

/** The most statement lines one run previews: its request stays well under the server's 1 MB body limit. */
export const MAX_RUN_LINES = 10_000;

const lastDayOf = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * A CSV export cut into calendar months, each closing at the last running
 * balance in it and opening at its first balance less that line's amount
 * (p44.html: readStatementText). Lines of no amount are dropped, as the
 * prototype drops them. Without a running balance a month cannot prove itself.
 */
export function monthsFromCsv(fileName: string, lines: readonly StatementLine[]): RunStatement[] {
  const kept = lines.filter((line) => line.amount_minor !== 0);
  if (!kept.length) return [];
  // OneBook: a file listed newest first is read oldest first. The prototype
  // keeps the file's order within a day, so a newest-first file closes a month
  // on that day's first line and opens it on the first day's last.
  const newestFirst = kept[0].txn_date > kept[kept.length - 1].txn_date;
  const ordered = (newestFirst ? [...kept].reverse() : kept)
    .map((line, order) => ({ line, order }))
    .sort((a, b) => (a.line.txn_date < b.line.txn_date ? -1 : a.line.txn_date > b.line.txn_date ? 1 : a.order - b.order))
    .map(({ line }) => line);

  const months = new Map<string, StatementLine[]>();
  for (const line of ordered) {
    const month = line.txn_date.slice(0, 7);
    const list = months.get(month);
    if (list) list.push(line);
    else months.set(month, [line]);
  }
  const many = months.size > 1;
  return [...months.entries()].map(([month, monthLines]) => {
    const withBalance = monthLines.filter((line) => line.running_balance_minor !== null);
    const last = withBalance[withBalance.length - 1];
    const first = withBalance[0];
    const closingMinor = last ? (last.running_balance_minor as number) : null;
    const openingMinor = first ? (first.running_balance_minor as number) - first.amount_minor : null;
    let problem: string | null = closingMinor === null ? RUN_MESSAGES.noClosing : null;
    if (!problem) {
      for (let i = 1; i < monthLines.length; i++) {
        const before = monthLines[i - 1].running_balance_minor;
        const after = monthLines[i].running_balance_minor;
        if (before !== null && after !== null && after !== before + monthLines[i].amount_minor) {
          problem = RUN_MESSAGES.balancesDoNotFollow;
          break;
        }
      }
    }
    const [year, mm] = month.split("-").map(Number);
    return {
      key: `${fileName}#${month}`,
      fileName: many ? `${fileName} (${month})` : fileName,
      source: "CSV" as const,
      from: `${month}-01`,
      to: `${month}-${String(lastDayOf(year, mm)).padStart(2, "0")}`,
      openingMinor,
      closingMinor,
      lines: monthLines,
      problem,
      outByMinor: null,
    };
  });
}

/**
 * The statements of a PDF that belong to this bank account: those naming an
 * account that ends in its last four digits, or every one when none names an
 * account. A statement naming another account is kept and marked, so the person
 * sees why it is left out.
 */
export function statementsFromPdf(
  fileName: string,
  statements: readonly PdfStatement[],
  maskedNumber: string | null,
): RunStatement[] {
  const last4 = (maskedNumber ?? "").replace(/\D/g, "").slice(-4);
  const named = statements.some((s) => s.accountNumber);
  const many = statements.length > 1;
  return statements.map((s, i) => {
    const ours = !named || last4.length < 4 || (s.accountNumber ?? "").slice(-4) === last4;
    const { differenceMinor } = statementProof(s);
    let problem: string | null = null;
    if (!ours) problem = RUN_MESSAGES.notThisAccount;
    else if (!s.to) problem = RUN_MESSAGES.noDate;
    else if (s.closingMinor === null) problem = RUN_MESSAGES.noClosing;
    const label = s.to ? s.to.slice(0, 7) : s.accountNumber ? s.accountNumber.slice(-4) : String(i + 1);
    return {
      key: `${fileName}#${i}`,
      fileName: many ? `${fileName} (${label})` : fileName,
      source: "PDF" as const,
      from: s.from,
      to: s.to,
      openingMinor: s.openingMinor,
      closingMinor: s.closingMinor,
      lines: toStatementLines(s),
      problem,
      outByMinor: differenceMinor === null || differenceMinor === 0 ? null : differenceMinor,
    };
  });
}

export interface RunContext {
  /** The newest completed reconciliation of the account. */
  lastCompleted: { date: string; endingMinor: number } | null;
  /** Statement dates of the account's completed reconciliations. */
  completedDates: readonly string[];
  inProgress: { id: string; date: string } | null;
  /** The company's today: a statement that runs past it is not over yet. */
  today: string;
}

export type RunState = "usable" | "unreadable" | "notOver" | "duplicate" | "already" | "before";

export interface CheckedStatement {
  statement: RunStatement;
  state: RunState;
  /** What the statements table says about it. */
  note: string;
}

export interface RunCheck {
  /** Every statement, by statement date; those without one last. */
  statements: CheckedStatement[];
  /** The statements a run reconciles, oldest first. */
  usable: RunStatement[];
  /** What stops a run; empty when it can go. */
  stops: string[];
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Which statements a run can reconcile, and what stops it: a gap between two
 * statements (p44b.html: the run is disabled), a first statement that does not
 * open where the last reconciliation closed, or a reconciliation in progress.
 * It also sorts out a month not over yet.
 */
export function checkRun(
  statements: readonly RunStatement[],
  context: RunContext,
  money: (minor: number) => string,
): RunCheck {
  const ordered = [...statements].sort((a, b) => (a.to ?? "9999") < (b.to ?? "9999") ? -1 : (a.to ?? "9999") > (b.to ?? "9999") ? 1 : 0);
  const completed = new Set(context.completedDates);
  const kept = new Set<string>();
  const checked: CheckedStatement[] = ordered.map((statement) => {
    if (statement.problem || !statement.to) return { statement, state: "unreadable", note: statement.problem ?? RUN_MESSAGES.noDate };
    if (statement.to > context.today) return { statement, state: "notOver", note: "Not over yet" };
    if (completed.has(statement.to)) return { statement, state: "already", note: "Already signed off" };
    if (context.lastCompleted && statement.to < context.lastCompleted.date) {
      return { statement, state: "before", note: "Before the last reconciliation" };
    }
    if (kept.has(statement.to)) return { statement, state: "duplicate", note: "Same month as another file" };
    kept.add(statement.to);
    const lines = plural(statement.lines.length, "line");
    const note = statement.outByMinor === null ? lines : `${lines} — does not prove itself, out by ${money(Math.abs(statement.outByMinor))}`;
    return { statement, state: "usable", note };
  });
  const usable = checked.filter((c) => c.state === "usable").map((c) => c.statement);

  const stops: string[] = [];
  if (context.inProgress) {
    stops.push(
      `A reconciliation to ${shortDate(context.inProgress.date, true)} is in progress on this account. Finish it before reconciling more statements.`,
    );
  }
  if (!usable.length) stops.push("Nothing here can be reconciled yet.");
  const lineCount = usable.reduce((n, s) => n + s.lines.length, 0);
  if (lineCount > MAX_RUN_LINES) {
    stops.push(
      `These statements hold ${lineCount.toLocaleString("en-US")} lines, and a run can hold at most ` +
        `${MAX_RUN_LINES.toLocaleString("en-US")}. Choose fewer months.`,
    );
  }
  const first = usable[0];
  if (first && context.lastCompleted && first.openingMinor !== null && first.openingMinor !== context.lastCompleted.endingMinor) {
    stops.push(
      `The statement closing ${shortDate(first.to as string, true)} opens at ${money(first.openingMinor)}, and the last reconciliation, ` +
        `to ${shortDate(context.lastCompleted.date, true)}, closed at ${money(context.lastCompleted.endingMinor)}: a month is missing ` +
        "between them, or that reconciliation closed on another figure.",
    );
  }
  const gaps = usable.filter((s, i) => i > 0 && s.openingMinor !== null && s.openingMinor !== usable[i - 1].closingMinor);
  if (gaps.length) {
    stops.push(
      `There is a gap in the run. The statement closing ${gaps.map((s) => shortDate(s.to as string, true)).join(", ")} ` +
        "does not open at the one before it, so a month is missing from what you have chosen. Reconciling across a gap " +
        "would sign off items nobody has seen a statement for.",
    );
  }
  return { statements: checked, usable, stops };
}

/**
 * Why the server will not start a month of a run, or null. A month not over
 * yet cannot be proven; a month at or before the account's last completed
 * reconciliation is signed already — by this run in another tab, or by a
 * second click.
 */
export function monthRefusal(statementDate: string, today: string, lastCompletedDate: string | null): string | null {
  if (statementDate > today) return `The month to ${shortDate(statementDate, true)} is not over yet.`;
  if (lastCompletedDate && statementDate <= lastCompletedDate) {
    return `This account is already reconciled to ${shortDate(lastCompletedDate, true)}, so the month to ${shortDate(statementDate, true)} is not signed off again.`;
  }
  return null;
}

/** A book line not yet in a completed reconciliation, in book order (date, entry, line). */
export interface OpenBookLine {
  id: string;
  date: string;
  amountMinor: number;
  reference: string | null;
  entryNumber: string | null;
}

export type MonthOutcome =
  | { kind: "agrees"; paired: number; of: number; outstanding: number }
  | { kind: "balanceOnly"; unpaired: number; of: number }
  | { kind: "outBy"; differenceMinor: number; missing: number }
  | { kind: "waiting" };

export interface RunMonth {
  key: string;
  statementDate: string;
  beginningMinor: number;
  closingMinor: number;
  outcome: MonthOutcome;
  /** How each statement line stands with the books (1.79's standings); empty for a waiting month. */
  standings: Standing[];
}

export interface RunPreview {
  /** 1.79's bring-forward advice, when the account has no reconciliation. */
  broughtForward: BringForwardAdvice | null;
  months: RunMonth[];
  /** The agreeing months from the oldest, signed by one click. */
  toSign: number;
}

export interface RunStart {
  /** The newest completed reconciliation's ending balance; null when the account has none. */
  beginningMinor: number | null;
  /** 1.79's preview for the day before the first statement's period; null when the account has a reconciliation. */
  broughtForward: BroughtForwardPreview | null;
}

/**
 * The run walked month by month against the books, writing nothing
 * (p44b.html: batchRun, batchTick). Each month begins where the one before it
 * closed; its lines are paired with the book lines still open to its statement
 * date; the lines it pairs are not offered to a later month. The first month
 * that does not agree line for line stops the walk.
 */
export function simulateRun(
  usable: readonly RunStatement[],
  openLines: readonly OpenBookLine[],
  start: RunStart,
  money: (minor: number) => string,
): RunPreview {
  let open = [...openLines];
  let beginning = start.beginningMinor ?? 0;
  let broughtForward: BringForwardAdvice | null = null;
  const first = usable[0];
  if (start.broughtForward && first) {
    broughtForward = bringForwardAdvice(start.broughtForward, { from: first.from, openingMinor: first.openingMinor }, money);
    if (broughtForward?.canBringForward && first.openingMinor !== null) {
      const through = broughtForward.through;
      open = open.filter((line) => line.date > through);
      beginning = first.openingMinor;
    }
  }

  const months: RunMonth[] = [];
  let stopped = false;
  let toSign = 0;
  for (const statement of usable) {
    const to = statement.to as string;
    const closing = statement.closingMinor as number;
    if (stopped) {
      months.push({ key: statement.key, statementDate: to, beginningMinor: beginning, closingMinor: closing, outcome: { kind: "waiting" }, standings: [] });
      continue;
    }
    const monthBeginning = beginning;
    const available = open.filter((line) => line.date <= to);
    const result = statementStandings(
      statement.lines.map((line, lineNo) => ({ lineNo, date: line.txn_date, amountMinor: line.amount_minor, reference: line.reference })),
      available.map((line) => ({ ...line, cleared: false })),
      to,
    );
    const pairedIds = new Set(result.standings.flatMap((s) => (s.kind === "paired" ? [s.bookId] : [])));
    const pairedMinor = available.reduce((sum, line) => (pairedIds.has(line.id) ? sum + line.amountMinor : sum), 0);
    const differenceMinor = closing - (monthBeginning + pairedMinor);
    const of = statement.lines.length - result.after;
    let outcome: MonthOutcome;
    if (differenceMinor === 0) {
      outcome = { kind: "agrees", paired: result.paired, of, outstanding: result.outstanding.length };
      open = open.filter((line) => !pairedIds.has(line.id));
      beginning = closing;
      toSign += 1;
    } else if (monthBeginning + available.reduce((sum, line) => sum + line.amountMinor, 0) === closing) {
      // OneBook: the prototype ticks every open line here and signs the month.
      outcome = { kind: "balanceOnly", unpaired: result.missing, of };
      stopped = true;
    } else {
      outcome = { kind: "outBy", differenceMinor, missing: result.missing };
      stopped = true;
    }
    months.push({ key: statement.key, statementDate: to, beginningMinor: monthBeginning, closingMinor: closing, outcome, standings: result.standings });
  }
  return { broughtForward, months, toSign };
}

/** What a month's row says in the preview. */
export function monthSentence(outcome: MonthOutcome, money: (minor: number) => string): string {
  switch (outcome.kind) {
    case "agrees":
      return `Agrees — ${outcome.paired} of ${plural(outcome.of, "line")} paired${outcome.outstanding ? `, ${outcome.outstanding} outstanding` : ""}`;
    case "balanceOnly":
      return `Agrees on the balance only — needs a look: ${plural(outcome.unpaired, "line")} did not pair`;
    case "outBy":
      return `Out by ${money(Math.abs(outcome.differenceMinor))}${outcome.missing ? ` — the bank shows ${plural(outcome.missing, "thing")} the books do not` : ""}`;
    case "waiting":
      return "Waiting";
  }
}
