import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { SupabaseClient } from "@supabase/supabase-js";
import { strToU8, strFromU8, unzipSync, zipSync } from "fflate";
import { restoreCompatibility, snapshotDescription, snapshotHash } from "@/lib/domain/backup";
import {
  EXPORT_TABLES,
  SENSITIVE_TABLE,
  toCsv,
  type ExportControlTotals,
  type ExportDataset,
} from "@/lib/domain/company-export";
import { buildExportArchive, type ExportArchive } from "@/lib/services/company-export";
import {
  RESTORE_EXCLUDED_TABLES,
  RestoreError,
  compareControlTotals,
  parseCsvTable,
  restoreBackupIntoNewCompany,
} from "@/lib/services/backup-restore";
import type { MigrationSource } from "@/lib/db/migration-sources";
import type {
  PgLike,
  ProvisionCompanyInput,
  ProvisionCompanyResult,
} from "@/lib/services/company-provisioning";

// ---------------------------------------------------------------------------
// The rules a restore refuses to bend (from the task brief, verbatim).
// ---------------------------------------------------------------------------

describe("what a restore refuses to carry over", () => {
  it("does not restore the user list or its role assignments", () => {
    // Loading these into the copy would silently grant access to a set of books
    // nobody has said those people may see. The person who ran the restore is
    // the copy's only user; the books themselves restore in full.
    expect(RESTORE_EXCLUDED_TABLES).toContain("acc_app_user");
    expect(RESTORE_EXCLUDED_TABLES).toContain("acc_role_permission");
  });

  it("does not restore the permission catalog, which the kept role matrix cascades from", () => {
    // acc_role_permission.permission_key references acc_permission(key) with
    // `on delete cascade` (migration 0036). Replacing the catalog with the
    // snapshot's older copy would silently cascade-delete the very role matrix
    // the exclusion above deliberately kept.
    expect(RESTORE_EXCLUDED_TABLES).toContain("acc_permission");
  });

  it("does not restore the migration ledger of a schema that was just built", () => {
    // The copy was provisioned by today's migrations; overwriting its
    // acc_schema_migrations with the snapshot's older list would make the next
    // migration run replay files into a schema that already has them.
    expect(RESTORE_EXCLUDED_TABLES).toContain("acc_schema_migrations");
  });

  it("excludes only tables the export actually carries, so no exclusion can go dead", () => {
    // A rename in EXPORT_TABLES that leaves an exclusion behind would silently
    // turn that exclusion into a no-op — and the user list back on.
    for (const table of RESTORE_EXCLUDED_TABLES) {
      expect(EXPORT_TABLES).toContain(table);
    }
  });

  it("does restore the books, which is the whole point", () => {
    expect(RESTORE_EXCLUDED_TABLES).not.toContain("acc_journal_entry");
    expect(RESTORE_EXCLUDED_TABLES).not.toContain("acc_journal_line");
  });
});

describe("proving a restore came back whole", () => {
  const totals = {
    trialBalanceDebitMinor: 100,
    trialBalanceCreditMinor: 100,
    arTotalMinor: 5,
    apTotalMinor: 7,
    journalLineCount: 3,
  };

  it("reports a match when every figure agrees", () => {
    const result = compareControlTotals(totals, { ...totals });
    expect(result.controlTotalsMatch).toBe(true);
    expect(result.differences).toEqual([]);
  });

  it("names each figure that does not, rather than saying it failed", () => {
    const result = compareControlTotals(totals, { ...totals, journalLineCount: 2 });
    expect(result.controlTotalsMatch).toBe(false);
    expect(result.differences.join(" ")).toMatch(/journalLineCount.*3.*2/);
  });

  it("refuses a snapshot newer than the code reading it", () => {
    expect(restoreCompatibility("0200_later.sql", "0114_backups.sql")).toBe("snapshot-is-newer");
  });
});

// ---------------------------------------------------------------------------
// Reading the export's own CSV back. The writer is toCsv; these prove the
// reader undoes exactly what it did.
// ---------------------------------------------------------------------------

