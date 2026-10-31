import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { JOURNAL_DEFAULT_PAGE_SIZE, journalPageSize } from "@/lib/domain/journal-paging";
import { listJournalEntries, readJournalPage } from "@/lib/services/journal";

/**
 * 2.93: the Journal pages on the server.
 *
 * It read the newest 1,000 entries in one go and paged them in the browser:
 * 538 KB for the largest company to show 20 rows (2.47 s on production, 31/10),
 * and no entry older than the thousandth could be reached without narrowing
 * the dates. A page is read now, beside the count of everything that matches.
 */
type Call = { table: string; op: string; args: unknown[] };

function recordingClient(count: number): { sb: SupabaseClient; calls: Call[] } {
  const calls: Call[] = [];
  const sb = {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      for (const op of ["select", "order", "range", "limit", "gte", "lte", "eq"]) {
        chain[op] = (...args: unknown[]) => {
          calls.push({ table, op, args });
          return chain;
        };
      }
      chain.then = (resolve: (value: unknown) => void) =>
        resolve(table === "acc_journal_entry" ? { data: [], count, error: null } : { data: [], error: null });
      return chain;
    },
  } as unknown as SupabaseClient;
  return { sb, calls };
}

describe("journal page size", () => {
  it("is one the screen offers: the size asked, or the next above it, at most 100", () => {
    expect(journalPageSize(20)).toBe(20);
    expect(journalPageSize(25)).toBe(50);
    expect(journalPageSize(1)).toBe(10);
    expect(journalPageSize(5000)).toBe(100);
    expect(journalPageSize(Number.NaN)).toBe(JOURNAL_DEFAULT_PAGE_SIZE);
  });
});

describe("reading one page of the journal", () => {
  it("reads only the rows of the page asked, newest first with a key no two entries share, and counts them all", async () => {
    const { sb, calls } = recordingClient(5111);
    const page = await readJournalPage(sb, { from: "2026-01-01", to: null }, 3, 20);
    expect(page).toEqual({ entries: [], total: 5111, pageIndex: 3, pageSize: 20 });
    const entryReads = calls.filter((c) => c.table === "acc_journal_entry");
    expect(entryReads.filter((c) => c.op === "range").map((c) => c.args)).toEqual([[40, 59]]);
    expect(entryReads.some((c) => c.op === "limit")).toBe(false);
    expect(entryReads.filter((c) => c.op === "order").map((c) => c.args[0])).toEqual(["entry_date", "entry_number", "id"]);
    // The count carries the same date filter as the page.
    expect(entryReads.filter((c) => c.op === "gte").map((c) => c.args)).toEqual([
      ["entry_date", "2026-01-01"],
      ["entry_date", "2026-01-01"],
    ]);
  });

  it("starts at the first page for a page number that is not one, and keeps the size to the offered ones", async () => {
    const { sb, calls } = recordingClient(0);
    const page = await readJournalPage(sb, {}, 0, 33);
    expect([page.pageIndex, page.pageSize]).toEqual([1, 50]);
    expect(calls.find((c) => c.op === "range")?.args).toEqual([0, 49]);
  });

  it("refuses to page by account, which filters after the read", async () => {
    const { sb } = recordingClient(0);
    await expect(listJournalEntries(sb, { accountId: "a1" }, { offset: 0, limit: 20 })).rejects.toThrow("cannot be paged by account");
  });

  it("keeps the newest 1,000 for everyone else who reads the journal", async () => {
    const { sb, calls } = recordingClient(0);
    await listJournalEntries(sb, {});
    expect(calls.find((c) => c.op === "limit")?.args).toEqual([1000]);
    expect(calls.some((c) => c.op === "range")).toBe(false);
  });
});

describe("the Journal screen", () => {
  const client = readFileSync(join(process.cwd(), "app/(app)/journal/JournalClient.tsx"), "utf8");

  it("hands the table one page and the total, and reads the next page when it is asked for", () => {
    expect(client).toContain("page={{ rows: entries, total: journal.total, pageIndex: journal.pageIndex, pageSize: journal.pageSize }}");
    expect(client).toMatch(/onChange: \(pageIndex, pageSize\) => void load\(range, pageSize === journal\.pageSize \? pageIndex : 1, pageSize\)/);
    expect(client).toContain("resultCount={journal.total}");
  });

  it("no longer warns that older entries are out of reach, because none are", () => {
    expect(client).not.toContain("most recent of");
    expect(client).not.toContain("One read carries at most");
  });

  it("takes its numbers from the pure module, not the server's service", () => {
    expect(client).toMatch(/from "@\/lib\/domain\/journal-paging"/);
    expect(client).toMatch(/import type \{ JournalEntrySummary, JournalPage \} from "@\/lib\/services\/journal"/);
  });
});
