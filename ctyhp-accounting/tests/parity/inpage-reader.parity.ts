import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** The in-page reader on a blank page: the markup the prototype renders, without the prototype. */
const INPAGE = fileURLToPath(new URL("./prototype-inpage.js", import.meta.url));
let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.setContent("<!doctype html><title>reader</title>");
  await page.addScriptTag({ path: INPAGE });
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

const rowsOf = async (html: string) =>
  (await page.evaluate(`window.__parity.rowsOf(${JSON.stringify(html)})`)) as Record<string, number[]>;

describe("the prototype reader", () => {
  it("reads a figure that carries a percentage line in its own cell", async () => {
    const html =
      '<table><tr><td>Net Income<div class="pct-sub">as a percentage of total income</div></td>' +
      '<td class="r"><button>1,234.56</button><div class="pct-sub">61.73%</div></td></tr></table>';
    expect(await rowsOf(html)).toEqual({ "Net Income": [123456] });
  });
  it("reads a negative figure in parentheses, and skips a cell with no figure", async () => {
    const html =
      '<table><tr><td><strong>Gross Profit</strong></td><td class="r">(2,000.00)</td>' +
      '<td class="r"><div class="pct-sub"></div></td><td class="r">15.00</td></tr></table>';
    expect(await rowsOf(html)).toEqual({ "Gross Profit": [-200000, 1500] });
  });
});
