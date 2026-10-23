import { describe, expect, it } from "vitest";
import { checkRun, monthSentence, simulateRun, type OpenBookLine, type RunContext, type RunStatement } from "@/lib/domain/statement-run";

/**
 * 2.46: a credit card's run of statements, proved on their balances. Figures
 * as the statements print them — owed positive, a charge positive, a payment
 * negative — which is how the server turns the books round for a card.
 * Invented throughout.
 */
const money = (minor: number) => `${minor < 0 ? "-" : ""}$${(Math.abs(minor) / 100).toFixed(2)}`;
const card = (to: string, from: string, previous: number, next: number): RunStatement => ({
  key: `${to}.pdf#card`,
  fileName: `${to}.pdf`,
  source: "PDF",
  from,
  to,
  openingMinor: previous,
  closingMinor: next,
  lines: [],
  problem: null,
  outByMinor: null,
  openingBasis: "printed",
  closingBasis: "printed",
  balancesOnly: true,
});
const context = (over: Partial<RunContext> = {}): RunContext => ({
  lastCompleted: null,
  completedDates: [],
  inProgress: null,
  today: "2026-10-23",
  ...over,
});
const book = (id: string, date: string, amountMinor: number): OpenBookLine => ({ id, date, amountMinor, reference: null, entryNumber: null });

const AUG = card("2026-08-29", "2026-07-30", 0, 45600);
const SEP = card("2026-09-29", "2026-08-30", 45600, 7600);

describe("checking a card's run", () => {
  it("takes a card statement on its balances, says them, and follows each from the one before", () => {
    const check = checkRun([SEP, AUG], context(), money);
    expect(check.stops).toEqual([]);
    expect(check.usable.map((s) => s.to)).toEqual(["2026-08-29", "2026-09-29"]);
    expect(check.statements.map((c) => [c.state, c.note, c.proof])).toEqual([
      ["usable", "Previous balance $0.00 · new balance $456.00", null],
      ["usable", "Previous balance $456.00 · new balance $76.00", null],
    ]);
  });

  it("stops on a gap between two card statements", () => {
    // July, then September: August is missing, and September opens at August's new balance.
    const check = checkRun([card("2026-07-29", "2026-06-30", 0, 0), SEP], context(), money);
    expect(check.stops.join(" ")).toContain("There is a gap in the run");
  });

  it("stops when the first statement does not open where the last reconciliation closed", () => {
    const check = checkRun([SEP], context({ lastCompleted: { date: "2026-08-29", endingMinor: 40000 } }), money);
    expect(check.stops.join(" ")).toContain("opens at $456.00");
  });

  it("keeps a card statement whose summary did not add up out of the run, saying why", () => {
    const bad = { ...SEP, problem: "The statement's own summary does not add up (out by $5.00)" };
    const check = checkRun([AUG, bad], context(), money);
    expect(check.statements[1]).toMatchObject({ state: "unreadable", note: bad.problem });
    expect(check.usable).toHaveLength(1);
  });
});

describe("walking a card's run against the books", () => {
  // August: two charges. September: a charge, a fee and a payment from checking.
  const open = [
    book("a1", "2026-08-04", 45600),
    book("s1", "2026-09-10", 12000),
    book("s2", "2026-09-15", -50000),
    book("s3", "2026-09-29", 0),
    book("o1", "2026-10-02", 9900),
  ];

  it("signs a month when the books' lines to its closing date come to its new balance, and carries them no further", () => {
    const preview = simulateRun([AUG, SEP], open, { beginningMinor: null, broughtForward: null }, money);
    expect(preview.toSign).toBe(2);
    expect(preview.months.map((m) => [m.statementDate, m.beginningMinor, m.closingMinor, m.outcome])).toEqual([
      ["2026-08-29", 0, 45600, { kind: "agreesOnBalance", lines: 1 }],
      ["2026-09-29", 45600, 7600, { kind: "agreesOnBalance", lines: 3 }],
    ]);
    expect(monthSentence(preview.months[0].outcome, money)).toBe("Agrees — the books' 1 line to the closing date come to the new balance");
  });

  it("stops at the first month the books do not come to, saying by how much, and leaves the rest waiting", () => {
    const short = open.filter((line) => line.id !== "s1");
    const preview = simulateRun([AUG, SEP, card("2026-10-29", "2026-09-30", 7600, 17500)], short, { beginningMinor: null, broughtForward: null }, money);
    expect(preview.toSign).toBe(1);
    expect(preview.months.map((m) => m.outcome.kind)).toEqual(["agreesOnBalance", "outBy", "waiting"]);
    expect(preview.months[1].outcome).toEqual({ kind: "outBy", differenceMinor: 12000, missing: 0 });
    expect(monthSentence(preview.months[1].outcome, money)).toBe("Out by $120.00");
  });

  it("begins at the last reconciliation's balance owed", () => {
    const preview = simulateRun([SEP], open.filter((l) => l.id !== "a1"), { beginningMinor: 45600, broughtForward: null }, money);
    expect(preview.months[0]).toMatchObject({ beginningMinor: 45600, outcome: { kind: "agreesOnBalance", lines: 3 } });
  });
});
