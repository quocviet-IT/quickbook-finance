import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import type { PdfGlyph } from "@/lib/domain/pdf-statement";
import { readPdfStatements } from "@/lib/domain/pdf-statement";
import { PDF_SCENARIOS, glyphsOf } from "../fixtures/pdf-statements";
import { openPrototype } from "./prototype";

/**
 * The PDF statement reader against the prototype's own (src/p44.html): the same
 * glyphs go through its pdfRowsFrom, splitByAccount and readStatementRows, the
 * way its readStatementFile reads a PDF. The two must agree on every scenario
 * except those carrying `prototypeDiffers`, where OneBook deliberately does not
 * repeat a prototype defect — and there they must differ, or the scenario no
 * longer shows what it says it shows.
 *
 *   PARITY_PROTOTYPE_HTML  the built prototype, accounting-system.html (required)
 *
 * Run: npm run parity
 */
const READ = `(function (glyphs) {
  var pages = {};
  glyphs.forEach(function (g) {
    (pages[g.page] = pages[g.page] || []).push({ str: g.text, transform: [1, 0, 0, 1, g.x, g.y] });
  });
  var rows = [];
  Object.keys(pages).map(Number).sort(function (a, b) { return a - b; }).forEach(function (p) {
    rows = rows.concat(pdfRowsFrom(pages[p]));
  });
  var year = rows.map(function (r) { return r.text; }).join(" ").match(/[A-Za-z]{3,9}\\s+\\d{1,2},\\s*(\\d{4})/);
  var cents = function (v) { return isNaN(v) ? null : Math.round(v * 100); };
  return splitByAccount(rows).map(function (part) {
    var s = readStatementRows(part.rows);
    if (!s.to && year && part.rows.length) {
      var alt = readPeriod(part.rows.map(function (r) { return r.text; }).join("\\n") + "\\nJan 1, " + year[1]);
      if (alt.to) { s.to = alt.to; s.from = alt.from; }
    }
    return {
      account: part.acct || null, from: s.from || null, to: s.to || null,
      opening: cents(s.opening), closing: cents(s.closing),
      lines: s.lines.map(function (l) { return [l.date, cents(l.amount), l.desc, l.check || null, cents(l.bal)]; })
    };
  });
})`;

const onebook = (glyphs: PdfGlyph[]) =>
  readPdfStatements(glyphs).map((s) => ({
    account: s.accountNumber,
    from: s.from,
    to: s.to,
    opening: s.openingMinor,
    closing: s.closingMinor,
    lines: s.lines.map((l) => [l.date, l.amountMinor, l.description, l.checkNumber, l.balanceMinor]),
  }));

describe("PDF statements against the prototype", () => {
  it("reads every scenario as the prototype does, except where OneBook departs on purpose", async () => {
    const htmlPath = process.env.PARITY_PROTOTYPE_HTML?.trim();
    if (!htmlPath) throw new Error("Set PARITY_PROTOTYPE_HTML to the prototype's accounting-system.html");
    const browser = await chromium.launch();
    try {
      const page = await openPrototype(browser, htmlPath);
      let agreed = 0;
      let departed = 0;
      for (const scenario of PDF_SCENARIOS) {
        const glyphs = glyphsOf(scenario);
        const prototype = await page.evaluate(`${READ}(${JSON.stringify(glyphs)})`);
        if (scenario.prototypeDiffers) {
          expect(JSON.stringify(onebook(glyphs)), `${scenario.name}: ${scenario.prototypeDiffers}`).not.toBe(
            JSON.stringify(prototype),
          );
          departed++;
        } else {
          expect(onebook(glyphs), scenario.name).toEqual(prototype);
          agreed++;
        }
      }
      console.log(`parity: PDF statements: ${agreed} agree with the prototype, ${departed} depart on purpose`);
    } finally {
      await browser.close();
    }
  }, 300_000);
});
