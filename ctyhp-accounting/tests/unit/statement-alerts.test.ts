import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  GHOST_GONE,
  balanceSheetNote,
  belowZeroRows,
  belowZeroSheetText,
  ghostCard,
  ghostGroups,
  negativeCard,
  negativeWatch,
  reconcileHref,
  segmentsText,
  statementAlerts,
  statementBalanceRows,
  statementBalanceSheetText,
  withoutReversedPairs,
  type BankAccountAlerts,
  type BankLine,
  type GhostGroup,
  type NegativeWatch,
  type ReversalPair,
} from "@/lib/domain/statement-alerts";

const usd = (minor: number) => `${minor < 0 ? "-" : ""}$${(Math.abs(minor) / 100).toFixed(2)}`;
const fmt = { money: usd };

let seq = 0;
function line(date: string, amountMinor: number, payee: string, over: Partial<BankLine> = {}): BankLine {
  seq += 1;
  return {
    lineId: `l${String(seq).padStart(4, "0")}`,
    entryId: `e${String(seq).padStart(4, "0")}`,
    entryNumber: `JE-${String(seq).padStart(6, "0")}`,
    date,
    amountMinor,
    payee,
    narration: "",
    codedTo: ["6000 Wages"],
    sourceType: "manual",
    cleared: false,
    ...over,
  };
}

/** Seven days of ordinary activity, each under its own name so none forms a group. */
function ordinaryDays(): BankLine[] {
  const amounts = [1000, 2000, -500, 3000, 700, 1300, -400];
  return amounts.map((a, i) => line(`2026-01-0${i + 1}`, a, `Counterparty ${i + 1}`));
}
// Running balance after each of those days.
const BALANCES = [1000, 3000, 2500, 5500, 6200, 7500, 7100];

/** A payee's lines posted as magnitude balance[i] + offset on day i+1, money out. */
function postedAsBalance(payee: string, days: number[], offset: number): BankLine[] {
  return days.map((d) => line(`2026-01-0${d}`, -(BALANCES[d - 1] + offset), payee));
}

