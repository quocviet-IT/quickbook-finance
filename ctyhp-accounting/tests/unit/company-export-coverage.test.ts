import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  EXCLUDED_TABLES,
  EXPORT_TABLES,
  ORDER_COLUMNS,
  RECORD_KIND_LABELS,
  recordKindLabel,
  SENSITIVE_TABLE,
  TABLES_LEFT_OUT,
} from "@/lib/domain/company-export";
import { RESTORE_EXCLUDED_TABLES, SEEDED_KEY_TABLES } from "@/lib/services/backup-restore";

/**
 * 3.0.15: the export — which is also every nightly backup — had fallen 23
 * tables behind the migrations, among them adjusting-entry marks, inventory
 * write-downs and reconciliation statement lines. Nothing failed: the control
 * totals read only the ledger, AR and AP, so a restore still said "matched".
 * Two of those tables (0161, 0187) also point at restored tables with
 * `on delete set null`, which stopped every restore of every company.
 *
 * These tests read the migrations themselves, so a migration that adds a
 * table fails here until the table is exported or left out with a reason.
 */

const ROOT = process.cwd();

/**
 * Every migration in apply order, line endings normalised and `--` comments
 * removed. Read once: re-reading 190 files per table timed the suite out.
 */
const MIGRATIONS: ReadonlyArray<{ file: string; sql: string }> = (() => {
  const dir = join(ROOT, "supabase/migrations");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((file) => ({
      file,
      sql: readFileSync(join(dir, file), "utf8").replaceAll("\r\n", "\n").replace(/--[^\n]*/g, ""),
    }));
})();

function migrations(): ReadonlyArray<{ file: string; sql: string }> {
  return MIGRATIONS;
}

/**
 * The tables of a company schema, by the migration that created each. A
 * schema-qualified name (onebook.company) is the platform's, not a company's,
 * and does not match `[a-z_][a-z0-9_]*\s*\(`. acc_schema_migrations is created
 * by scripts/migrate.mjs before any tracked migration runs.
 */
function companyTables(): Map<string, string> {
  const created = new Map<string, string>([["acc_schema_migrations", "scripts/migrate.mjs"]]);
  for (const { file, sql } of migrations()) {
    for (const match of sql.matchAll(/\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)\s*\(/gi)) {
      created.set(match[1].toLowerCase(), file);
    }
    for (const match of sql.matchAll(/\bdrop\s+table\s+(?:if\s+exists\s+)?([a-z_][a-z0-9_]*)\b/gi)) {
      created.delete(match[1].toLowerCase());
    }
    for (const match of sql.matchAll(/\balter\s+table\s+(?:if\s+exists\s+)?([a-z_][a-z0-9_]*)\s+rename\s+to\s+([a-z_][a-z0-9_]*)/gi)) {
      const from = created.get(match[1].toLowerCase());
      created.delete(match[1].toLowerCase());
      if (from) created.set(match[2].toLowerCase(), file);
    }
  }
  return created;
}

/** The body of a table's `create table` statement, between its parentheses. */
function createBody(table: string): string | null {
  for (const { sql } of migrations()) {
    const match = new RegExp(
      String.raw`create table (?:if not exists )?${table}\s*\(([\s\S]*?)\n\s*\);`,
      "i",
    ).exec(sql);
    if (match) return match[1];
  }
  return null;
}

interface ForeignKeyEdge {
  file: string;
  fromTable: string;
  toTable: string;
  onDelete: string;
}

/**
 * Every foreign key the migrations declare between two company tables, inline
 * (`col uuid references t (id) on delete set null`) or as a table constraint,
 * in a `create table` or an `alter table`.
 */
function foreignKeyEdges(): ForeignKeyEdge[] {
  const edges: ForeignKeyEdge[] = [];
  for (const { file, sql } of migrations()) {
    for (const statement of sql.split(";")) {
      const head = /^\s*(?:create\s+table\s+(?:if\s+not\s+exists\s+)?|alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?)([a-z_][a-z0-9_]*)\b/i.exec(
        statement,
      );
      if (!head) continue;
      for (const reference of statement.matchAll(
        /\breferences\s+([a-z_][a-z0-9_]*)\s*(?:\([^)]*\))?((?:\s+(?:on\s+(?:delete|update)\s+(?:set\s+null|set\s+default|cascade|restrict|no\s+action)|match\s+(?:full|simple|partial)|(?:not\s+)?deferrable|initially\s+(?:deferred|immediate)))*)/gi,
      )) {
        const onDelete = /on\s+delete\s+(set\s+null|set\s+default|cascade|restrict|no\s+action)/i.exec(reference[2]);
        edges.push({
          file,
          fromTable: head[1].toLowerCase(),
          toTable: reference[1].toLowerCase(),
          onDelete: (onDelete?.[1] ?? "no action").toLowerCase().replace(/\s+/g, " "),
        });
      }
    }
  }
  return edges;
}

const EXPORTED = [...EXPORT_TABLES, SENSITIVE_TABLE];
const LEFT_OUT = Object.keys(TABLES_LEFT_OUT);