describe("parsing the export's CSV back into cells", () => {
  it("round-trips quotes, commas, line breaks and the formula guard", () => {
    // toCsv prefixes a leading =, +, - or @ with a quote so a spreadsheet
    // cannot execute the cell. "-42" is a negative number wearing that guard;
    // a parser that does not strip it would load "'-42" into a bigint column
    // and fail every amount below zero.
    const columns = ["a", "b", "c"];
    const rows = [
      { a: "=SUM(A1)", b: 'has "quotes", a comma,\r\nand a line break', c: "-42" },
      { a: "plain", b: "", c: null },
    ];
    const parsed = parseCsvTable(toCsv(rows, columns));
    expect(parsed.columns).toEqual(columns);
    expect(parsed.rows).toEqual([
      ["=SUM(A1)", 'has "quotes", a comma,\r\nand a line break', "-42"],
      // toCsv writes "" and null identically, so both come back as null here;
      // the loader is what turns null back into '' for a not-null column.
      ["plain", null, null],
    ]);
  });

  it("returns nothing for an empty table's empty file", () => {
    expect(parseCsvTable("")).toEqual({ columns: [], rows: [] });
  });

  it("throws on a row that does not fit the header, instead of guessing", () => {
    expect(() => parseCsvTable("a,b\r\nonly-one-cell")).toThrow(/2/);
  });

  it("throws on an unterminated quote, instead of loading half a file", () => {
    expect(() => parseCsvTable('a\r\n"unclosed')).toThrow(/quote/i);
  });
});

// ---------------------------------------------------------------------------
// The restore itself, against a real archive and fake infrastructure.
// ---------------------------------------------------------------------------

const CONTROL_TOTALS: ExportControlTotals = {
  trialBalanceDebitMinor: 100,
  trialBalanceCreditMinor: 100,
  arTotalMinor: 0,
  apTotalMinor: 0,
  journalLineCount: 2,
};

function fixtureDatasets(): ExportDataset[] {
  const make = (
    table: string,
    rows: Array<Record<string, unknown>>,
    sensitive = false,
  ): ExportDataset => ({ table, columns: Object.keys(rows[0] ?? {}), rows, sensitive });
  return [
    make("acc_schema_migrations", [{ filename: "0001_foundation.sql" }]),
    // symbol '' exercises the empty-but-not-null path below.
    make("acc_currency", [
      { code: "USD", name: "US Dollar", symbol: "", decimal_places: 2, is_base: true },
    ]),
    make("acc_permission", [{ key: "journal.post", label: "Post manual journals" }]),
    make("acc_role_permission", [
      { role: "admin", permission_key: "journal.post", allowed: true },
    ]),
    make("acc_app_user", [
      { id: "someone-from-the-source", full_name: "Source User", role: "admin", status: "active" },
    ]),
    // Child before parent on purpose: acc_account references itself, and only
    // a single INSERT statement per table survives that order (FKs are checked
    // at end of statement).
    make("acc_account", [
      { id: "acc-child", account_code: "1010", name: "Checking", parent_account_id: "acc-parent" },
      { id: "acc-parent", account_code: "1000", name: "Assets", parent_account_id: null },
    ]),
    make("acc_journal_entry", [
      { id: "je-1", entry_number: "JE-000001", entry_date: "2026-07-31", status: "posted" },
    ]),
    make("acc_journal_line", [
      {
        id: "jl-1",
        journal_entry_id: "je-1",
        account_id: "acc-child",
        debit_minor: 100,
        credit_minor: 0,
        amount_base_minor: 100,
        memo: "=SUM(A1)",
      },
      {
        id: "jl-2",
        journal_entry_id: "je-1",
        account_id: "acc-parent",
        debit_minor: 0,
        credit_minor: 100,
        amount_base_minor: -42,
        memo: 'has "quotes", a comma,\r\nand a line break',
      },
    ]),
    make("acc_document_attachment", [
      { id: "att-1", file_name: "receipt.pdf", storage_path: "docs/receipt.pdf", size_bytes: 123 },
    ]),
    make("acc_audit_log", [
      { id: "al-1", table_name: "acc_account", record_id: "acc-child", action: "update" },
    ]),
    make(SENSITIVE_TABLE, [{ id: "vt-1", vendor_id: "v-1", tin_ref: "xx-1234567" }], true),
  ];
}

