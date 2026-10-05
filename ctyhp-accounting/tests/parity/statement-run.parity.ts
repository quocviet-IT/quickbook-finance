import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/csv";
import { detectDateOrder, detectStatementColumns, parseStatementRows } from "@/lib/domain/statement-import";
import { monthsFromCsv } from "@/lib/domain/statement-run";
import { openPrototype } from "./prototype";

/**
 * Cutting a CSV export into monthly statements, against the prototype's own
 * readStatementText (src/p44.html), in its own page: the same invented files go
 * through both, and each month's dates, opening and closing balances and lines
 * must be the same — except where a file listed newest first has two lines on
 * a month's first or last day. There the prototype opens or closes the month on
 * the wrong line (it keeps the file's order within a day), and OneBook must
 * differ; each such file says which month and why.
 *
 *   PARITY_PROTOTYPE_HTML  the built prototype, accounting-system.html (required)
 *
 * Run: npm run parity
 */
interface Month {
  from: string;
  to: string;
  opening: number | null;
  closing: number | null;
  lines: [string, number][];
}

interface Scenario {
  name: string;
  csv: string;
  /**
   * Months where OneBook departs on purpose: the opening and closing the
   * prototype reads, and the ones the file's balances truly give.
   */
  departs?: Record<string, { prototype: [number, number]; truly: [number, number] }>;
}

const SCENARIOS: Scenario[] = [
  {
    name: "oldestFirstSignedAmount",
    csv: [
      "Date,Description,Amount,Balance",
      "07/03/2026,DEPOSIT 0042,500.00,1500.00",
      "07/20/2026,CARD PURCHASE EXAMPLE STORE,-25.00,1475.00",
      "07/31/2026,SERVICE FEE,-5.00,1470.00",
      "08/02/2026,CHECK 1201,-75.00,1395.00",
      "08/31/2026,DEPOSIT 0043,10.00,1405.00",
    ].join("\n"),
  },
  {
    name: "withdrawalsAndDeposits",
    csv: [
      "Date,Description,Withdrawals,Deposits,Balance",
      "09/01/2026,OPENING DEPOSIT,,1000.00,1000.00",
      "09/15/2026,RENT,400.00,,600.00",
      "10/01/2026,PAYROLL,,250.00,850.00",
      "10/02/2026,UTILITY,50.00,,800.00",
    ].join("\n"),
  },
  {
    name: "newestFirstOneLineADay",
    csv: [
      "Date,Description,Amount,Balance",
      "08/20/2026,DEPOSIT,100.00,1300.00",
      "08/05/2026,FEE,-10.00,1200.00",
      "07/28/2026,DEPOSIT,200.00,1210.00",
      "07/02/2026,PAYMENT,-90.00,1010.00",
    ].join("\n"),
  },
  {
    name: "newestFirstTwoLinesOnAMonthsEdges",
    csv: [
      "Date,Description,Amount,Balance",
      "07/31/2026,SECOND OF THE DAY,-3.00,992.00",
      "07/31/2026,FIRST OF THE DAY,-5.00,995.00",
      "07/02/2026,LATER,-50.00,1000.00",
      "07/02/2026,EARLIER,50.00,1050.00",
    ].join("\n"),
    // In time order: +50.00 to 1,050.00, -50.00 to 1,000.00, -5.00 to 995.00,
    // -3.00 to 992.00. The month opens at 1,000.00 and closes at 992.00; the
    // prototype opens it on the LATER line and closes it on the FIRST.
    departs: { "2026-07-31": { prototype: [105000, 99500], truly: [100000, 99200] } },
  },
  {
    name: "noBalanceColumn",
    csv: ["Date,Description,Amount", "07/03/2026,DEPOSIT,500.00", "08/04/2026,FEE,-5.00"].join("\n"),
  },
];

function onebook(csv: string): Month[] {
  const records = parseCsv(csv);
  const headers = records.length ? Object.keys(records[0]) : [];
  const { columns } = detectStatementColumns(headers);
  const dateOrder = detectDateOrder(records.map((r) => (columns.date ? r[columns.date] ?? "" : "")));
  const { rows } = parseStatementRows(records, { columns, dateOrder });
  return monthsFromCsv("file.csv", rows).map((m) => ({
    from: m.from as string,
    to: m.to as string,
    opening: m.openingMinor,
    closing: m.closingMinor,
    lines: m.lines.map((l) => [l.txn_date, l.amount_minor] as [string, number]),
  }));
}

const RUN = `(function (csv) {
  var cents = function (x) { return x === undefined || x === null || isNaN(x) ? null : Math.round(x * 100); };
  var read = readStatementText(csv);
  return read.periods.map(function (p) {
    return {
      from: p.from, to: p.to, opening: cents(p.opening), closing: cents(p.closing),
      lines: p.lines.map(function (l) { return [l.date, cents(l.amount)]; })
    };
  });
})`;

describe("cutting a CSV into months against the prototype", () => {
  it("cuts every invented file as the prototype does, and departs only where it reads a newest-first file wrong", async () => {
    const htmlPath = process.env.PARITY_PROTOTYPE_HTML?.trim();
    if (!htmlPath) throw new Error("Set PARITY_PROTOTYPE_HTML to the prototype's accounting-system.html");
    const browser = await chromium.launch();
    try {
      const page = await openPrototype(browser, htmlPath);
      let agreed = 0;
      let departed = 0;
      for (const scenario of SCENARIOS) {
        const prototype = (await page.evaluate(`${RUN}(${JSON.stringify(scenario.csv)})`)) as Month[];
        const ours = onebook(scenario.csv);
        expect(ours.map((m) => m.to), scenario.name).toEqual(prototype.map((m) => m.to));
        for (const [i, month] of ours.entries()) {
          const label = `${scenario.name} ${month.to}`;
          const departure = scenario.departs?.[month.to];
          if (departure) {
            expect([prototype[i].opening, prototype[i].closing], `${label}: the prototype's reading`).toEqual(departure.prototype);
            expect([month.opening, month.closing], `${label}: OneBook's reading`).toEqual(departure.truly);
            expect(month.lines.slice().sort(), label).toEqual(prototype[i].lines.slice().sort());
            departed++;
          } else {
            expect(month, label).toEqual(prototype[i]);
            agreed++;
          }
        }
      }
      console.log(`parity: CSV months: ${agreed} agree with the prototype, ${departed} depart on purpose`);
    } finally {
      await browser.close();
    }
  }, 300_000);
});
