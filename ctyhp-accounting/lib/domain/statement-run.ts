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
 * OneBook departs from the prototype in three places, each marked "OneBook:":
 *   1. a CSV listed newest first is read oldest first before it is cut into
 *      months, so a month never opens or closes on the wrong line of its first
 *      or last day;
 *   2. a month that agrees only on its balance stops the run for a person, where
 *      the prototype ticks every line and signs it;
 *   3. a CSV month whose first or last rows carry no balance opens and closes
 *      with those rows counted, not out by them.
 */
import { formatDate, plural } from "@/lib/format";
import { statementProof, toStatementLines, type PdfStatement } from "./pdf-statement";
import { MAX_RUN_LINES } from "./statement-run-limits";
import {
  bringForwardAdvice,
  statementStandings,
  type BringForwardAdvice,
  type BroughtForwardPreview,
  type Standing,
} from "./reconcile-statement";
import type { StatementLine } from "./statement-import";
import {
  pdfFigures,
  proveStatement,
  type ClosingBasis,
  type OpeningBasis,
  type PriorClosing,
  type StatementProof,
  type StatementProofPayload,
} from "./statement-proof";

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
  /**
   * Where the opening and closing came from (2.04). Set by the readers, and by
   * checkRun on the statements a run reconciles; absent means printed for a PDF
   * and the running balance for a CSV.
   */
  openingBasis?: OpeningBasis | null;
  closingBasis?: ClosingBasis | null;
}

export const RUN_MESSAGES = {
  noClosing: "Cannot prove a month — no closing balance",
  noDate: "No statement date could be found",
  balancesDoNotFollow: "The running balances do not follow the lines",
  notThisAccount: "Not this account",
  noBalanceFormat: "OFX, QFX, QBO and QIF files carry no running balance, so they cannot prove a month",
  noLines: "No dated amounts could be read out of this file",
} as const;

/**
 * The most statement lines one run previews. A line travels as its date, amount
 * and reference — about 70 bytes, more with a long reference — so a run this
 * size stays under the server's 1 MB body limit when references are short; a
 * run of long references can still exceed it, and is refused whole, writing nothing.
 */
export { MAX_RUN_LINES };

const lastDayOf = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * A CSV export cut into calendar months (p44.html: readStatementText), each
 * opening at its first running balance less every line of the month up to and
 * including that one, as the proof's own CSV rule does, and closing at its last
 * running balance plus every line of the month after it. Lines of no amount are
 * dropped, as the prototype drops them. Without a running balance a month
 * cannot prove itself.
 *
 * OneBook: the prototype opens a month at its first balance less that one line
 * and closes it at its last balance, so a month whose first or last rows carry
 * no balance is out by those lines.
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
    let openingMinor: number | null = null;
    let upTo = 0;
    for (const line of monthLines) {
      upTo += line.amount_minor;
      if (line.running_balance_minor !== null) {
        openingMinor = line.running_balance_minor - upTo;
        break;
      }
    }
    let closingMinor: number | null = null;
    let after = 0;
    for (let k = monthLines.length - 1; k >= 0; k--) {
      const line = monthLines[k];
      if (line.running_balance_minor !== null) {
        closingMinor = line.running_balance_minor + after;
        break;
      }
      after += line.amount_minor;
    }
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
      openingBasis: openingMinor === null ? null : "running",
      closingBasis: closingMinor === null ? null : "running",
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
      openingBasis: s.openingMinor === null ? null : (s.openingBasis ?? "printed"),
      closingBasis: s.closingMinor === null ? null : (s.closingBasis ?? "printed"),
    };
  });
}

/**
 * A statement of a run proved as Import statement proves one: a CSV month by
 * its running balances, a PDF by the balances it prints. `prior` is the closing
 * the statement would follow — the account's last completed reconciliation for
 * the first, the statement before it for the rest, since by the time a month is
 * signed the one before it is that reconciliation. A run has no Not a
 * transaction, no typed balance and no override: a statement that needs one is
 * imported on its own.
 */
export function runStatementProof(
  statement: RunStatement,
  prior: PriorClosing | null,
  money: (minor: number) => string,
): StatementProof {
  if (statement.source === "CSV") return proveStatement({ kind: "csv", lines: statement.lines, prior }, money);
  const figures = pdfFigures({
    openingMinor: statement.openingMinor,
    closingMinor: statement.closingMinor,
    from: statement.from,
    to: statement.to,
  });
  return proveStatement(
    {
      kind: "pdf",
      lines: statement.lines,
      figures: {
        ...figures,
        openingBasis: figures.openingBasis && (statement.openingBasis ?? figures.openingBasis),
        closingBasis: figures.closingBasis && (statement.closingBasis ?? figures.closingBasis),
      },
      prior,
    },
    money,
  );
}