async function fixtureArchive(): Promise<{ archive: ExportArchive; contentHash: string }> {
  const archive = await buildExportArchive({
    datasets: fixtureDatasets(),
    controlTotals: CONTROL_TOTALS,
    schemaVersion: "0113_earlier.sql",
    generatedAt: "2026-08-01T00:00:00.000Z",
  });
  return { archive, contentHash: await snapshotHash(snapshotDescription(archive.manifest)) };
}

interface SourceRow {
  id: string;
  taken_at: string;
  status: string;
  storage_path: string | null;
  content_hash: string;
  schema_version: string;
  control_totals: ExportControlTotals;
}

/**
 * The source company's client. Everything that is not the register read or the
 * signed-in-user lookup lands in `writes` — the "never writes to the source
 * company" rule is an assertion on that list staying empty, and would fail the
 * moment the service gained e.g. an `update` stamping the acc_backup row.
 */
function stubSourceClient(row: SourceRow | null) {
  const writes: string[] = [];
  const sb = {
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => Promise.resolve({ data: row, error: null }),
        insert: () => {
          writes.push(`insert into ${table}`);
          return Promise.resolve({ error: null });
        },
        update: () => {
          writes.push(`update ${table}`);
          return chain;
        },
        upsert: () => {
          writes.push(`upsert into ${table}`);
          return Promise.resolve({ error: null });
        },
        delete: () => {
          writes.push(`delete from ${table}`);
          return chain;
        },
      };
      return chain;
    },
    rpc: (fn: string) => {
      writes.push(`rpc ${fn}`);
      return Promise.resolve({ data: null, error: null });
    },
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: "restorer-1" } }, error: null }),
    },
    storage: {
      from: () => {
        writes.push("storage");
        return {};
      },
    },
  } as unknown as SupabaseClient;
  return { sb, writes };
}

interface PgCall {
  text: string;
  params?: unknown[];
}

function columnFixture(): Record<string, Array<{ name: string; nullable: boolean }>> {
  const fixture: Record<string, Array<{ name: string; nullable: boolean }>> = {};
  for (const dataset of fixtureDatasets()) {
    fixture[dataset.table] = dataset.columns.map((name) => ({
      name,
      nullable: !(dataset.table === "acc_currency" && name === "symbol"),
    }));
  }
  return fixture;
}

function fakeProvisioningClient(
  columns: Record<string, Array<{ name: string; nullable: boolean }>>,
) {
  const calls: PgCall[] = [];
  let ended = false;
  const client = {
    async query(text: string, params?: unknown[]) {
      calls.push({ text, params });
      if (/information_schema\.columns/.test(text)) {
        return {
          rows: Object.entries(columns).flatMap(([table, cols]) =>
            cols.map((column) => ({
              table_name: table,
              column_name: column.name,
              is_nullable: column.nullable ? "YES" : "NO",
            })),
          ),
        };
      }
      return { rows: [] };
    },
    async end() {
      ended = true;
    },
  };
  return { client, calls, isEnded: () => ended };
}

interface RunOverrides {
  row?: Partial<SourceRow> | null;
  bytes?: Uint8Array;
  columns?: Record<string, Array<{ name: string; nullable: boolean }>>;
  provision?: (
    client: PgLike,
    input: ProvisionCompanyInput,
    sources: readonly MigrationSource[],
  ) => Promise<ProvisionCompanyResult>;
  totals?: ExportControlTotals;
}