describe("which company tables the export carries", () => {
  it("carries every table a migration creates, or names why it does not", () => {
    const accounted = new Set([...EXPORTED, ...LEFT_OUT]);
    const unaccounted = [...companyTables()]
      .filter(([table]) => !accounted.has(table))
      .map(([table, file]) => `${table} (${file})`);
    expect(
      unaccounted,
      "Add each to EXPORT_TABLES, or to TABLES_LEFT_OUT with the reason it stays out " +
        "(lib/domain/company-export.ts). A table in neither is missing from every backup, " +
        "and no control total will notice.",
    ).toEqual([]);
  });

  it("names no table that no migration creates", () => {
    const created = companyTables();
    expect([...EXPORTED, ...LEFT_OUT].filter((table) => !created.has(table))).toEqual([]);
  });

  it("never both carries a table and leaves it out", () => {
    expect(EXPORTED.filter((table) => LEFT_OUT.includes(table))).toEqual([]);
  });

  it("gives each table it leaves out a reason a person can read", () => {
    for (const [table, reason] of Object.entries(TABLES_LEFT_OUT)) {
      expect(reason.length, `${table} needs a real reason`).toBeGreaterThan(30);
    }
  });

  it("lists every table it leaves out in the manifest", () => {
    // manifest.json's excludedTables is what a reader of the archive sees.
    expect([...EXCLUDED_TABLES].sort()).toEqual([...LEFT_OUT].sort());
  });

  it("knows how to order every exported table that has no id column", () => {
    // readTable pages by `order by id` unless ORDER_COLUMNS says otherwise,
    // and Postgres rejects an order by a column the table does not have — so
    // one missing entry here fails the whole nightly backup, every company.
    const withoutOrder = EXPORTED.filter((table) => {
      if (ORDER_COLUMNS[table]) return false;
      const body = table === "acc_schema_migrations" ? null : createBody(table);
      return body !== null && !/^\s*id\b/m.test(body);
    });
    expect(withoutOrder).toEqual([]);
  });
});

describe("naming what a restore brought back empty", () => {
  // The tables 3.0.15 added to the export: what an older snapshot lacks, and
  // so what the restore verdict lists by name.
  const ADDED_IN_3_0_15 = [
    "acc_cash_flow_close_snapshot",
    "acc_posting_default",
    "acc_number_gap_note",
    "acc_adjusting_entry",
    "acc_afda_rate",
    "acc_inventory_writedown",
    "acc_bank_rule",
    "acc_bank_category",
    "acc_banking_preference",
    "acc_import_batch_entry",
    "acc_import_batch_document",
    "acc_bank_feed_skip",
    "acc_reconciliation_statement_line",
    "acc_financial_analysis",
    "acc_work_policy",
    "acc_work_item_state",
  ];

  it("has a plain name for every table 3.0.15 added", () => {
    for (const table of ADDED_IN_3_0_15) {
      expect(EXPORTED, `${table} is exported`).toContain(table);
      expect(RECORD_KIND_LABELS[table], `${table} needs a plain name`).toBeTruthy();
    }
  });

  it("never shows a reader an acronym or a table name", () => {
    // The first live drill listed "Afda rate" and "Number gap note".
    expect(recordKindLabel("acc_afda_rate")).toBe("Doubtful-account reserve rates");
    for (const table of EXPORTED) {
      const label = recordKindLabel(table);
      expect(label, table).not.toMatch(/_|\bacc\b|\bafda\b/i);
      expect(label.charAt(0), table).toBe(label.charAt(0).toUpperCase());
    }
  });
});

describe("what a restore must be able to clear", () => {
  it("has no table outside the restore that a clear would silently rewrite", () => {
    // Clearing a restored table fires every `on delete set null` (or
    // `set default`) pointing at it. From a table the restore does not load,
    // that rewrites rows it never puts back — so the restore refuses whenever
    // such a table holds a value (lib/services/backup-restore.ts). Today none
    // does; a new edge of this kind must be exported, or this test answered.
    const restored = new Set(
      EXPORTED.filter((table) => !(RESTORE_EXCLUDED_TABLES as readonly string[]).includes(table)),
    );
    const company = companyTables();
    const rewriting = foreignKeyEdges()
      .filter(
        (edge) =>
          company.has(edge.fromTable) &&
          !restored.has(edge.fromTable) &&
          restored.has(edge.toTable) &&
          (edge.onDelete === "set null" || edge.onDelete === "set default"),
      )
      .map((edge) => `${edge.fromTable} -> ${edge.toTable} on delete ${edge.onDelete} (${edge.file})`);
    expect(rewriting).toEqual([]);
  });

  it("keys each seeded registry by columns its table declares, and restores it", () => {
    // A key column that does not exist would compare every row as "" and keep
    // every seeded row beside the snapshot's — a duplicate-key failure at best.
    for (const [table, keys] of Object.entries(SEEDED_KEY_TABLES)) {
      expect(EXPORTED, table).toContain(table);
      expect(RESTORE_EXCLUDED_TABLES as readonly string[], table).not.toContain(table);
      const body = createBody(table);
      for (const key of keys) {
        expect(body, `${table}.${key}`).toMatch(new RegExp(String.raw`^\s*${key}\b`, "m"));
      }
    }
  });

  it("reads the foreign keys it guards: the edge that stopped every restore is found", () => {
    // A parser that found nothing would pass the test above for the wrong reason.
    expect(foreignKeyEdges()).toContainEqual({
      file: "0187_posting_defaults.sql",
      fromTable: "acc_posting_default",
      toTable: "acc_account",
      onDelete: "set null",
    });
  });
});