describe("ghostGroups", () => {
  it("flags a balance series read once, landing exactly on the rest of the account", () => {
    const lines = [...ordinaryDays(), ...postedAsBalance("Payroll", [2, 4, 5, 7], 0)];
    const groups = ghostGroups(lines);
    expect(groups).toHaveLength(1);
    const g = groups[0];
    expect(g.payee).toBe("Payroll");
    expect(g.agree).toBe(4);
    expect(g.of).toBe(4);
    expect(g.offsetMinor).toBe(0);
    expect(g.runs).toBe(1);
    expect(g.totalMinor).toBe(-(3000 + 5500 + 6200 + 7100));
    expect(g.rows.map((r) => [r.date, r.balanceMinor, r.differenceMinor])).toEqual([
      ["2026-01-02", 3000, 0],
      ["2026-01-04", 5500, 0],
      ["2026-01-05", 6200, 0],
      ["2026-01-07", 7100, 0],
    ]);
    expect(g.entryIds).toHaveLength(4);
  });

  it("works out each row's balance without the group, not with it", () => {
    // If the group's own debits were left in, the balance on day 4 would be
    // lower than 5500 and no row would land on it.
    const lines = [...ordinaryDays(), ...postedAsBalance("Payroll", [2, 3, 4], 0)];
    const [g] = ghostGroups(lines);
    expect(g.rows.map((r) => r.balanceMinor)).toEqual([3000, 2500, 5500]);
  });

  it("finds two runs in a balance read twice, each a fixed distance from the clean balance", () => {
    const lines = [
      ...ordinaryDays(),
      ...postedAsBalance("Daily Balance", [1, 2, 3], 100),
      ...postedAsBalance("Daily Balance", [5, 6, 7], 500),
    ];
    const [g] = ghostGroups(lines);
    expect(g.runs).toBe(2);
    expect(g.agree).toBe(6);
    expect(g.of).toBe(6);
    expect(g.rows.map((r) => r.differenceMinor)).toEqual([100, 100, 100, 500, 500, 500]);
    // A tie between the two runs goes to the one nearer zero.
    expect(g.offsetMinor).toBe(100);
  });

  it("takes the most frequent offset as the group's offset", () => {
    const lines = [
      ...ordinaryDays(),
      ...postedAsBalance("Daily Balance", [1, 2, 3, 4], 250),
      ...postedAsBalance("Daily Balance", [5, 6, 7], 900),
    ];
    const [g] = ghostGroups(lines);
    expect(g.offsetMinor).toBe(250);
    expect(g.runs).toBe(2);
  });

  it("counts an exact hit with no corroboration as agreeing", () => {
    // Offsets: one exact, three at +100, two scattered. Without the rule that an
    // exact landing needs no company, 3 of 6 agree (50%) and nothing is flagged.
    const lines = [
      ...ordinaryDays(),
      ...postedAsBalance("Daily Balance", [1], 0),
      ...postedAsBalance("Daily Balance", [2, 3, 4], 100),
      line("2026-01-05", -(6200 + 11), "Daily Balance"),
      line("2026-01-06", -(7500 + 37), "Daily Balance"),
    ];
    const [g] = ghostGroups(lines);
    expect(g.agree).toBe(4);
    expect(g.of).toBe(6);
    expect(g.runs).toBe(2);
    expect(g.offsetMinor).toBe(100);
    // The two scattered lines are not in the group that would be removed.
    expect(g.rows.map((r) => r.date)).toEqual(["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"]);
  });

  it("does not flag an account that is all one payee", () => {
    const lines = [
      line("2026-01-01", -1000, "Payroll"),
      line("2026-01-02", -1000, "Payroll"),
      line("2026-01-03", -2000, "Payroll"),
      line("2026-01-04", -3000, "Payroll"),
      line("2026-01-05", -3000, "Payroll"),
    ];
    expect(ghostGroups(lines)).toEqual([]);
  });

  it("does not flag a payee against a rest of fewer than three lines", () => {
    const lines = [
      line("2026-01-01", 5000, "Counterparty 1"),
      line("2026-01-02", 1000, "Counterparty 2"),
      line("2026-01-03", -5000, "Payroll"),
      line("2026-01-04", -6000, "Payroll"),
      line("2026-01-05", -6000, "Payroll"),
    ];
    expect(ghostGroups(lines)).toEqual([]);
  });

  it("does not flag when under 60% of a payee's lines agree", () => {
    // Three of six agree (50%).
    const lines = [
      ...ordinaryDays(),
      ...postedAsBalance("Daily Balance", [2, 4, 5], 0),
      line("2026-01-01", -123, "Daily Balance"),
      line("2026-01-03", -4567, "Daily Balance"),
      line("2026-01-06", -89, "Daily Balance"),
    ];
    expect(ghostGroups(lines)).toEqual([]);
  });

  it("flags at exactly 60%", () => {
    const lines = [
      ...ordinaryDays(),
      ...postedAsBalance("Daily Balance", [2, 4, 5], 0),
      line("2026-01-01", -123, "Daily Balance"),
      line("2026-01-03", -4567, "Daily Balance"),
    ];
    const [g] = ghostGroups(lines);
    expect(g.agree).toBe(3);
    expect(g.of).toBe(5);
  });

  it("does not flag a payee with fewer than three lines", () => {
    const lines = [...ordinaryDays(), ...postedAsBalance("Payroll", [2, 4], 0)];
    expect(ghostGroups(lines)).toEqual([]);
  });

  it("looks at nothing on an account with fewer than four lines", () => {
    const lines = [
      line("2026-01-01", 1000, "Counterparty 1"),
      line("2026-01-02", -1000, "Payroll"),
      line("2026-01-03", -1000, "Payroll"),
    ];
    expect(ghostGroups(lines)).toEqual([]);
  });

  it("needs three different balances: three lines on one date prove nothing", () => {
    const lines = [
      ...ordinaryDays(),
      line("2026-01-04", -5500, "Payroll"),
      line("2026-01-04", -5500, "Payroll"),
      line("2026-01-04", -5500, "Payroll"),
    ];
    expect(ghostGroups(lines)).toEqual([]);
  });

  it("needs the balance to move: three dates at one flat balance prove nothing", () => {
    const flat = [
      line("2026-01-01", 5000, "Counterparty 1"),
      line("2026-01-02", 0, "Counterparty 2"),
      line("2026-01-03", 0, "Counterparty 3"),
      line("2026-01-04", 0, "Counterparty 4"),
      line("2026-01-02", -5000, "Payroll"),
      line("2026-01-03", -5000, "Payroll"),
      line("2026-01-04", -5000, "Payroll"),
    ];
    expect(ghostGroups(flat)).toEqual([]);
  });

  it("groups by name ignoring case and spaces, and calls an empty name (no name)", () => {
    const lines = [
      ...ordinaryDays(),
      line("2026-01-02", -3000, "  payroll "),
      line("2026-01-04", -5500, "PAYROLL"),
      line("2026-01-05", -6200, "Payroll"),
    ];
    expect(ghostGroups(lines)[0].agree).toBe(3);

    const blank = [
      ...ordinaryDays(),
      line("2026-01-02", -3000, ""),
      line("2026-01-04", -5500, "  "),
      line("2026-01-05", -6200, ""),
    ];
    expect(ghostGroups(blank)[0].payee).toBe("(no name)");
  });

  it("treats a payee's lines as payments when they do not track the balance", () => {
    const lines = [
      ...ordinaryDays(),
      line("2026-01-02", -1200, "Landlord"),
      line("2026-01-04", -1200, "Landlord"),
      line("2026-01-06", -1200, "Landlord"),
    ];
    expect(ghostGroups(lines)).toEqual([]);
  });

  it("is exact to the cent, not close", () => {
    const lines = [
      ...ordinaryDays(),
      line("2026-01-02", -3001, "Payroll"),
      line("2026-01-04", -5499, "Payroll"),
      line("2026-01-05", -6203, "Payroll"),
    ];
    // Three different offsets of one, one and three cents: none is repeated, none is zero.
    expect(ghostGroups(lines)).toEqual([]);
  });

  it("gives the largest group first", () => {
    const lines = [
      ...ordinaryDays(),
      ...postedAsBalance("Small", [2, 4, 5], 0),
      ...postedAsBalance("Big", [1, 3, 5, 6, 7], 0),
    ];
    // The "Big" lines add to the same balances; each group is judged without the other
    // in its rest, so only the one whose rest still matches is flagged.
    const groups = ghostGroups(lines);
    expect(groups.length).toBeLessThanOrEqual(2);
    for (let i = 1; i < groups.length; i += 1) expect(groups[i - 1].agree).toBeGreaterThanOrEqual(groups[i].agree);
  });

  it("does not change the lines it is given", () => {
    const lines = [...postedAsBalance("Payroll", [2, 4, 5, 7], 0), ...ordinaryDays()];
    const before = lines.map((l) => l.lineId);
    ghostGroups(lines);
    expect(lines.map((l) => l.lineId)).toEqual(before);
  });
});

