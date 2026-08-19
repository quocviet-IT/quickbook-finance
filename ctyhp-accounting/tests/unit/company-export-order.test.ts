import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  EXPORT_TABLES,
  SENSITIVE_TABLE,
  ORDER_COLUMNS,
  orderColumnsFor,
} from "@/lib/domain/company-export";
import { collectExportDatasets } from "@/lib/services/company-export";

const EXPORTED = [...EXPORT_TABLES, SENSITIVE_TABLE];

/**
 * Records what the export asked the database for.
 *
 * The point is not the rows that come back — it is that an order was requested
 * at all. `readTable` pages with `.range()`, and an unordered paged read can
 * hand back page 2 with rows page 1 already had.
 */
function recordingClient(): { sb: SupabaseClient; ordered: () => Record<string, string[]> } {
  const ordered: Record<string, string[]> = {};
  const sb = {
    from(table: string) {
      const chain = {
        select: () => chain,
        order: (column: string) => {
          (ordered[table] ??= []).push(column);
          return chain;
        },
        range: () => Promise.resolve({ data: [], error: null }),
      };
      return chain;
    },
  } as unknown as SupabaseClient;
  return { sb, ordered: () => ordered };
}

describe("reading a table for the export", () => {
  it("asks for an order on every table it reads", async () => {
    const { sb, ordered } = recordingClient();
    await collectExportDatasets(sb);
    for (const table of EXPORTED) {
      expect(ordered()[table], `${table} was read without an order`).toEqual(
        orderColumnsFor(table),
      );
    }
  });

  it("orders every exported table by something, defaulting to id", () => {
    for (const table of EXPORTED) {
      expect(orderColumnsFor(table).length, `${table} has no order column`).toBeGreaterThan(0);
    }
    expect(orderColumnsFor("acc_journal_line")).toEqual(["id"]);
  });

  it("never names a column the table does not declare", () => {
    // The test that would have caught the original mistake. Eight exported
    // tables key on text and have no `id` at all, and Postgres validates an
    // ORDER BY column whether or not the table has rows — so a wrong name here
    // is not a subtle drift, it is an export that throws.
    const dir = join(process.cwd(), "supabase/migrations");
    const sql = [
      ...readdirSync(dir)
        .filter((name) => name.endsWith(".sql"))
        .map((name) => readFileSync(join(dir, name), "utf8")),
      // acc_schema_migrations records which migrations have run, so it can't
      // be created by a tracked migration itself — that's circular. Its real
      // definition lives here, run once before any tracked migration does.
      readFileSync(join(process.cwd(), "scripts/migrate.mjs"), "utf8"),
    ].join("\n");

    for (const [table, columns] of Object.entries(ORDER_COLUMNS)) {
      expect(EXPORTED, `${table} is in ORDER_COLUMNS but is not exported`).toContain(table);
      // `create table x (` or `create table if not exists x (`, then everything
      // up to the closing paren of the statement. migrate.mjs's copy closes
      // indented (`  );`), so the terminator tolerates leading whitespace.
      const match = new RegExp(
        String.raw`create table (?:if not exists )?${table}\s*\(([\s\S]*?)\n\s*\);`,
        "i",
      ).exec(sql);
      expect(match, `no create table statement found for ${table}`).not.toBeNull();
      for (const column of columns) {
        expect(
          match?.[1],
          `${table} is ordered by ${column}, which it does not declare`,
        ).toMatch(new RegExp(String.raw`^\s*${column}\b`, "m"));
      }
    }
  });
});
