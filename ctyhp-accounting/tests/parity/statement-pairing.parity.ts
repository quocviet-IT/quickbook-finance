import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { matchStatement, type PairBookLine, type PairStatementLine } from "@/lib/domain/statement-pairing";
import { openPrototype } from "./prototype";

/**
 * Pairing statement lines with the books against the prototype's own recMatch
 * (src/p24.html), in its own page: the same statement lines and book lines go
 * through both, and the pairs, their order, how each was made, what is missing
 * and unseen, the sign flip and the ignored count must all be the same.
 *
 * The cases are generated from a fixed seed, so every run sees the same ones.
 * recMatch reads its book lines from recMath; the page lends it these instead
 * for the call, and puts recMath and UI.rec back afterwards.
 *
 *   PARITY_PROTOTYPE_HTML  the built prototype, accounting-system.html (required)
 *
 * Run: npm run parity
 */
const CASES = 400;

function cases(count: number) {
  let seed = 7;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = <T,>(values: readonly T[]) => values[Math.floor(rand() * values.length)];
  const day = (d: number) => `2026-09-${String(d).padStart(2, "0")}`;
  const amounts = [500, 1200, 5000, 12000, 50000, -500, -1200, -5000, -12000, -50000];
  return Array.from({ length: count }, () => {
    const lines: PairStatementLine[] = Array.from({ length: 1 + Math.floor(rand() * 7) }, (_, i) => ({
      lineNo: i,
      date: day(1 + Math.floor(rand() * 30)),
      amountMinor: pick(amounts),
      reference: pick(["", "1201", "1202", "x-9", "1201 "]) || null,
    }));
    const book: PairBookLine[] = Array.from({ length: Math.floor(rand() * 8) }, (_, k) => ({
      id: `T${k}|0`,
      date: day(1 + Math.floor(rand() * 30)),
      amountMinor: pick(amounts),
      reference: pick(["", "1201", "1202", "x-9"]) || null,
    }));
    return { lines, book, statementDate: day(20 + Math.floor(rand() * 11)) };
  });
}

const RUN = `(function (lines, open, statementDate) {
  var savedMath = recMath, savedRec = UI.rec;
  try {
    recMath = function () { return { lines: open }; };
    UI.rec = { statementDate: statementDate, ticks: {}, imp: { lines: lines } };
    recMatch();
    var imp = UI.rec.imp;
    return {
      pairs: imp.pairs.map(function (p) { return [p.line.i, tickKey(p.book), p.how]; }),
      missing: imp.missing.map(function (l) { return l.i; }),
      unseen: imp.unseen.map(function (r) { return tickKey(r); }),
      flipped: imp.flipped,
      ignored: imp.ignored
    };
  } finally {
    recMath = savedMath;
    UI.rec = savedRec;
  }
})`;

describe("statement pairing against the prototype", () => {
  it(`pairs ${CASES} generated statements exactly as the prototype's recMatch does`, async () => {
    const htmlPath = process.env.PARITY_PROTOTYPE_HTML?.trim();
    if (!htmlPath) throw new Error("Set PARITY_PROTOTYPE_HTML to the prototype's accounting-system.html");
    const browser = await chromium.launch();
    try {
      const page = await openPrototype(browser, htmlPath);
      let pairs = 0;
      for (const [n, c] of cases(CASES).entries()) {
        const protoLines = c.lines.map((l) => ({
          i: l.lineNo,
          date: l.date,
          amount: l.amountMinor / 100,
          check: (l.reference ?? "").replace(/[^0-9A-Za-z-]/g, ""),
        }));
        const protoBook = c.book.map((b) => ({
          t: { id: b.id.split("|")[0], ref: b.reference ?? "" },
          i: 0,
          date: b.date,
          amount: b.amountMinor / 100,
        }));
        const prototype = await page.evaluate(
          `${RUN}(${JSON.stringify(protoLines)}, ${JSON.stringify(protoBook)}, ${JSON.stringify(c.statementDate)})`,
        );
        const ours = matchStatement(c.lines, c.book, c.statementDate);
        pairs += ours.pairs.length;
        expect(
          {
            pairs: ours.pairs.map((p) => [p.line.lineNo, p.book.id, p.how]),
            missing: ours.missing.map((l) => l.lineNo),
            unseen: ours.unseen.map((b) => b.id),
            flipped: ours.flipped,
            ignored: ours.ignored,
          },
          `case ${n}`,
        ).toEqual(prototype);
      }
      console.log(`parity: statement pairing: ${CASES} statements, ${pairs} pairs, all as the prototype pairs them`);
    } finally {
      await browser.close();
    }
  }, 300_000);
});
