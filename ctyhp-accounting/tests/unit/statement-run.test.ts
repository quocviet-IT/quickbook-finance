import { describe, expect, it } from "vitest";
import type { PdfStatement } from "@/lib/domain/pdf-statement";
import type { StatementLine } from "@/lib/domain/statement-import";
import {
  RUN_MESSAGES,
  checkRun,
  monthSentence,
  monthsFromCsv,
  simulateRun,
  statementsFromPdf,
  type OpenBookLine,
  type RunContext,
  type RunStatement,
} from "@/lib/domain/statement-run";

const money = (minor: number) => `$${(minor / 100).toFixed(2)}`;
const csvLine = (date: string, amount: number, balance: number | null, description = "LINE"): StatementLine => ({
  txn_date: date,
  description,
  reference: null,
  amount_minor: amount,
  running_balance_minor: balance,
  raw_line: `${date},${description},${amount},${balance ?? ""}`,
});
const statement = (to: string, opening: number | null, closing: number | null, lines: StatementLine[] = [], extra: Partial<RunStatement> = {}): RunStatement => ({
  key: to,
  fileName: `${to}.pdf`,
  source: "PDF",
  from: `${to.slice(0, 7)}-01`,
  to,
  openingMinor: opening,
  closingMinor: closing,
  lines,
  problem: null,
  outByMinor: null,
  ...extra,
});
const noContext: RunContext = { lastCompleted: null, completedDates: [], inProgress: null };
const book = (id: string, date: string, amount: number, reference: string | null = null): OpenBookLine => ({
  id,
  date,
  amountMinor: amount,
  reference,
  entryNumber: `JE-${id}`,
});

describe("monthsFromCsv", () => {
  const oldestFirst = [
    csvLine("2026-07-03", 50000, 150000),
    csvLine("2026-07-20", -2500, 147500),
    csvLine("2026-08-02", -7500, 140000),
    csvLine("2026-08-31", 1000, 141000),
  ];

  it("cuts a file into calendar months, each closing at its last balance", () => {
    const months = monthsFromCsv("bank-2026.csv", oldestFirst);
    expect(months.map((m) => [m.fileName, m.from, m.to, m.openingMinor, m.closingMinor, m.lines.length, m.problem])).toEqual([
      ["bank-2026.csv (2026-07)", "2026-07-01", "2026-07-31", 100000, 147500, 2, null],
      ["bank-2026.csv (2026-08)", "2026-08-01", "2026-08-31", 147500, 141000, 2, null],
    ]);
  });

  it("keeps the file's name for a file of one month", () => {
    expect(monthsFromCsv("july.csv", oldestFirst.slice(0, 2))[0].fileName).toBe("july.csv");
  });

  it("reads a file listed newest first oldest first, even with two lines on a month's last day", () => {
    const newestFirst = [
      csvLine("2026-07-31", -300, 99200, "SECOND"),
      csvLine("2026-07-31", -500, 99500, "FIRST"),
      csvLine("2026-07-02", 10000, 100000),
    ];
    const [july] = monthsFromCsv("newest.csv", newestFirst);
    expect([july.openingMinor, july.closingMinor, july.problem]).toEqual([90000, 99200, null]);
    expect(july.lines.map((l) => l.description)).toEqual(["LINE", "FIRST", "SECOND"]);
  });

  it("cannot prove a month without a running balance", () => {
    const [july] = monthsFromCsv("plain.csv", [csvLine("2026-07-03", 500, null)]);
    expect([july.closingMinor, july.problem]).toEqual([null, RUN_MESSAGES.noClosing]);
  });

  it("says so when the running balances do not follow the lines", () => {
    const [july] = monthsFromCsv("odd.csv", [csvLine("2026-07-03", 500, 1500), csvLine("2026-07-04", 500, 9999)]);
    expect(july.problem).toBe(RUN_MESSAGES.balancesDoNotFollow);
  });

  it("drops lines of no amount, as the prototype does", () => {
    const [july] = monthsFromCsv("zero.csv", [csvLine("2026-07-03", 500, 1500), csvLine("2026-07-04", 0, 1500)]);
    expect(july.lines).toHaveLength(1);
  });
});

