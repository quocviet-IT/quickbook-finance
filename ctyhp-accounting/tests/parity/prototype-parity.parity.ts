import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import type { ShotRecord } from "@/lib/parity/report-html";
import type { PrototypeBook } from "@/lib/parity/types";
import { captureScreens, openPrototype, readPrototype } from "./prototype";

/**
 * The prototype-parity harness (docs/superpowers/specs/2026-10-02-parity-harness-design.md).
 *
 *   PARITY_PROTOTYPE_HTML  the built prototype, accounting-system.html (required)
 *   PARITY_OUT_DIR         where results go (default C:/Users/pit010/OneBook-parity-2.28 — outside the repository)
 *   PARITY_SKIP_SHOTS=1    skip the screenshots
 *
 * Run: npm run parity
 */
const HOUR = 60 * 60 * 1000;
const env = (name: string): string | null => {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : null;
};

describe("prototype 2.28 parity", () => {
  it(
    "reads every book the prototype holds, and its screens",
    async () => {
      const htmlPath = env("PARITY_PROTOTYPE_HTML");
      if (!htmlPath) throw new Error("Set PARITY_PROTOTYPE_HTML to the prototype's accounting-system.html");
      const outDir = env("PARITY_OUT_DIR") ?? "C:/Users/pit010/OneBook-parity-2.28";
      mkdirSync(outDir, { recursive: true });
      const killer = setTimeout(() => {
        console.error("parity: hard timeout");
        process.exit(2);
      }, HOUR - 60_000);
      try {
        const browser = await chromium.launch();
        let books: PrototypeBook[] = [];
        let shots: ShotRecord[] = [];
        try {
          const page = await openPrototype(browser, htmlPath);
          books = await readPrototype(page);
          if (env("PARITY_SKIP_SHOTS") !== "1") shots = await captureScreens(page, join(outDir, "shots"));
        } finally {
          await browser.close();
        }
        for (const [i, book] of books.entries()) {
          console.log(
            `parity: book ${i + 1}: ${book.accounts.length} accounts, ${book.entries.length} entries, ` +
              `${book.monthEnds.length} month ends, ${book.fiscalYears.length} fiscal years`,
          );
        }
        console.log(`parity: ${shots.length} screenshot(s), ${shots.filter((s) => s.error).length} failed`);
        writeFileSync(join(outDir, "prototype-books.json"), JSON.stringify({ books, shots }, null, 2), "utf8");
        expect(books.length).toBeGreaterThan(0);
      } finally {
        clearTimeout(killer);
      }
    },
    HOUR,
  );
});