describe("negativeWatch", () => {
  const last = { date: "2026-01-05", endingMinor: 30_000 };

  it("flags an account that is negative now, with the worst day and the largest unpaid payments", () => {
    const lines = [
      line("2026-01-01", 50_000, "Deposit"),
      line("2026-01-05", -20_000, "Rent", { cleared: true }),
      line("2026-01-10", -40_000, "Supplier A"),
      line("2026-01-12", -2_000, "Supplier B"),
    ];
    const w = negativeWatch(lines, last) as NegativeWatch;
    expect(w.nowMinor).toBe(-12_000);
    expect(w.last).toEqual(last);
    expect(w.worst).toEqual({ date: "2026-01-12", balanceMinor: -12_000 });
    expect(w.outstandingCount).toBe(2);
    expect(w.outstanding.map((o) => [o.name, o.amountMinor])).toEqual([
      ["Supplier A", -40_000],
      ["Supplier B", -2_000],
    ]);
  });

  it("flags a dip since the last statement even when the balance has recovered", () => {
    const lines = [
      line("2026-01-01", 50_000, "Deposit"),
      line("2026-01-05", -20_000, "Rent", { cleared: true }),
      line("2026-01-10", -40_000, "Supplier A"),
      line("2026-01-15", 30_000, "Customer"),
    ];
    const w = negativeWatch(lines, last) as NegativeWatch;
    expect(w.nowMinor).toBe(20_000);
    expect(w.worst).toEqual({ date: "2026-01-10", balanceMinor: -10_000 });
  });

  it("flags an account nobody has reconciled only while it is negative now", () => {
    const negativeNow = [line("2026-01-01", 1_000, "Deposit"), line("2026-01-03", -5_000, "Supplier A")];
    const w = negativeWatch(negativeNow, null) as NegativeWatch;
    expect(w.last).toBeNull();
    expect(w.worst).toBeNull();
    expect(w.nowMinor).toBe(-4_000);
    expect(w.outstandingCount).toBe(1);

    const recovered = [...negativeNow, line("2026-01-09", 9_000, "Customer")];
    expect(negativeWatch(recovered, null)).toBeNull();
  });

  it("is quiet when the balance never went below zero after the last statement", () => {
    const lines = [
      line("2026-01-01", 50_000, "Deposit"),
      line("2026-01-05", -20_000, "Rent", { cleared: true }),
      line("2026-01-10", -10_000, "Supplier A"),
    ];
    expect(negativeWatch(lines, last)).toBeNull();
  });

  it("is quiet for an account at exactly zero, and for no lines at all", () => {
    expect(negativeWatch([line("2026-01-01", 500, "Deposit"), line("2026-01-02", -500, "Rent")], null)).toBeNull();
    expect(negativeWatch([], last)).toBeNull();
  });

  it("flags one cent below zero", () => {
    const w = negativeWatch([line("2026-01-01", 500, "Deposit"), line("2026-01-02", -501, "Rent")], null);
    expect(w?.nowMinor).toBe(-1);
  });

  it("looks at the end of each day, not at the middle of one", () => {
    const lines = [
      line("2026-01-01", 50_000, "Deposit"),
      line("2026-01-05", -20_000, "Rent", { cleared: true }),
      line("2026-01-10", -40_000, "Supplier A"),
      line("2026-01-10", 40_000, "Customer"),
    ];
    expect(negativeWatch(lines, last)).toBeNull();
  });

  it("ignores a dip on or before the statement date", () => {
    const lines = [
      line("2026-01-01", 1_000, "Deposit"),
      line("2026-01-05", -5_000, "Supplier A", { cleared: true }),
      line("2026-01-07", 9_000, "Customer"),
    ];
    expect(negativeWatch(lines, { date: "2026-01-05", endingMinor: -4_000 })).toBeNull();
  });

  it("lists payments after the last statement that no statement holds, never a ticked one or one before it", () => {
    const lines = [
      line("2026-01-01", 90_000, "Deposit"),
      line("2026-01-03", -1_000, "Before the statement"),
      line("2026-01-08", -1_500, "Ticked", { cleared: true }),
      line("2026-01-09", -80_000, "Open A"),
      line("2026-01-10", -20_000, "Open B"),
    ];
    const w = negativeWatch(lines, { date: "2026-01-05", endingMinor: 89_000 }) as NegativeWatch;
    expect(w.outstanding.map((o) => o.name)).toEqual(["Open A", "Open B"]);
    expect(w.outstandingCount).toBe(2);
  });

  it("keeps the six largest, largest first, and counts them all", () => {
    const amounts = [-100, -900, -300, -700, -500, -800, -200, -600];
    const lines = [
      line("2026-01-01", 1_000, "Deposit"),
      ...amounts.map((a, i) => line(`2026-01-0${i + 2}`, a, `Payment ${-a}`)),
    ];
    const w = negativeWatch(lines, null) as NegativeWatch;
    expect(w.outstanding.map((o) => o.amountMinor)).toEqual([-900, -800, -700, -600, -500, -300]);
    expect(w.outstandingCount).toBe(8);
  });

  it("does not count money coming in as outstanding", () => {
    const lines = [line("2026-01-01", -1_000, "Payment"), line("2026-01-02", 500, "Refund")];
    expect((negativeWatch(lines, null) as NegativeWatch).outstandingCount).toBe(1);
  });
});