async function runRestore(overrides: RunOverrides = {}) {
  const { archive, contentHash } = await fixtureArchive();
  const row: SourceRow | null =
    overrides.row === null
      ? null
      : {
          id: "backup-1",
          taken_at: "2026-08-01",
          status: "stored",
          storage_path: "co-src/2026-08-01-abcd1234.zip",
          content_hash: contentHash,
          schema_version: "0113_earlier.sql",
          control_totals: CONTROL_TOTALS,
          ...overrides.row,
        };
  const source = stubSourceClient(row);
  const pg = fakeProvisioningClient(overrides.columns ?? columnFixture());
  const provisionInputs: ProvisionCompanyInput[] = [];
  const provisionSources: Array<readonly MigrationSource[]> = [];
  const totalsCalls: Array<{ schema: string; asOf: string }> = [];
  const downloads: string[] = [];
  let clientRequests = 0;

  const outcome = restoreBackupIntoNewCompany(source.sb, "backup-1", "Books Rebuilt", {
    createClient: async () => {
      clientRequests += 1;
      return pg.client;
    },
    provision:
      overrides.provision ??
      (async (_client, input, sources) => {
        provisionInputs.push(input);
        provisionSources.push(sources);
        return {
          companyId: "company-copy",
          schema: "co_copy",
          statementCount: 0,
          tableCount: 0,
          functionCount: 0,
          policyCount: 0,
        };
      }),
    loadSources: () => [
      { file: "0001_foundation.sql", sql: "" },
      { file: "0114_backups.sql", sql: "" },
    ],
    download: async (path) => {
      downloads.push(path);
      return overrides.bytes ?? archive.bytes;
    },
    readTotals: async (schema, asOf) => {
      totalsCalls.push({ schema, asOf });
      return overrides.totals ?? { ...CONTROL_TOTALS };
    },
  });

  return {
    outcome,
    archive,
    contentHash,
    source,
    pg,
    provisionInputs,
    provisionSources,
    totalsCalls,
    downloads,
    clientRequests: () => clientRequests,
  };
}

/** The table each data-load statement targets, in the order they ran. */
function mutationTargets(calls: PgCall[], verb: "delete" | "insert"): string[] {
  const pattern =
    verb === "delete"
      ? /^delete from "co_copy"\."([a-z0-9_]+)"/
      : /^insert into "co_copy"\."([a-z0-9_]+)"/;
  return calls
    .filter((call) => call.params === undefined)
    .map((call) => pattern.exec(call.text)?.[1])
    .filter((table): table is string => Boolean(table));
}

