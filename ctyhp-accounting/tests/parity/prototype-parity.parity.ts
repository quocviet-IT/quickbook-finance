import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { loadMigrationSources } from "@/lib/db/migration-sources";
import { compareFigures, pairFigures } from "@/lib/parity/compare";
import { compareEntries, type DriftEntry } from "@/lib/parity/drift";
import { unreadNetIncome } from "@/lib/parity/read-check";
import { renderParityReport, type BookReport, type ParityReport, type ShotRecord } from "@/lib/parity/report-html";
import type { PrototypeBook } from "@/lib/parity/types";
import { readLiveEntries } from "./drift-live";
import { loadIntoThrowaway, readOnebookFigures } from "./onebook";
import { captureScreens, openPrototype, readPrototype } from "./prototype";

/**
 * The prototype-parity harness (docs/superpowers/specs/2026-10-02-parity-harness-design.md).
 *
 *   PARITY_PROTOTYPE_HTML  the built prototype, accounting-system.html (required)
 *   PARITY_OUT_DIR         where results go (default C:/Users/pit010/OneBook-parity-2.28 — outside the repository)
 *   PARITY_SKIP_SHOTS=1    skip the screenshots
 *   PARITY_LIVE_SCHEMA     a live company's schema (co_…) to compare entry by entry (optional; read-only)
 *   PARITY_LIVE_BOOK       which prototype book it holds: the book's id, or part of its name (with PARITY_LIVE_SCHEMA)
 *   PARITY_ACCOUNT_MAP     a local JSON file { "<prototype account>": "<OneBook account code>" } (optional)
 *
 * Each book is posted into a throwaway company inside ONE transaction that is
 * always rolled back. The console prints counts only.
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
    "measures every book against OneBook, and writes the report outside the repository",
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
        console.log(`parity: read ${books.length} book(s); ${shots.length} screenshot(s), ${shots.filter((s) => s.error).length} failed`);
        const unread = books.flatMap(unreadNetIncome);
        console.log(`parity: ${unread.length} Profit and Loss year(s) with Net Income unread`);

        const client = new pg.Client({
          connectionString: process.env.SUPABASE_DB_URL,
          ssl: { rejectUnauthorized: false },
          connectionTimeoutMillis: 30_000,
        });
        await client.connect();
        const reports: BookReport[] = [];
        let drift: ParityReport["drift"] = null;
        try {
          const admin = (
            await client.query("select id from public.acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1")
          ).rows[0] as { id: string } | undefined;
          if (!admin) throw new Error("no active administrator to post as");
          const sources = loadMigrationSources(process.cwd());
          for (const book of books) {
            await client.query("begin");
            try {
              await client.query("set local lock_timeout = '10s'");
              const loaded = await loadIntoThrowaway(client, book, sources, admin.id);
              const onebook = await readOnebookFigures(client, book, loaded);
              const comparison = compareFigures(pairFigures(book.figures, onebook), {
                notLoaded: loaded.notLoaded.map((e) => ({ date: e.date, accounts: e.accounts })),
                closingDates: book.entries.filter((e) => e.closing).map((e) => e.date),
              });
              reports.push({
                name: book.name,
                accounts: book.accounts.length,
                entries: book.entries.length,
                loaded: loaded.loaded,
                notLoaded: loaded.notLoaded.map(({ id, date, problem }) => ({ id, date, problem })),
                months: book.monthEnds.length,
                fiscalYears: book.fiscalYears.length,
                comparison,
              });
              console.log(
                `parity: book ${reports.length}: ${loaded.loaded} of ${book.entries.length} entries loaded; ` +
                  `${comparison.compared} figures, ${comparison.agreed} agree, ${comparison.differences.length} differ`,
              );
            } finally {
              await client.query("rollback");
            }
          }

          const liveSchema = env("PARITY_LIVE_SCHEMA");
          const liveBook = env("PARITY_LIVE_BOOK");
          if (liveSchema && liveBook) {
            const book = books.find((b) => b.id === liveBook || b.name.toLowerCase().includes(liveBook.toLowerCase()));
            if (!book) throw new Error("PARITY_LIVE_BOOK names no book in the prototype");
            const mapPath = env("PARITY_ACCOUNT_MAP");
            const codes = mapPath
              ? new Map(Object.entries(JSON.parse(readFileSync(mapPath, "utf8")) as Record<string, string>))
              : null;
            await client.query("begin read only");
            try {
              const live = await readLiveEntries(client, liveSchema, codes !== null);
              const prototype: DriftEntry[] = book.entries.map((entry) => {
                const postings = entry.postings.filter((p) => p.cents !== 0);
                return {
                  id: entry.id,
                  date: entry.date,
                  amounts: postings.map((p) => p.cents),
                  accounts: codes ? postings.map((p) => codes.get(p.account) ?? `?${p.account}`) : null,
                  label: entry.description,
                };
              });
              drift = { schema: liveSchema, book: book.name, result: compareEntries(prototype, live) };
              console.log(
                `parity: data pass: ${drift.result.matched} matched, ${drift.result.onlyPrototype.length} only in the prototype, ` +
                  `${drift.result.onlyOnebook.length} only in OneBook, ${drift.result.accountsDiffer.length} on other accounts`,
              );
            } finally {
              await client.query("rollback");
            }
          }
        } finally {
          await client.end();
        }

        const report: ParityReport = { generatedAt: new Date().toISOString(), prototypeFile: htmlPath, books: reports, drift, shots };
        writeFileSync(join(outDir, "parity-report.html"), renderParityReport(report), "utf8");
        writeFileSync(join(outDir, "parity-result.json"), JSON.stringify(report, null, 2), "utf8");
        console.log(`parity: report written to ${join(outDir, "parity-report.html")}`);
        expect(books.length).toBeGreaterThan(0);
        expect(reports).toHaveLength(books.length);
        expect(unread).toEqual([]);
      } finally {
        clearTimeout(killer);
      }
    },
    HOUR,
  );
});