describe("statementsFromPdf", () => {
  const pdf = (accountNumber: string | null, to: string | null, closing: number | null): PdfStatement => ({
    accountNumber,
    from: to ? `${to.slice(0, 7)}-01` : null,
    to,
    openingMinor: 1000,
    closingMinor: closing,
    lines: [{ date: "2026-07-05", description: "DEPOSIT", checkNumber: null, amountMinor: 500, balanceMinor: 1500, raw: "07/05 DEPOSIT 5.00" }],
    skipped: 0,
  });

  it("keeps this account's statements and marks another account's", () => {
    const read = statementsFromPdf("combined.pdf", [pdf("00007917", "2026-07-31", 1500), pdf("00004821", "2026-07-31", 1500)], "****7917");
    expect(read.map((s) => [s.fileName, s.problem])).toEqual([
      ["combined.pdf (2026-07)", null],
      ["combined.pdf (2026-07)", RUN_MESSAGES.notThisAccount],
    ]);
  });

  it("takes every statement when none names an account, and says what cannot prove a month", () => {
    const read = statementsFromPdf("plain.pdf", [pdf(null, "2026-07-31", null), pdf(null, null, 1500)], "****7917");
    expect(read.map((s) => s.problem)).toEqual([RUN_MESSAGES.noClosing, RUN_MESSAGES.noDate]);
  });

  it("records by how much a statement does not prove itself", () => {
    expect(statementsFromPdf("off.pdf", [pdf(null, "2026-07-31", 1600)], null)[0].outByMinor).toBe(100);
  });
});

describe("checkRun", () => {
  it("orders the statements and says which a run reconciles", () => {
    const result = checkRun(
      [
        statement("2026-09-30", 1300, 1400),
        statement("2026-07-31", 1000, 1100),
        statement("2026-08-31", 1100, 1300),
        statement("2026-08-31", 1100, 1300, [], { key: "copy", fileName: "copy.pdf" }),
        statement("2026-06-30", 900, 1000),
        statement("2026-05-31", 800, 900),
        statement("2026-10-31", null, null, [], { to: null, problem: RUN_MESSAGES.noDate }),
      ],
      { lastCompleted: { date: "2026-06-30", endingMinor: 1000 }, completedDates: ["2026-06-30"], inProgress: null },
      money,
    );
    expect(result.statements.map((c) => [c.statement.key, c.state])).toEqual([
      ["2026-05-31", "before"],
      ["2026-06-30", "already"],
      ["2026-07-31", "usable"],
      ["2026-08-31", "usable"],
      ["copy", "duplicate"],
      ["2026-09-30", "usable"],
      ["2026-10-31", "unreadable"],
    ]);
    expect(result.usable.map((s) => s.to)).toEqual(["2026-07-31", "2026-08-31", "2026-09-30"]);
    expect(result.stops).toEqual([]);
  });

  it("stops a run with a gap, with a first statement that does not open where the last reconciliation closed, and with one in progress", () => {
    const result = checkRun(
      [statement("2026-07-31", 1000, 1100), statement("2026-08-31", 1200, 1300)],
      { lastCompleted: { date: "2026-06-30", endingMinor: 900 }, completedDates: ["2026-06-30"], inProgress: { id: "r", date: "2026-07-31" } },
      money,
    );
    expect(result.stops).toEqual([
      "A reconciliation to Jul 31, 2026 is in progress on this account. Finish it before reconciling more statements.",
      "The statement closing Jul 31, 2026 opens at $10.00, and the last reconciliation, to Jun 30, 2026, closed at $9.00: a month is missing between them, or that reconciliation closed on another figure.",
      "There is a gap in the run. The statement closing Aug 31, 2026 does not open at the one before it, so a month is missing from what you have chosen. Reconciling across a gap would sign off items nobody has seen a statement for.",
    ]);
  });

  it("says nothing can be reconciled when no statement is usable", () => {
    expect(checkRun([statement("2026-07-31", 1000, null, [], { problem: RUN_MESSAGES.noClosing })], noContext, money).stops).toEqual([
      "Nothing here can be reconciled yet.",
    ]);
  });

  it("notes a statement that does not prove itself", () => {
    const [only] = checkRun([statement("2026-07-31", 1000, 1100, [csvLine("2026-07-05", 100, null)], { outByMinor: -2000 })], noContext, money).statements;
    expect(only.note).toBe("1 line — does not prove itself, out by $20.00");
  });
});

