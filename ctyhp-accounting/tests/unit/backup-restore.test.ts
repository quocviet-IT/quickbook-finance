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
import {
  buildExportArchive,
  type ExportArchive,
  type ExportManifest,
} from "@/lib/services/company-export";
import {
  RESTORE_EXCLUDED_TABLES,
  RestoreError,
  compareControlTotals,
  isSchemaCacheWarming,
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

  it("recognises both shapes of a PostgREST still warming up to the new schema", () => {
    // The commit's NOTIFY makes PostgREST reload asynchronously, in two
    // steps, and the first verification request can land between them. Before
    // the config reload the schema is refused outright (PGRST106); after it,
    // the schema is served from a cache that has not learned its functions
    // yet (PGRST202, "Could not find the function"). The first live
    // verification hit the second shape and surfaced it as a failure instead
    // of retrying — a fully restored copy reported unverified for a condition
    // that clears itself in seconds.
    expect(isSchemaCacheWarming("The schema must be one of the following: co_a, co_b")).toBe(true);
    expect(isSchemaCacheWarming("PGRST106")).toBe(true);
    expect(
      isSchemaCacheWarming(
        "Trial balance failed: Could not find the function co_copy.acc_ledger_balances(p_from, p_to) in the schema cache",
      ),
    ).toBe(true);
    expect(isSchemaCacheWarming("PGRST202")).toBe(true);
    // A genuinely broken read must still surface immediately.
    expect(isSchemaCacheWarming("permission denied for schema co_copy")).toBe(false);
    expect(isSchemaCacheWarming("connection refused")).toBe(false);
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
    // at end of statement). The default_tax_code_id closes the live schema's
    // one real cycle with acc_tax_code below.
    make("acc_account", [
      {
        id: "acc-child",
        account_code: "1010",
        name: "Checking",
        parent_account_id: "acc-parent",
        default_tax_code_id: "tax-1",
      },
      {
        id: "acc-parent",
        account_code: "1000",
        name: "Assets",
        parent_account_id: null,
        default_tax_code_id: null,
      },
    ]),
    // acc_number_source (not exported) cascades from this table's rows.
    make("acc_sequence", [{ key: "invoice", prefix: "INV-", next_value: 7 }]),
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
    // Listed in EXPORT_TABLES *after* the acc_account that references it —
    // the exact contradiction the live restore fell over. tax_account_id
    // points back at acc_account, closing the cycle.
    make("acc_tax_code", [
      { id: "tax-1", code: "TX", name: "Sales Tax", rate_bp: 825, tax_account_id: "acc-parent" },
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
  // Not a dataset: the snapshot does not carry this table. It exists in the
  // schema and cascades from acc_sequence, which is what the preservation
  // tests below are about.
  fixture["acc_number_source"] = [
    { name: "sequence_key", nullable: false },
    { name: "label", nullable: false },
  ];
  return fixture;
}

/**
 * The copy schema's foreign keys, as the catalog would report them — the
 * restore derives its whole load order from these, not from EXPORT_TABLES.
 * The account↔tax_code pair mirrors the live schema's one real cycle, both
 * sides nullable; acc_number_source mirrors the live registry that cascades
 * from acc_sequence without being exported.
 */
const FIXTURE_FOREIGN_KEYS: Array<Record<string, unknown>> = [
  {
    constraint_name: "acc_account_parent_account_id_fkey",
    from_table: "acc_account",
    to_table: "acc_account",
    columns: ["parent_account_id"],
    all_nullable: true,
    on_delete: "a",
  },
  {
    constraint_name: "acc_account_default_tax_fk",
    from_table: "acc_account",
    to_table: "acc_tax_code",
    columns: ["default_tax_code_id"],
    all_nullable: true,
    on_delete: "a",
  },
  {
    constraint_name: "acc_tax_code_tax_account_id_fkey",
    from_table: "acc_tax_code",
    to_table: "acc_account",
    columns: ["tax_account_id"],
    all_nullable: true,
    on_delete: "a",
  },
  {
    constraint_name: "acc_journal_line_journal_entry_id_fkey",
    from_table: "acc_journal_line",
    to_table: "acc_journal_entry",
    columns: ["journal_entry_id"],
    all_nullable: false,
    on_delete: "c",
  },
  {
    constraint_name: "acc_journal_line_account_id_fkey",
    from_table: "acc_journal_line",
    to_table: "acc_account",
    columns: ["account_id"],
    all_nullable: false,
    on_delete: "a",
  },
  {
    constraint_name: "acc_number_source_sequence_key_fkey",
    from_table: "acc_number_source",
    to_table: "acc_sequence",
    columns: ["sequence_key"],
    all_nullable: false,
    on_delete: "c",
  },
];

const FIXTURE_PRIMARY_KEYS: Array<Record<string, unknown>> = [
  { table_name: "acc_account", columns: ["id"] },
  { table_name: "acc_tax_code", columns: ["id"] },
  { table_name: "acc_sequence", columns: ["key"] },
];

/** What a fresh provisioning seeded into the non-exported registry. */
const FIXTURE_NUMBER_SOURCE_ROWS: Array<Record<string, unknown>> = [
  { sequence_key: "invoice", label: "Invoices" },
];

/**
 * Failures the fake connection can be told to produce. `rollback` models a
 * connection that died mid-transaction — the rollback itself then rejects too.
 * `matching` rejects the first statement whose text matches the pattern, which
 * is how the verdict-write failure below is staged.
 */
interface ProvisioningFaults {
  rollback?: Error;
  matching?: { pattern: RegExp; error: Error };
}

interface CatalogFixture {
  foreignKeys?: Array<Record<string, unknown>>;
  primaryKeys?: Array<Record<string, unknown>>;
}

function fakeProvisioningClient(
  columns: Record<string, Array<{ name: string; nullable: boolean }>>,
  faults: ProvisioningFaults = {},
  catalog: CatalogFixture = {},
) {
  const calls: PgCall[] = [];
  let ended = false;
  const client = {
    async query(text: string, params?: unknown[]) {
      calls.push({ text, params });
      if (text === "rollback" && faults.rollback) throw faults.rollback;
      if (faults.matching?.pattern.test(text)) throw faults.matching.error;
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
      if (/contype = 'f'/.test(text)) {
        return { rows: catalog.foreignKeys ?? FIXTURE_FOREIGN_KEYS };
      }
      if (/contype = 'p'/.test(text)) {
        return { rows: catalog.primaryKeys ?? FIXTURE_PRIMARY_KEYS };
      }
      // The preservation capture: reading the non-exported registry's rows
      // before the cascade from acc_sequence's delete can take them.
      if (/^select .+ from "co_copy"\."acc_number_source"$/.test(text)) {
        return { rows: FIXTURE_NUMBER_SOURCE_ROWS };
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
  /** What the copy schema's catalog reports — the load order's one source. */
  foreignKeys?: Array<Record<string, unknown>>;
  provision?: (
    client: PgLike,
    input: ProvisionCompanyInput,
    sources: readonly MigrationSource[],
  ) => Promise<ProvisionCompanyResult>;
  totals?: ExportControlTotals;
  /** Makes reading the restored totals fail — the post-commit failure path. */
  totalsError?: Error;
  faults?: ProvisioningFaults;
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
  const pg = fakeProvisioningClient(overrides.columns ?? columnFixture(), overrides.faults, {
    foreignKeys: overrides.foreignKeys,
  });
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
      if (overrides.totalsError) throw overrides.totalsError;
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

/**
 * Rezips the fixture archive with its manifest.json edited. The per-file
 * hashes in `files[]` stay untouched, so the register's content hash still
 * matches — which is exactly the hole these tests close: everything outside
 * `files[]` used to be writable without any check noticing.
 */
async function tamperedArchiveBytes(
  archive: ExportArchive,
  mutate: (manifest: ExportManifest) => void,
): Promise<Uint8Array> {
  const entries = unzipSync(archive.bytes);
  const manifest = JSON.parse(strFromU8(entries["manifest.json"])) as ExportManifest;
  mutate(manifest);
  entries["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
  return zipSync(entries);
}

/** The verdict row's call and parsed payload, or nulls when it was never written. */
function verdictWrite(calls: PgCall[]): {
  index: number;
  payload: Record<string, unknown> | null;
} {
  const index = calls.findIndex((call) => /company\.restore\.verify/.test(call.text));
  if (index < 0) return { index, payload: null };
  const params = calls[index].params as unknown[];
  return { index, payload: JSON.parse(params[2] as string) as Record<string, unknown> };
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
    expect(outcome.verdict).toBe("matched");
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

  it("clears and loads in the order the schema's own foreign keys dictate", async () => {
    const run = await runRestore();
    await run.outcome;
    const deletes = mutationTargets(run.pg.calls, "delete");
    const inserts = mutationTargets(run.pg.calls, "insert");
    const before = (list: string[], first: string, second: string) => {
      expect(
        list.indexOf(first),
        `${first} must come before ${second} in: ${list.join(", ")}`,
      ).toBeLessThan(list.indexOf(second));
    };
    // Loads put every referenced table before the table that references it.
    // acc_tax_code sits AFTER acc_account in EXPORT_TABLES, so the list order
    // this replaced could never have satisfied acc_tax_code_tax_account_id_fkey
    // and acc_account_default_tax_fk at once — the live restore's first run
    // fell over exactly that pair.
    before(inserts, "acc_journal_entry", "acc_journal_line");
    before(inserts, "acc_account", "acc_journal_line");
    before(inserts, "acc_account", "acc_tax_code");
    // Deletes are the same order read backwards — one sort serves both
    // directions, so they cannot drift apart. (acc_number_source is put back
    // by the preservation pass, not loaded from the snapshot, so it appears
    // among the inserts with no delete.)
    const loaded = inserts.filter((table) => table !== "acc_number_source");
    expect(deletes).toEqual([...loaded].reverse());
    before(deletes, "acc_journal_line", "acc_journal_entry");
    before(deletes, "acc_journal_line", "acc_account");
    before(deletes, "acc_tax_code", "acc_account");
    const lastDelete = run.pg.calls.findLastIndex((call) => /^delete from/.test(call.text));
    const firstInsert = run.pg.calls.findIndex((call) => /^insert into/.test(call.text));
    expect(lastDelete).toBeLessThan(firstInsert);
  });

  it("suspends the account↔tax-code cycle: nulls the column, loads, writes the value back", async () => {
    // The live schema's one real cycle: acc_account.default_tax_code_id ->
    // acc_tax_code and acc_tax_code.tax_account_id -> acc_account. No table
    // order satisfies both, so the nullable side is carried around the load:
    // nulled before the seed rows are cleared (a delete inside a cycle is as
    // stuck as an insert), loaded as null, then written back where the
    // constraint itself checks it against the now-present acc_tax_code row.
    const run = await runRestore();
    await run.outcome;
    const calls = run.pg.calls;
    const firstDelete = calls.findIndex((call) => /^delete from "co_copy"/.test(call.text));
    const suspendNull = calls.findIndex((call) =>
      /^update "co_copy"\."acc_account" set "default_tax_code_id" = null$/.test(call.text),
    );
    expect(suspendNull).toBeGreaterThan(-1);
    expect(suspendNull).toBeLessThan(firstDelete);
    // The load itself must not carry the value — it would point at a row that
    // does not exist yet.
    const accountInsert = calls.find(
      (call) =>
        call.params === undefined && /^insert into "co_copy"\."acc_account"/.test(call.text),
    );
    expect(accountInsert?.text).not.toContain("'tax-1'");
    // The cycle's other side is honoured by ordering, never nulled: the tax
    // code loads with its account reference intact.
    const taxInsertAt = calls.findIndex(
      (call) =>
        call.params === undefined && /^insert into "co_copy"\."acc_tax_code"/.test(call.text),
    );
    expect(calls[taxInsertAt]?.text).toContain("'acc-parent'");
    // And the snapshot's value comes back, addressed by primary key.
    const writeBack = calls.findIndex((call) =>
      /^update "co_copy"\."acc_account" set "default_tax_code_id" = 'tax-1' where "id" = 'acc-child'$/.test(
        call.text,
      ),
    );
    const commitAt = calls.findIndex((call) => call.text === "commit");
    expect(writeBack).toBeGreaterThan(taxInsertAt);
    expect(writeBack).toBeLessThan(commitAt);
  });

  it("puts back the seeded rows a cascade sweeps out of tables the snapshot does not carry", async () => {
    // acc_number_source — the registry document numbering reads — cascades
    // from acc_sequence and is not exported. Clearing acc_sequence would
    // silently empty it, and a copy without it cannot number an invoice. So
    // its rows are captured before the clear and put back after the load,
    // where their own foreign key checks them against the snapshot's rows.
    const run = await runRestore();
    await run.outcome;
    const calls = run.pg.calls;
    const firstDelete = calls.findIndex((call) => /^delete from "co_copy"/.test(call.text));
    const capture = calls.findIndex((call) =>
      /^select .+ from "co_copy"\."acc_number_source"$/.test(call.text),
    );
    expect(capture).toBeGreaterThan(-1);
    expect(capture).toBeLessThan(firstDelete);
    // Held inside the byte-faithful window with everything else.
    expect(
      calls.some((call) => /"acc_number_source" disable trigger user$/.test(call.text)),
    ).toBe(true);
    const putBack = calls.findIndex(
      (call) =>
        call.params === undefined &&
        /^insert into "co_copy"\."acc_number_source"/.test(call.text),
    );
    const commitAt = calls.findIndex((call) => call.text === "commit");
    expect(putBack).toBeGreaterThan(firstDelete);
    expect(putBack).toBeLessThan(commitAt);
    expect(calls[putBack].text).toContain("'invoice'");
    expect(calls[putBack].text).toContain("'Invoices'");
    // Never deleted: the table is not the restore's to manage.
    expect(mutationTargets(calls, "delete")).not.toContain("acc_number_source");
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
    // The far end of the window, which the assertions above cannot see: moving
    // the enable loop above the insert loop keeps the counts equal and the
    // first disable first, yet in production the actor-stamp triggers
    // (0064_transaction_actor_stamps.sql, before insert or update) would then
    // rewrite every historical actor and the closed-period guards would refuse
    // the very entries the disable exists to admit. Scoped to the transaction
    // — everything before "commit" — because the verdict row is deliberately
    // written after the commit with the triggers live again, and the last
    // in-transaction mutation is the provenance insert, which must also land
    // inside the window.
    const commitAt = run.pg.calls.findIndex((call) => call.text === "commit");
    expect(commitAt).toBeGreaterThan(-1);
    const inTransaction = run.pg.calls.slice(0, commitAt);
    const lastEnable = inTransaction.findLastIndex((call) =>
      / enable trigger user$/.test(call.text),
    );
    const lastMutation = inTransaction.findLastIndex((call) =>
      /^(delete from|insert into) "co_copy"/.test(call.text),
    );
    expect(lastEnable).toBeGreaterThan(lastMutation);
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
    expect(outcome.verdict).toBe("mismatched");
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

  it("refuses a manifest whose control totals disagree with the register's copy", async () => {
    // manifest.controlTotals sits outside the hashed file list, so anyone who
    // can write to the bucket can edit it to whatever a broken restore happens
    // to produce — the register hash still matches, every per-file digest
    // still matches, and the screen would announce the books came back whole
    // against forged figures. The register row's own copy (written by the
    // nightly job, behind row-level security) is the one the bucket cannot
    // touch, so a manifest that disagrees with it is refused outright.
    // Production edit that makes this fail: comparing against
    // manifest.controlTotals again instead of the register's copy.
    const { archive } = await fixtureArchive();
    const forged = { ...CONTROL_TOTALS, journalLineCount: 1 };
    const bytes = await tamperedArchiveBytes(archive, (manifest) => {
      manifest.controlTotals = forged;
    });
    // The broken restore the forgery was written to excuse: totals that match
    // the forged figures exactly.
    const run = await runRestore({ bytes, totals: forged });
    let caught: unknown;
    try {
      await run.outcome;
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RestoreError);
    expect((caught as Error).message).toMatch(/journalLineCount/);
    expect((caught as Error).message).toMatch(/register/i);
    // Refused before anything was built.
    expect(run.clientRequests()).toBe(0);
  });

  it("refuses a manifest whose measurement date disagrees with the register's taken_at", async () => {
    // controlTotalsAsOf is outside the hashed set too, and it decides the date
    // the comparison is measured at. A forged date moves the measurement to a
    // day whose balances differ — or happen to agree — for reasons that say
    // nothing about the restore. The register's taken_at is the verified copy
    // of the same clock reading (the nightly job derives both from `today`).
    // Production edit that makes this fail: reading comparedAsOf from the
    // manifest again without checking it against the register.
    const { archive } = await fixtureArchive();
    const bytes = await tamperedArchiveBytes(archive, (manifest) => {
      manifest.controlTotalsAsOf = "2026-08-15";
    });
    const run = await runRestore({ bytes });
    let caught: unknown;
    try {
      await run.outcome;
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RestoreError);
    expect((caught as Error).message).toContain("2026-08-15");
    expect(run.clientRequests()).toBe(0);
  });

  it("refuses a register row whose totals are missing figures the manifest carries", async () => {
    // The agreement check walks the union of both sides' keys. Walking only
    // the register's keys (production edit: replacing the union walk with
    // compareControlTotals, which iterates the expected side alone) would let
    // a register row somehow written without figures agree with any manifest
    // vacuously — and the restore would then be "proved" against nothing.
    const run = await runRestore({ row: { control_totals: {} as ExportControlTotals } });
    let caught: unknown;
    try {
      await run.outcome;
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RestoreError);
    expect((caught as Error).message).toMatch(/journalLineCount/);
    expect(run.clientRequests()).toBe(0);
  });

  it("refuses a zip entry that no line of the manifest vouches for", async () => {
    // The digest loop walks manifest.files, and the loader reads
    // entries[archivePathFor(table)] for every restorable table — so a CSV
    // added to the stored zip for a table the manifest never listed has no
    // digest, gets no check, and its rows would load. The concrete shape:
    // a snapshot taken under 0113, a later migration adds acc_customer to
    // EXPORT_TABLES, someone adds data/acc_customer.csv to the stored file.
    // Production edit that makes this fail: dropping the unlisted-entry check,
    // which restores the exact load-unverified behaviour this pins down.
    const { archive } = await fixtureArchive();
    const entries = unzipSync(archive.bytes);
    entries["data/acc_customer.csv"] = strToU8("id,display_name\r\nc-1,Mallory");
    const columns = {
      ...columnFixture(),
      // Today's schema knows the table, so the column gate would wave it in.
      acc_customer: [
        { name: "id", nullable: false },
        { name: "display_name", nullable: true },
      ],
    };
    const run = await runRestore({ bytes: zipSync(entries), columns });
    let caught: unknown;
    try {
      await run.outcome;
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RestoreError);
    expect((caught as Error).message).toContain("data/acc_customer.csv");
    expect((caught as Error).message).toMatch(/manifest/i);
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

  it("refuses to guess an order when the catalog reports no foreign keys at all", async () => {
    // A 65-table accounting schema always has foreign keys; zero of them
    // means the catalog was misread. Proceeding would silently order the load
    // by list position — the exact bug the catalog-derived order replaced.
    const run = await runRestore({ foreignKeys: [] });
    await expect(run.outcome).rejects.toThrow(/foreign key/i);
    expect(run.pg.calls.some((call) => call.text === "rollback")).toBe(true);
    expect(run.pg.calls.some((call) => call.text === "commit")).toBe(false);
  });

  it("refuses a schema where clearing would silently rewrite a table it does not manage", async () => {
    // `on delete cascade` from an outside table empties it, and the
    // preservation pass puts the rows back. `on delete set null` would
    // instead quietly rewrite rows the restore never touches again — no such
    // edge exists today, and one appearing must be a loud stop.
    const run = await runRestore({
      foreignKeys: [
        ...FIXTURE_FOREIGN_KEYS,
        {
          constraint_name: "acc_shadow_sequence_key_fkey",
          from_table: "acc_shadow",
          to_table: "acc_sequence",
          columns: ["sequence_key"],
          all_nullable: true,
          on_delete: "n",
        },
      ],
    });
    await expect(run.outcome).rejects.toThrow(/acc_shadow/);
    expect(run.pg.calls.some((call) => call.text === "rollback")).toBe(true);
    expect(run.pg.calls.some((call) => call.text === "commit")).toBe(false);
  });

  it("keeps the original failure when the rollback itself dies with the connection", async () => {
    // If the connection died, client.query("rollback") rejects too — and
    // without its own try, that rejection replaces the error that named the
    // statement which actually failed. Production edit that makes this fail:
    // removing the try around the rollback, which is exactly the code this
    // replaced.
    const run = await runRestore({
      provision: async () => {
        throw new Error("schema exploded");
      },
      faults: { rollback: new Error("Connection terminated unexpectedly") },
    });
    await expect(run.outcome).rejects.toThrow(/schema exploded/);
    expect(run.pg.isEnded()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The verdict must outlive the browser tab, and a failure after the commit
// must never claim the restore did not happen.
// ---------------------------------------------------------------------------

describe("what survives of the verdict", () => {
  it("writes the verdict into the copy's own audit log, after the commit", async () => {
    // Nothing durable used to record whether a restored company was verified:
    // show a mismatch once, close the tab, and no record anywhere would
    // distinguish that copy from a clean one. Production edits that make this
    // fail: not writing the verdict row at all (the code this pins replaced),
    // or writing it inside the transaction next to the provenance row — where
    // it would exist before the totals it claims to report.
    const run = await runRestore();
    const outcome = await run.outcome;
    expect(outcome.verdict).toBe("matched");
    expect(outcome.verdictRecorded).toBe(true);
    const commitAt = run.pg.calls.findIndex((call) => call.text === "commit");
    const verdict = verdictWrite(run.pg.calls);
    expect(verdict.index).toBeGreaterThan(commitAt);
    expect(verdict.payload).toMatchObject({
      verdict: "matched",
      compared_as_of: "2026-08-01",
      differences: [],
    });
  });

  it("records durably which figures differed, when the books did not add up", async () => {
    // Production edit that makes this fail: writing the verdict row before the
    // comparison ran, so it could only ever say "matched" or carry nothing.
    const run = await runRestore({ totals: { ...CONTROL_TOTALS, journalLineCount: 1 } });
    const outcome = await run.outcome;
    expect(outcome.verdict).toBe("mismatched");
    expect(outcome.verdictRecorded).toBe(true);
    const verdict = verdictWrite(run.pg.calls);
    expect(verdict.payload?.verdict).toBe("mismatched");
    expect((verdict.payload?.differences as string[]).join(" ")).toMatch(
      /journalLineCount.*2.*1/,
    );
  });

  it("tells the truth when verification fails after the commit: the company exists", async () => {
    // The transaction has committed and the company is fully loaded by the
    // time the totals are read — a thrown error here used to surface as "the
    // restore did not finish", whose natural response is to retry and build a
    // second copy. Production edit that makes this fail: rethrowing the
    // readTotals failure instead of carrying it on the outcome.
    const run = await runRestore({
      totalsError: new Error("PGRST106: schema must be one of the following"),
    });
    const outcome = await run.outcome;
    expect(outcome.companyId).toBe("company-copy");
    expect(outcome.verdict).toBe("unverified");
    expect(outcome.actual).toBeNull();
    expect(outcome.unverifiedReason).toContain("PGRST106");
    // The unproven state is itself durable: the verdict row says unverified.
    const verdict = verdictWrite(run.pg.calls);
    expect(verdict.payload?.verdict).toBe("unverified");
    expect(run.pg.calls.some((call) => call.text === "commit")).toBe(true);
  });

  it("surfaces a verdict row that could not be written, instead of failing the restore", async () => {
    // Two wrong shapes, both pinned here: swallowing the write failure would
    // report verdictRecorded true with no row behind it, and rethrowing it
    // would turn a fully loaded company into "the restore did not finish".
    const run = await runRestore({
      faults: {
        matching: { pattern: /company\.restore\.verify/, error: new Error("connection reset") },
      },
    });
    const outcome = await run.outcome;
    expect(outcome.verdict).toBe("matched");
    expect(outcome.verdictRecorded).toBe(false);
    expect(outcome.verdictRecordError).toContain("connection reset");
  });
});