describe("restoring a snapshot into a new company", () => {
  it("loads the books, skips access tables, and reports the totals as matching", async () => {
    const run = await runRestore();
    const outcome = await run.outcome;

    expect(outcome.companyId).toBe("company-copy");
    expect(outcome.controlTotalsMatch).toBe(true);
    expect(outcome.differences).toEqual([]);
    expect(outcome.legalName).toBe("Books Rebuilt");

    const inserted = mutationTargets(run.pg.calls, "insert");
    // The whole books, including the two files that do not live under data/:
    // sensitive/vendor-tax.csv and attachments.csv. A restore reading only
    // data/*.csv would silently drop vendor tax profiles and the attachment
    // inventory — this is what catches that.
    for (const table of [
      "acc_currency",
      "acc_account",
      "acc_journal_entry",
      "acc_journal_line",
      "acc_document_attachment",
      "acc_audit_log",
      SENSITIVE_TABLE,
    ]) {
      expect(inserted).toContain(table);
    }
    for (const table of RESTORE_EXCLUDED_TABLES) {
      expect(inserted).not.toContain(table);
      expect(mutationTargets(run.pg.calls, "delete")).not.toContain(table);
    }
  });

  it("never issues a write against the source company's client", async () => {
    const run = await runRestore();
    await run.outcome;
    expect(run.source.writes).toEqual([]);
  });

  it("makes the person who ran the restore the copy's only user", async () => {
    const run = await runRestore();
    await run.outcome;
    expect(run.provisionInputs).toHaveLength(1);
    expect(run.provisionInputs[0].adminUserIds).toEqual(["restorer-1"]);
    expect(run.provisionInputs[0].legalName).toBe("Books Rebuilt");
    expect(run.provisionInputs[0].isSample).toBe(false);
    expect(run.provisionInputs[0].slug).toMatch(/^[a-z][a-z0-9_]{1,40}$/);
    expect(run.provisionSources[0]).toHaveLength(2);
  });

  it("clears seeded rows before loading, dependents first, and loads in dependency order", async () => {
    const run = await runRestore();
    await run.outcome;
    const deletes = mutationTargets(run.pg.calls, "delete");
    const inserts = mutationTargets(run.pg.calls, "insert");
    // Deletion order is exactly the load order reversed — the same dependency
    // ordering EXPORT_TABLES already encodes, read backwards so a dependent
    // row never blocks its parent's delete.
    expect(deletes).toEqual([...inserts].reverse());
    const lastDelete = run.pg.calls.findLastIndex((call) => /^delete from/.test(call.text));
    const firstInsert = run.pg.calls.findIndex((call) => /^insert into/.test(call.text));
    expect(lastDelete).toBeLessThan(firstInsert);
  });

  it("loads each table in a single statement, so a child row may precede its parent", async () => {
    // acc_account references itself and the export orders it by uuid, so a
    // child can come first. Foreign keys are checked at the end of a
    // statement; splitting a table across several INSERTs would reintroduce
    // an order the data never promised to have.
    const run = await runRestore();
    await run.outcome;
    const accountInserts = run.pg.calls.filter(
      (call) => call.params === undefined && /^insert into "co_copy"\."acc_account"/.test(call.text),
    );
    expect(accountInserts).toHaveLength(1);
    expect(accountInserts[0].text).toContain("'acc-child'");
    expect(accountInserts[0].text).toContain("'acc-parent'");
  });

  it("keeps the guard triggers out of the way exactly as long as the load runs", async () => {
    // The company schema carries triggers that block inserting into closed
    // periods, stamp rows with the current actor, and write audit rows —
    // all correct for bookkeeping, all wrong for a byte-faithful restore.
    const run = await runRestore();
    await run.outcome;
    const disabled = run.pg.calls.filter((call) => / disable trigger user$/.test(call.text));
    const enabled = run.pg.calls.filter((call) => / enable trigger user$/.test(call.text));
    expect(disabled.length).toBeGreaterThan(0);
    expect(enabled.length).toBe(disabled.length);
    const firstDisable = run.pg.calls.findIndex((call) => / disable trigger user$/.test(call.text));
    const firstMutation = run.pg.calls.findIndex((call) =>
      /^(delete from|insert into) "co_copy"/.test(call.text),
    );
    expect(firstDisable).toBeLessThan(firstMutation);
  });

  it("undoes the CSV formula guard and empty-cell encoding on the way in", async () => {
    const run = await runRestore();
    await run.outcome;
    const lineInsert = run.pg.calls.find(
      (call) =>
        call.params === undefined && /^insert into "co_copy"\."acc_journal_line"/.test(call.text),
    );
    expect(lineInsert).toBeDefined();
    // "'-42" (guarded) must come back as -42, or every negative amount fails.
    expect(lineInsert?.text).toContain("'-42'");
    expect(lineInsert?.text).not.toContain("''-42'");
    expect(lineInsert?.text).toContain("'=SUM(A1)'");
    // symbol is '' and NOT NULL: an empty cell must load as '', not null.
    const currencyInsert = run.pg.calls.find(
      (call) =>
        call.params === undefined && /^insert into "co_copy"\."acc_currency"/.test(call.text),
    );
    expect(currencyInsert?.text).toContain("('USD', 'US Dollar', '', '2', 'true')");
  });

  it("records where the copy came from, in the copy's own audit log", async () => {
    const run = await runRestore();
    await run.outcome;
    const provenance = run.pg.calls.find(
      (call) => call.params !== undefined && /insert into "co_copy"\."acc_audit_log"/.test(call.text),
    );
    expect(provenance).toBeDefined();
    expect(provenance?.params).toContain("backup-1");
    expect(provenance?.params).toContain("restorer-1");
  });

  it("checks the restored totals at the snapshot's own date, not today's", async () => {
    // Balances move with the reporting date — a future-dated entry is excluded
    // until its date arrives — so comparing at any other date would report a
    // difference that has nothing to do with the restore. Passing new Date()
    // here would fail this.
    const run = await runRestore();
    await run.outcome;
    expect(run.totalsCalls).toEqual([{ schema: "co_copy", asOf: "2026-08-01" }]);
  });

  it("still hands back the company when the totals do not match, naming each figure", async () => {
    // The point of restoring beside the running books is seeing which figures
    // are wrong and by how much. Rolling the copy back on a mismatch would
    // destroy the very evidence the comparison just produced.
    const run = await runRestore({ totals: { ...CONTROL_TOTALS, journalLineCount: 1 } });
    const outcome = await run.outcome;
    expect(outcome.companyId).toBe("company-copy");
    expect(outcome.controlTotalsMatch).toBe(false);
    expect(outcome.differences.join(" ")).toMatch(/journalLineCount.*2.*1/);
    expect(run.pg.calls.some((call) => call.text === "commit")).toBe(true);
    expect(run.pg.calls.some((call) => call.text === "rollback")).toBe(false);
  });

  it("commits everything or nothing: a failure mid-build rolls back and closes the connection", async () => {
    const run = await runRestore({
      provision: async () => {
        throw new Error("schema exploded");
      },
    });
    await expect(run.outcome).rejects.toThrow(/schema exploded/);
    expect(run.pg.calls.some((call) => call.text === "rollback")).toBe(true);
    expect(run.pg.calls.some((call) => call.text === "commit")).toBe(false);
    expect(run.pg.isEnded()).toBe(true);
  });
});