describe("simulateRun", () => {
  const july = statement("2026-07-31", 100000, 140000, [csvLine("2026-07-05", 50000, null), csvLine("2026-07-20", -10000, null)]);
  const august = statement("2026-08-31", 140000, 130000, [csvLine("2026-08-04", -10000, null)]);

  it("walks agreeing months, each beginning where the last closed, without offering a paired line twice", () => {
    const preview = simulateRun(
      [july, august],
      [book("a", "2026-07-05", 50000), book("b", "2026-07-20", -10000), book("c", "2026-08-01", -10000), book("d", "2026-08-25", -999)],
      { beginningMinor: 100000, broughtForward: null },
      money,
    );
    expect(preview.months.map((m) => [m.statementDate, m.beginningMinor, m.outcome])).toEqual([
      ["2026-07-31", 100000, { kind: "agrees", paired: 2, of: 2, outstanding: 0 }],
      ["2026-08-31", 140000, { kind: "agrees", paired: 1, of: 1, outstanding: 1 }],
    ]);
    expect(preview.months[1].standings).toEqual([{ kind: "paired", how: "amount, within 5 days", bookId: "c", entryNumber: "JE-c", ticked: false }]);
    expect(preview.toSign).toBe(2);
  });

  it("stops at a month out by what the books do not have, and leaves the rest waiting", () => {
    const fee = statement("2026-07-31", 100000, 139500, [...july.lines, csvLine("2026-07-30", -500, null)]);
    const preview = simulateRun([fee, august], [book("a", "2026-07-05", 50000), book("b", "2026-07-20", -10000)], { beginningMinor: 100000, broughtForward: null }, money);
    expect(preview.months.map((m) => m.outcome)).toEqual([{ kind: "outBy", differenceMinor: -500, missing: 1 }, { kind: "waiting" }]);
    expect(preview.toSign).toBe(0);
  });

  it("stops at a month that agrees only on its balance", () => {
    const preview = simulateRun(
      [july],
      [book("a", "2026-07-05", 50000), book("b", "2026-07-09", -10000)],
      { beginningMinor: 100000, broughtForward: null },
      money,
    );
    expect(preview.months[0].outcome).toEqual({ kind: "balanceOnly", unpaired: 1, of: 2 });
    expect(preview.toSign).toBe(0);
  });

  it("brings the earlier lines forward when the books agree with the first statement's opening balance", () => {
    const preview = simulateRun(
      [july],
      [book("old", "2026-06-10", 100000), book("a", "2026-07-05", 50000), book("b", "2026-07-20", -10000)],
      { beginningMinor: null, broughtForward: { hasReconciliations: false, bookBalanceMinor: 100000, openLines: 1 } },
      money,
    );
    expect(preview.broughtForward?.canBringForward).toBe(true);
    expect(preview.months[0]).toMatchObject({ beginningMinor: 100000, outcome: { kind: "agrees", paired: 2, of: 2, outstanding: 0 } });
  });

  it("pairs a month whose statement writes money the other way round", () => {
    const turned = statement("2026-07-31", 100000, 140000, [csvLine("2026-07-05", -50000, null), csvLine("2026-07-20", 10000, null)]);
    const preview = simulateRun([turned], [book("a", "2026-07-05", 50000), book("b", "2026-07-20", -10000)], { beginningMinor: 100000, broughtForward: null }, money);
    expect(preview.months[0].outcome).toEqual({ kind: "agrees", paired: 2, of: 2, outstanding: 0 });
  });

  it("counts a month that reaches zero as agreeing even when lines not in the books net to nothing, as the prototype does", () => {
    const netNothing = statement("2026-07-31", 100000, 140000, [...july.lines, csvLine("2026-07-10", -500, null), csvLine("2026-07-11", 500, null)]);
    const preview = simulateRun([netNothing], [book("a", "2026-07-05", 50000), book("b", "2026-07-20", -10000)], { beginningMinor: 100000, broughtForward: null }, money);
    expect(preview.months[0].outcome).toEqual({ kind: "agrees", paired: 2, of: 4, outstanding: 0 });
    expect(preview.toSign).toBe(1);
  });

  it("walks the first month of an account never reconciled from zero when its statement prints no opening balance", () => {
    const noOpening = statement("2026-07-31", null, 140000, july.lines);
    const preview = simulateRun(
      [noOpening],
      [book("old", "2026-06-10", 90000), book("a", "2026-07-05", 50000), book("b", "2026-07-20", -10000)],
      { beginningMinor: null, broughtForward: { hasReconciliations: false, bookBalanceMinor: 90000, openLines: 1 } },
      money,
    );
    expect(preview.broughtForward).toBeNull();
    expect(preview.months[0]).toMatchObject({ beginningMinor: 0, outcome: { kind: "outBy", differenceMinor: 100000, missing: 0 } });
  });
});

describe("monthSentence", () => {
  it("says each outcome in a line", () => {
    expect(monthSentence({ kind: "agrees", paired: 12, of: 12, outstanding: 1 }, money)).toBe("Agrees — 12 of 12 lines paired, 1 outstanding");
    expect(monthSentence({ kind: "balanceOnly", unpaired: 3, of: 9 }, money)).toBe("Agrees on the balance only — needs a look: 3 lines did not pair");
    expect(monthSentence({ kind: "outBy", differenceMinor: -1500, missing: 1 }, money)).toBe("Out by $15.00 — the bank shows 1 thing the books do not");
    expect(monthSentence({ kind: "waiting" }, money)).toBe("Waiting");
  });
});
