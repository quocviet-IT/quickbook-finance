import { describe, expect, it } from "vitest";
import type { PdfStatement, PdfStatementLine } from "@/lib/domain/pdf-statement";
import { periodLabel, pickStatement, skippedNote, statementLabel, summarizeStatement } from "@/lib/domain/pdf-statement-view";
import { formatMoney } from "@/lib/format";

const usd = (minor: number) => formatMoney(minor, "USD", 2);
const line = (amountMinor: number): PdfStatementLine => ({
  date: "2026-01-05",
  description: "EXAMPLE",
  checkNumber: null,
  amountMinor,
  balanceMinor: null,
  raw: "01/05 EXAMPLE",
});
const statement = (over: Partial<PdfStatement> = {}): PdfStatement => ({
  accountNumber: "00001111",
  from: "2026-01-01",
  to: "2026-01-31",
  openingMinor: 100000,
  closingMinor: 118000,
  lines: [line(-25000), line(-7000), line(50000)],
  skipped: 0,
  ...over,
});

describe("periodLabel", () => {
  it("names the period as a person writes it", () => {
    expect(periodLabel("2026-01-01", "2026-01-31")).toBe("Jan 1 – Jan 31, 2026");
    expect(periodLabel("2025-12-15", "2026-01-14")).toBe("Dec 15, 2025 – Jan 14, 2026");
    expect(periodLabel(null, "2026-11-30")).toBe("closing Nov 30, 2026");
    expect(periodLabel(null, null)).toBe("no period printed");
  });
});

describe("statementLabel", () => {
  it("offers each statement of a combined PDF by account, period and lines", () => {
    expect(statementLabel(statement())).toBe("Account ending 1111 · Jan 1 – Jan 31, 2026 · 3 lines");
    expect(statementLabel(statement({ accountNumber: null, lines: [line(100)] }))).toBe(
      "Account not named · Jan 1 – Jan 31, 2026 · 1 line",
    );
  });
});

describe("pickStatement", () => {
  const both = [statement({ accountNumber: "00001111" }), statement({ accountNumber: "00002222" })];
  it("chooses the statement whose last four match the bank account", () => {
    expect(pickStatement(both, "••••2222")).toBe(1);
  });
  it("falls back to the first when nothing matches or the account has no number", () => {
    expect(pickStatement(both, "••••9999")).toBe(0);
    expect(pickStatement(both, null)).toBe(0);
  });
});

describe("summarizeStatement", () => {
  it("says a statement proves when opening plus the lines is the closing balance", () => {
    const summary = summarizeStatement(statement(), usd);
    expect(summary).toEqual({
      moneyIn: { count: 1, minor: 50000 },
      moneyOut: { count: 2, minor: 32000 },
      proves: true,
      proof: "Opening $1,000.00 + lines $180.00 = $1,180.00, the closing balance on the statement.",
    });
  });

  it("writes money going out as a minus", () => {
    const summary = summarizeStatement(statement({ closingMinor: 68000, lines: [line(-32000)] }), usd);
    expect(summary.proof).toBe("Opening $1,000.00 − lines $320.00 = $680.00, the closing balance on the statement.");
  });

  it("says by how much a statement is out", () => {
    const summary = summarizeStatement(statement({ closingMinor: 120000 }), usd);
    expect(summary.proves).toBe(false);
    expect(summary.proof).toBe(
      "Out by $20.00: opening $1,000.00 + lines $180.00 comes to $1,180.00, and the statement closes at $1,200.00. " +
        "A line may not have been read — check before importing.",
    );
  });

  it("says a statement without its balances cannot prove itself", () => {
    const summary = summarizeStatement(statement({ openingMinor: null }), usd);
    expect(summary.proves).toBe(false);
    expect(summary.proof).toBe("The statement shows no opening or closing balance, so it cannot prove itself.");
  });

  it("shows nothing paid out as $0.00, not -$0.00", () => {
    const summary = summarizeStatement(statement({ closingMinor: 150000, lines: [line(50000)] }), usd);
    expect(summary.moneyOut).toEqual({ count: 0, minor: 0 });
    expect(Object.is(summary.moneyOut.minor, -0)).toBe(false);
    expect(usd(summary.moneyOut.minor)).toBe("$0.00");
  });
});

describe("skippedNote", () => {
  it("counts the lines left out", () => {
    expect(skippedNote(1)).toBe("1 line dated a day that does not exist was left out.");
    expect(skippedNote(2)).toBe("2 lines dated a day that does not exist were left out.");
  });
});