describe("what a restore refuses to load at all", () => {
  it("refuses a snapshot that is not stored, because there is no file to load", async () => {
    const run = await runRestore({ row: { status: "skipped", storage_path: null } });
    await expect(run.outcome).rejects.toThrow(/stored/i);
  });

  it("refuses a snapshot newer than this deployment, naming both versions", async () => {
    const run = await runRestore({ row: { schema_version: "0200_later.sql" } });
    let caught: unknown;
    try {
      await run.outcome;
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RestoreError);
    const message = (caught as Error).message;
    expect(message).toContain("0200_later.sql");
    expect(message).toContain("0114_backups.sql");
    // Refused before anything was fetched or built.
    expect(run.downloads).toEqual([]);
    expect(run.clientRequests()).toBe(0);
  });

  it("refuses a file that is not the snapshot the register recorded", async () => {
    const run = await runRestore({ row: { content_hash: "not-the-real-hash" } });
    await expect(run.outcome).rejects.toThrow(/not the snapshot/i);
    expect(run.clientRequests()).toBe(0);
  });

  it("refuses an archive whose bytes do not match its own manifest", async () => {
    const { archive } = await fixtureArchive();
    const entries = unzipSync(archive.bytes);
    entries["data/acc_currency.csv"] = strToU8(
      strFromU8(entries["data/acc_currency.csv"]).replace("US Dollar", "US Do11ar"),
    );
    const run = await runRestore({ bytes: zipSync(entries) });
    await expect(run.outcome).rejects.toThrow(/acc_currency/);
    expect(run.clientRequests()).toBe(0);
  });

  it("refuses a snapshot column today's schema has no place for, and rolls back", async () => {
    // An older snapshot can carry a column a later migration removed. Loading
    // the rest and dropping that column would lose data in silence — the very
    // failure the version gate exists to prevent.
    const columns = columnFixture();
    columns["acc_journal_line"] = columns["acc_journal_line"].filter(
      (column) => column.name !== "memo",
    );
    const run = await runRestore({ columns });
    let caught: unknown;
    try {
      await run.outcome;
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RestoreError);
    expect((caught as Error).message).toContain("acc_journal_line");
    expect((caught as Error).message).toContain("memo");
    expect(run.pg.calls.some((call) => call.text === "rollback")).toBe(true);
    expect(run.pg.calls.some((call) => call.text === "commit")).toBe(false);
  });
});