describe("statementAlerts", () => {
  it("runs both detectors over the same lines", () => {
    const lines = [...ordinaryDays(), ...postedAsBalance("Payroll", [2, 4, 5, 7], 0)];
    const result = statementAlerts(lines, null);
    expect(result.ghosts).toHaveLength(1);
    expect(result.negative).not.toBeNull();
  });
});

describe("the copy", () => {
  const group = (over: Partial<GhostGroup> = {}): GhostGroup => ({
    payee: "Payroll",
    rows: [],
    agree: 31,
    of: 33,
    offsetMinor: 0,
    runs: 1,
    totalMinor: -123_456,
    entryIds: Array.from({ length: 31 }, (_, i) => `e${i}`),
    ...over,
  });

  it("writes the balance card for an exact landing", () => {
    const card = ghostCard(group(), fmt);
    expect(card.title).toBe("31 entries here look like the statement's balance, not payments");
    expect(segmentsText(card.body)).toBe(
      "Every one of them is named Payroll, and 31 of the 33 land exactly on what this account comes to on their own date once the group itself is taken out. A payment does not track the balance of the account it is paid from. These are almost certainly a Balance column read as amounts, and together they move -$1234.56.",
    );
    expect(card.body.filter((s) => s.bold).map((s) => s.text)).toEqual(["Payroll"]);
    expect(card.body.filter((s) => s.italic).map((s) => s.text)).toEqual(["Balance"]);
  });

  it("says each run is a fixed distance away when there is more than one", () => {
    const text = segmentsText(ghostCard(group({ runs: 2, offsetMinor: 500 }), fmt).body);
    expect(text).toContain("taken out, each run of them a fixed distance from it. A payment");
    expect(text).not.toContain("give or take");
  });

  it("says give or take when one run sits a constant distance away", () => {
    const text = segmentsText(ghostCard(group({ offsetMinor: -2_500 }), fmt).body);
    expect(text).toContain("taken out, give or take $25.00 that is outstanding for other reasons. A payment");
    expect(text).not.toContain("fixed distance");
  });

  it("names the buttons, the workings and the messages", () => {
    const card = ghostCard(group(), fmt);
    expect(card.showWorkings).toBe("Show me the workings");
    expect(card.hideWorkings).toBe("Hide the workings");
    expect(card.removeLabel).toBe("Remove these 31 entries");
    expect(card.confirmLabel).toBe("Confirm — remove all 31");
    expect(card.workingsColumns).toEqual(["Date", "Posted as", "This account on that date", "Difference", "Coded to"]);
    expect(card.workingsFootnote).toBe(
      "The middle column is worked out with these entries removed, so it is not an argument with itself.",
    );
    expect(card.removedMessage(31)).toBe("31 entries removed. They were balances, not payments.");
    expect(card.goneMessage).toBe("Those entries are no longer here.");
    expect(GHOST_GONE).toBe(card.goneMessage);
    expect(card.difference(0)).toBe("—");
    expect(card.difference(2_500)).toBe("$25.00");
  });

  it("counts the entries, not the lines, in the title and the button", () => {
    const card = ghostCard(group({ agree: 3, of: 3, entryIds: ["a", "b"] }), fmt);
    expect(card.title).toBe("2 entries here look like the statement's balance, not payments");
    expect(card.removeLabel).toBe("Remove these 2 entries");
    expect(ghostCard(group({ entryIds: ["a"] }), fmt).removeLabel).toBe("Remove these 1 entry");
  });

  const watch = (over: Partial<NegativeWatch> = {}): NegativeWatch => ({
    nowMinor: -12_000,
    last: { date: "2026-01-05", endingMinor: 30_000 },
    worst: { date: "2026-01-12", balanceMinor: -15_000 },
    outstanding: [
      { lineId: "l1", entryId: "e1", entryNumber: "JE-1", date: "2026-01-10", name: "Supplier A", amountMinor: -40_000, codedTo: [] },
    ],
    outstandingCount: 9,
    ...over,
  });

  it("writes the below-zero card when it is still below zero today", () => {
    const card = negativeCard("Operating Checking", watch(), fmt);
    expect(card.title).toBe("Operating Checking reads below zero, and still does today");
    expect(segmentsText(card.body)).toBe(
      "The last statement you agreed on this account closed at $300.00 on Jan 5, 2026, so the balance was right on the day it was proved. Since then it drops to -$150.00 on Jan 12, 2026. It reads -$120.00 today. A bank would have charged you for an overdraft and shown it on the statement; where it has not, what is dragging it under is usually an entry that is not a payment — a balance posted as one, or the same thing entered twice.",
    );
    expect(card.body.filter((s) => s.bold).map((s) => s.text)).toEqual(["$300.00", "-$150.00"]);
    expect(card.listHeading).toBe("The largest 1 of the 9 payments not yet on a statement:");
    expect(card.listColumns).toEqual(["Date", "Name", "Amount", "Coded to"]);
    expect(card.footer).toBe(
      "Reconcile the next statement and whatever the bank has never seen is left standing on its own.",
    );
  });

  it("says at some point since the last statement when it has recovered", () => {
    const card = negativeCard("Operating Checking", watch({ nowMinor: 2_000 }), fmt);
    expect(card.title).toBe("Operating Checking reads below zero at some point since the last statement");
  });

  it("says nothing has been reconciled, and leaves out the worst day, when there is neither", () => {
    const card = negativeCard("Petty Cash", watch({ last: null, worst: null }), fmt);
    const text = segmentsText(card.body);
    expect(text.startsWith("Nothing has been reconciled on this account yet, so there is no agreed figure to measure from. It reads -$120.00 today.")).toBe(true);
    expect(text).not.toContain("Since then");
  });

  it("has no list heading when nothing is outstanding", () => {
    expect(negativeCard("Petty Cash", watch({ outstanding: [], outstandingCount: 0 }), fmt).listHeading).toBeNull();
  });

  it("uses the date formatter it is given", () => {
    const card = negativeCard("Petty Cash", watch(), { money: usd, date: (d) => `<${d}>` });
    expect(segmentsText(card.body)).toContain("on <2026-01-05>, so");
  });
});

