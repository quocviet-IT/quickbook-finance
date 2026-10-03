import { describe, expect, it } from "vitest";
import { dollars, renderParityReport, type ParityReport } from "@/lib/parity/report-html";

const report = (over: Partial<ParityReport> = {}): ParityReport => ({
  generatedAt: "2026-10-02T10:00:00.000Z",
  prototypeFile: "C:/local/accounting-system.html",
  books: [
    {
      name: "Example <Co>",
      accounts: 3,
      entries: 10,
      loaded: 9,
      notLoaded: [{ id: "t9", date: "2026-01-05", problem: "does not balance by 1 cent(s)" }],
      months: 2,
      fiscalYears: 1,
      comparison: {
        compared: 4,
        agreed: 2,
        differences: [
          { kind: "balance", from: null, to: "2026-01-31", key: "Expenses:Rent", prototypeCents: 1000, onebookCents: 1001, diffCents: 1, tag: "rounding" },
          { kind: "profit_and_loss", from: "2026-01-01", to: "2026-12-31", key: "net", prototypeCents: -250, onebookCents: 125075, diffCents: 125325, tag: "new" },
        ],
      },
    },
  ],
  drift: null,
  shots: [],
  ...over,
});

describe("dollars", () => {
  it("prints cents as signed dollars with thousands separators", () => {
    expect(dollars(123456789)).toBe("1,234,567.89");
    expect(dollars(-250)).toBe("-2.50");
    expect(dollars(5)).toBe("0.05");
  });
});

describe("renderParityReport", () => {
  it("escapes every name and shows each difference with its tag", () => {
    const html = renderParityReport(report());
    expect(html).toContain("Example &lt;Co&gt;");
    expect(html).not.toContain("Example <Co>");
    expect(html).toContain("rounding");
    expect(html).toContain("1,250.75");
    expect(html).toContain("does not balance by 1 cent(s)");
    expect(html).not.toContain("Data pass");
  });
  it("lists the data pass when there is one", () => {
    const html = renderParityReport(
      report({
        drift: {
          schema: "co_example",
          book: "Example",
          result: {
            matched: 5,
            onlyPrototype: [{ id: "p1", date: "2026-01-05", amounts: [500, -500], accounts: null, label: "Rent <January>" }],
            onlyOnebook: [],
            accountsDiffer: [],
          },
        },
      }),
    );
    expect(html).toContain("Data pass");
    expect(html).toContain("Rent &lt;January&gt;");
  });
  it("shows each book's accounts in the summary", () => {
    const html = renderParityReport(report());
    expect(html).toContain("<th>Accounts</th>");
    expect(html).toContain('<td>Example &lt;Co&gt;</td><td class="r">3</td>');
  });
  it("says how many entries with other accounts were not shown", () => {
    const one = { id: "x", date: "2026-01-05", amounts: [500, -500], accounts: ["1000", "6100"], label: "Example" };
    const accountsDiffer = Array.from({ length: 501 }, () => ({ prototype: one, onebook: { ...one, accounts: ["1000", "6200"] } }));
    const html = renderParityReport(
      report({ drift: { schema: "co_example", book: "Example", result: { matched: 0, onlyPrototype: [], onlyOnebook: [], accountsDiffer } } }),
    );
    expect(html).toContain("1 more not shown.");
  });
});