/** The proof a month of a run sends with its lines (reconcileRunMonthAction): its figures, nothing set aside, no override. */
export function runStatementPayload(statement: RunStatement): StatementProofPayload {
  const usual = statement.source === "CSV" ? "running" : "printed";
  return {
    opening_minor: statement.openingMinor,
    closing_minor: statement.closingMinor,
    opening_basis: statement.openingMinor === null ? null : (statement.openingBasis ?? usual),
    closing_basis: statement.closingMinor === null ? null : (statement.closingBasis ?? usual),
    set_aside: 0,
    override: null,
  };
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

/**
 * Where a statement stands in the run. `doesNotAddUp` is the first statement
 * the run would reconcile that does not add up: the run stops there (2.04).
 * `waiting` is every later one the run would otherwise reconcile.
 */
export type RunState =
  | "usable"
  | "unreadable"
  | "notOver"
  | "duplicate"
  | "already"
  | "before"
  | "doesNotAddUp"
  | "waiting";

export interface CheckedStatement {
  statement: RunStatement;
  state: RunState;
  /** What the statements table says about it. */
  note: string;
  /**
   * The statement's proof (2.04), for a statement the run would reconcile —
   * usable, the one that does not add up, and those waiting behind it; null
   * for any other.
   */
  proof: StatementProof | null;
}

export interface RunCheck {
  /** Every statement, by statement date; those without one last. */
  statements: CheckedStatement[];
  /** The statements a run reconciles, oldest first: those before the first that does not add up. */
  usable: RunStatement[];
  /** What stops the whole run; empty when it can go. */
  stops: string[];
}

/** "Out by $6.44 — import this statement on its own to correct it.": why a run stops at a statement that does not add up. */
export function outByStop(differenceMinor: number, money: (minor: number) => string): string {
  return `Out by ${money(Math.abs(differenceMinor))} — import this statement on its own to correct it.`;
}

/**
 * What the statements table says about the statement a run stops at, in the
 * stop's own words: "Out by $0.50 — import this statement on its own to
 * correct it.", or the balance it does not print.
 */
function stopNote(proof: StatementProof, money: (minor: number) => string): string {
  if (proof.differenceMinor !== null) return outByStop(proof.differenceMinor, money);
  const what = proof.missing === "closing" ? "closing balance" : proof.missing === "both" ? "opening or closing balance" : "opening balance";
  return `No ${what} — import this statement on its own to correct it.`;
}

/** What the statements table says about a statement waiting behind the one the run stops at. */
function waitingNote(stoppedAt: RunStatement): string {
  return `Waiting behind the statement closing ${formatDate(stoppedAt.to as string)}`;
}

/**
 * Which statements a run can reconcile, and what stops it: a gap between two
 * statements (p44b.html: the run is disabled), a first statement that does not
 * open where the last reconciliation closed, or a reconciliation in progress.
 * It also sorts out a month not over yet.
 *
 * Each statement the run would reconcile is proved (2.04), and its proof kept
 * with it; the statements it returns carry the proof's opening and closing and
 * their bases, which is what each month sends. The first that does not add up
 * stops the run there, as simulateRun stops its walk at the first month that
 * does not agree: the statements before it still run and can be signed off; it
 * says what it is out by, and every later one waits behind it. A gap, the
 * first statement's opening and the run's size are checked over the statements
 * that run.
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
    const as = (state: RunState, note: string): CheckedStatement => ({ statement, state, note, proof: null });
    if (statement.problem || !statement.to) return as("unreadable", statement.problem ?? RUN_MESSAGES.noDate);
    if (statement.to > context.today) return as("notOver", "Not over yet");
    if (completed.has(statement.to)) return as("already", "Already signed off");
    if (context.lastCompleted && statement.to < context.lastCompleted.date) return as("before", "Before the last reconciliation");
    if (kept.has(statement.to)) return as("duplicate", "Same month as another file");
    kept.add(statement.to);
    return as("usable", plural(statement.lines.length, "line"));
  });

  // Proved oldest first: each statement follows the closing of the one before
  // it, the first the account's last completed reconciliation. The first that
  // does not add up stops the run there; every later one waits behind it.
  let prior: PriorClosing | null = context.lastCompleted
    ? { date: context.lastCompleted.date, endingMinor: context.lastCompleted.endingMinor }
    : null;
  let stoppedAt: RunStatement | null = null;
  for (const c of checked) {
    if (c.state !== "usable") continue;
    const proof = runStatementProof(c.statement, prior, money);
    c.proof = proof;
    c.statement = {
      ...c.statement,
      openingMinor: proof.openingMinor,
      closingMinor: proof.closingMinor,
      openingBasis: proof.openingBasis,
      closingBasis: proof.closingBasis,
    };
    if (stoppedAt) {
      c.state = "waiting";
      c.note = waitingNote(stoppedAt);
    } else if (!proof.proves) {
      stoppedAt = c.statement;
      c.state = "doesNotAddUp";
      c.note = stopNote(proof, money);
    }
    if (proof.closingMinor !== null) prior = { date: c.statement.to as string, endingMinor: proof.closingMinor };
  }
  const usable = checked.filter((c) => c.state === "usable").map((c) => c.statement);

  const stops: string[] = [];
  if (context.inProgress) {
    stops.push(
      `A reconciliation to ${formatDate(context.inProgress.date)} is in progress on this account. Finish it before reconciling more statements.`,
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
      `The statement closing ${formatDate(first.to as string)} opens at ${money(first.openingMinor)}, and the last reconciliation, ` +
        `to ${formatDate(context.lastCompleted.date)}, closed at ${money(context.lastCompleted.endingMinor)}: a month is missing ` +
        "between them, or that reconciliation closed on another figure.",
    );
  }
  const gaps = usable.filter((s, i) => i > 0 && s.openingMinor !== null && s.openingMinor !== usable[i - 1].closingMinor);
  if (gaps.length) {
    stops.push(
      `There is a gap in the run. The statement closing ${gaps.map((s) => formatDate(s.to as string)).join(", ")} ` +
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
  if (statementDate > today) return `The month to ${formatDate(statementDate)} is not over yet.`;
  if (lastCompletedDate && statementDate <= lastCompletedDate) {
    return `This account is already reconciled to ${formatDate(lastCompletedDate)}, so the month to ${formatDate(statementDate)} is not signed off again.`;
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