describe("balanceSheetNote", () => {
  it("says nothing when no bank account is below zero", () => {
    expect(balanceSheetNote([])).toBeNull();
  });

  it("names one account and points to Reconcile", () => {
    const note = balanceSheetNote([{ bankAccountId: "b 1", accountName: "Operating Checking", ghostEntries: 0 }]);
    expect(note?.headline).toBe("Operating Checking is below zero.");
    expect(note?.detail).toBe("Reconcile shows what has gone in since the last statement you agreed.");
    expect(note?.links).toEqual([
      { bankAccountId: "b 1", accountName: "Operating Checking", href: "/banking/reconcile?account=b%201", label: "Open Reconcile" },
    ]);
  });

  it("uses the balance sentence when the account has flagged entries", () => {
    const note = balanceSheetNote([{ bankAccountId: "b1", accountName: "Operating Checking", ghostEntries: 31 }]);
    expect(note?.detail).toBe(
      "31 entries on it look like the account's own balance posted as payments. Reconcile shows the workings and offers to remove them.",
    );
  });

  it("joins several accounts and adds their flagged entries together", () => {
    const note = balanceSheetNote([
      { bankAccountId: "b1", accountName: "Checking", ghostEntries: 4 },
      { bankAccountId: "b2", accountName: "Savings", ghostEntries: 0 },
      { bankAccountId: "b3", accountName: "Petty Cash", ghostEntries: 3 },
    ]);
    expect(note?.headline).toBe("Checking, Savings and Petty Cash are below zero.");
    expect(note?.detail).toBe(
      "7 entries on those accounts look like the account's own balance posted as payments. Reconcile shows the workings and offers to remove them.",
    );
    expect(note?.links.map((l) => l.label)).toEqual([
      "Open Reconcile for Checking",
      "Open Reconcile for Savings",
      "Open Reconcile for Petty Cash",
    ]);
    expect(balanceSheetNote([
      { bankAccountId: "b1", accountName: "Checking", ghostEntries: 1 },
    ])?.detail).toContain("1 entry on it looks like");
    expect(
      balanceSheetNote([
        { bankAccountId: "b1", accountName: "Checking", ghostEntries: 0 },
        { bankAccountId: "b2", accountName: "Savings", ghostEntries: 0 },
      ])?.headline,
    ).toBe("Checking and Savings are below zero.");
  });

  it("builds the Reconcile address from the bank account", () => {
    expect(reconcileHref("abc")).toBe("/banking/reconcile?account=abc");
  });
});

