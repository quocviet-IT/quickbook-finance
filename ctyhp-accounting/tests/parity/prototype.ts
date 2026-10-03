import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Browser, Page } from "playwright";
import type { ShotRecord } from "@/lib/parity/report-html";
import type { PrototypeBook } from "@/lib/parity/types";

/**
 * The prototype side of the harness: open the built single file from disk in
 * a fresh browser profile (so it seeds its books as for any new visitor),
 * inject prototype-inpage.js, and let the prototype compute its own figures.
 * Every evaluate passes a string: a TypeScript function would carry
 * transform helpers the page does not have.
 */
const INPAGE = fileURLToPath(new URL("./prototype-inpage.js", import.meta.url));

export async function openPrototype(browser: Browser, htmlPath: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load", timeout: 120_000 });
  await page.waitForFunction(
    "typeof DB !== 'undefined' && DB.books && DB.books.length > 0 && typeof useBook === 'function' && typeof reportPL === 'function'",
    undefined,
    { timeout: 120_000 },
  );
  await page.addScriptTag({ path: INPAGE });
  await page.waitForFunction("typeof window.__parity === 'object'", undefined, { timeout: 10_000 });
  return page;
}

/** The settings a visitor's screen depends on. Reading must leave them as they were. */
const SCREEN_STATE = "JSON.stringify([DB.activeId, UI.basis, UI.compare, UI.showPct, UI.from, UI.to])";

export async function readPrototype(page: Page): Promise<PrototypeBook[]> {
  const before = await page.evaluate(SCREEN_STATE);
  const books = (await page.evaluate("window.__parity.read()")) as PrototypeBook[];
  if ((await page.evaluate(SCREEN_STATE)) !== before) throw new Error("Reading the prototype changed its screen settings");
  return books;
}

/** Every top-level tab and every report, for every book, in light and dark, at the window's 1440 × 900. */
export async function captureScreens(page: Page, outDir: string): Promise<ShotRecord[]> {
  mkdirSync(outDir, { recursive: true });
  const books = (await page.evaluate("window.__parity.books()")) as { id: string; name: string }[];
  const tabs = (await page.evaluate("window.__parity.tabs()")) as { key: string; name: string }[];
  const reports = (await page.evaluate("window.__parity.reports()")) as { key: string; name: string }[];
  const views = [
    ...tabs.filter((t) => t.key !== "reports").map((t) => ({ tab: t.key, report: null as string | null, name: t.name })),
    ...reports.map((r) => ({ tab: "reports", report: r.key, name: `Reports › ${r.name}` })),
  ];
  const shots: ShotRecord[] = [];
  for (const [index, book] of books.entries()) {
    for (const theme of ["light", "dark"] as const) {
      for (const view of views) {
        const file = `book${index + 1}-${theme}-${view.report ? `report-${view.report}` : `tab-${view.tab}`}.png`;
        try {
          await page.evaluate(
            `window.__parity.show(${JSON.stringify(book.id)}, ${JSON.stringify(view.tab)}, ${JSON.stringify(view.report)}, ${JSON.stringify(theme)})`,
          );
          await page.waitForTimeout(150);
          await page.screenshot({ path: join(outDir, file) });
          shots.push({ book: book.name, name: view.name, theme, file: `shots/${file}`, error: null });
        } catch (error) {
          shots.push({ book: book.name, name: view.name, theme, file: "", error: error instanceof Error ? error.message : String(error) });
        }
      }
    }
  }
  return shots;
}