describe("the Exceptions rows", () => {
  const ghost = (payee: string, total: number, n: number): GhostGroup => ({
    payee,
    rows: [],
    agree: n,
    of: n,
    offsetMinor: 0,
    runs: 1,
    totalMinor: total,
    entryIds: Array.from({ length: n }, (_, i) => `${payee}${i}`),
  });
  const negative = (over: Partial<NegativeWatch> = {}): NegativeWatch => ({
    nowMinor: -1_000,
    last: { date: "2026-01-05", endingMinor: 30_000 },
    worst: { date: "2026-01-12", balanceMinor: -5_000 },
    outstanding: [],
    outstandingCount: 3,
    ...over,
  });
  const accounts: BankAccountAlerts[] = [
    { bankAccountId: "b1", accountName: "Checking", ghosts: [ghost("Payroll", -100_000, 4)], negative: negative() },
    { bankAccountId: "b2", accountName: "Savings", ghosts: [ghost("Daily", -900_000, 5), ghost("Interest", -50_000, 3)], negative: null },
    { bankAccountId: "b3", accountName: "Petty Cash", ghosts: [], negative: negative({ worst: null, last: null, nowMinor: -9_000, outstandingCount: 1 }) },
  ];

  it("lists one row per flagged group, the largest total first", () => {
    const rows = statementBalanceRows(accounts);
    expect(rows.map((r) => [r.accountName, r.payee, r.entryCount, r.totalMinor])).toEqual([
      ["Savings", "Daily", 5, -900_000],
      ["Checking", "Payroll", 4, -100_000],
      ["Savings", "Interest", 3, -50_000],
    ]);
    expect(rows[0].bankAccountId).toBe("b2");
  });

  it("lists one row per account below zero, the lowest first", () => {
    const rows = belowZeroRows(accounts);
    expect(rows.map((r) => r.accountName)).toEqual(["Petty Cash", "Checking"]);
    expect(rows[1]).toEqual({
      bankAccountId: "b1",
      accountName: "Checking",
      nowMinor: -1_000,
      worstMinor: -5_000,
      worstDate: "2026-01-12",
      lastStatementDate: "2026-01-05",
      outstandingCount: 3,
    });
    expect(rows[0].worstMinor).toBeNull();
    expect(rows[0].lastStatementDate).toBeNull();
  });

  it("finds nothing in accounts with nothing flagged", () => {
    const quiet: BankAccountAlerts[] = [{ bankAccountId: "b1", accountName: "Checking", ghosts: [], negative: null }];
    expect(statementBalanceRows(quiet)).toEqual([]);
    expect(belowZeroRows(quiet)).toEqual([]);
  });

  it("words the sheet rows", () => {
    expect(statementBalanceSheetText(statementBalanceRows(accounts)[0])).toEqual({ type: "5 entries", name: "Daily" });
    const [petty, checking] = belowZeroRows(accounts);
    expect(belowZeroSheetText(petty, usd)).toEqual({
      type: "Last reconciled never",
      name: "1 payment not yet on a statement",
    });
    expect(belowZeroSheetText(checking, usd)).toEqual({
      type: "Last reconciled 2026-01-05",
      name: "Lowest -$50.00 · 3 payments not yet on a statement",
    });
  });
});

describe("withoutReversedPairs", () => {
  /** The entry that reverses `original`: its lines swapped, on its date, under a name of its own. */
  function reversalOf(original: BankLine): { line: BankLine; pair: ReversalPair } {
    const reversal = line(original.date, -original.amountMinor, `Reversal of ${original.entryNumber} — balances, not payments`);
    return { line: reversal, pair: { originalEntryId: original.entryId, reversalEntryId: reversal.entryId } };
  }

  it("leaves out an entry that was reversed together with its reversal", () => {
    const kept = line("2026-01-01", 10_000, "Deposit");
    const wrong = line("2026-01-02", -4_000, "Supplier");
    const { line: undo, pair } = reversalOf(wrong);
    expect(withoutReversedPairs([kept, wrong, undo], [pair])).toEqual([kept]);
  });

  it("keeps an original whose reversal is not among the lines", () => {
    const wrong = line("2026-01-02", -4_000, "Supplier");
    const pair = { originalEntryId: wrong.entryId, reversalEntryId: "voided-since" };
    expect(withoutReversedPairs([wrong], [pair])).toEqual([wrong]);
  });

  it("changes nothing when nothing was reversed", () => {
    const lines = ordinaryDays();
    expect(withoutReversedPairs(lines, [])).toEqual(lines);
  });

  it("still flags a series that was removed once and then imported again", () => {
    const removed = postedAsBalance("Payroll", [2, 4, 5, 7], 0);
    const reversals = removed.map(reversalOf);
    const again = postedAsBalance("Payroll", [2, 4, 5, 7], 0);
    const lines = [...ordinaryDays(), ...removed, ...reversals.map((r) => r.line), ...again];

    // Counted, the removed four dilute the new four: no offset agrees.
    expect(ghostGroups(lines)).toEqual([]);

    const groups = ghostGroups(withoutReversedPairs(lines, reversals.map((r) => r.pair)));
    expect(groups).toHaveLength(1);
    expect([groups[0].agree, groups[0].of]).toEqual([4, 4]);
    expect(groups[0].entryIds).toEqual(again.map((l) => l.entryId));
  });

  it("does not list a reversed payment as one no statement has shown", () => {
    const last = { date: "2026-01-05", endingMinor: 50_000 };
    const real = line("2026-01-10", -60_000, "Supplier A");
    const wrong = line("2026-01-11", -90_000, "Supplier B");
    const { line: undo, pair } = reversalOf(wrong);
    const lines = [line("2026-01-01", 50_000, "Deposit", { cleared: true }), real, wrong, undo];
    const w = negativeWatch(withoutReversedPairs(lines, [pair]), last) as NegativeWatch;
    expect(w.nowMinor).toBe(-10_000);
    expect(w.outstanding.map((o) => o.name)).toEqual(["Supplier A"]);
    expect(w.outstandingCount).toBe(1);
  });
});

describe("the module", () => {
  it("imports nothing that reads or writes", () => {
    const source = readFileSync("lib/domain/statement-alerts.ts", "utf8");
    expect(source).not.toMatch(/@\/lib\/(db|services)\//);
  });
});
