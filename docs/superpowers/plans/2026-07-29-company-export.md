# Company Data Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an authorised user download the company's accounting data as one portable archive whose manifest carries the control totals that prove a restored database matches it — PRD US-FR-113 and release gate 8.

**Architecture:** A pure domain module owns the table catalogue, CSV serialisation, checksums and manifest. A service layer pages every table through the caller's own Supabase client so RLS still applies. A Server Action gates on a new `company.export` permission, assembles the ZIP with `fflate`, and records one audit row describing the export's shape. The browser saves the bytes.

**Tech Stack:** Next.js 16 Server Actions, `fflate`, `@supabase/ssr`, Ant Design 6, vitest 4, Postgres via Supabase RPC.

## Global Constraints

- Money stays in minor units; the export never rounds or reformats stored figures.
- The service reads with the **caller's** client, never the service-role client — an export must not return rows the user cannot otherwise see.
- `acc_bank_connection_secret` is never exported.
- Vendor tax profiles go to `sensitive/vendor-tax.csv`, never to a `data/` file, and TINs never reach `acc_audit_log`.
- Audit rows record the export's shape only: row counts, manifest checksum, whether the sensitive file was included.
- CSV cells beginning with `=`, `+`, `-` or `@` are prefixed with `'` so a spreadsheet cannot execute them.
- Migrations are applied through the Supabase SQL Editor while the Postgres port is blocked, then their tracking row is inserted over PostgREST.

---

### Task 1: Export domain module

**Files:**
- Create: `ctyhp-accounting/lib/domain/company-export.ts`
- Test: `ctyhp-accounting/tests/unit/company-export.test.ts`

**Interfaces:**
- Produces:
  - `EXPORT_TABLES: readonly string[]` — every table written to `data/`
  - `EXCLUDED_TABLES: readonly string[]`
  - `SENSITIVE_TABLE = "acc_vendor_tax_profile"`
  - `toCsv(rows: Array<Record<string, unknown>>, columns: string[]): string`
  - `sha256Hex(input: string): Promise<string>`
  - `interface ExportDataset { table: string; columns: string[]; rows: Array<Record<string, unknown>>; sensitive: boolean }`
  - `interface ExportControlTotals { trialBalanceDebitMinor: number; trialBalanceCreditMinor: number; arTotalMinor: number; apTotalMinor: number; journalLineCount: number }`
  - `buildManifest(input: { datasets: ExportDataset[]; files: Array<{ path: string; sha256: string; rowCount: number }>; totals: ExportControlTotals; schemaVersion: string; generatedAt: string; actorEmail: string }): string`
  - `archivePathFor(table: string): string`
  - `exportFileName(companyName: string, generatedAt: string): string`

- [ ] **Step 1: Write the failing test**

Create `ctyhp-accounting/tests/unit/company-export.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  archivePathFor,
  buildManifest,
  EXCLUDED_TABLES,
  EXPORT_TABLES,
  exportFileName,
  sha256Hex,
  SENSITIVE_TABLE,
  toCsv,
} from "@/lib/domain/company-export";

describe("toCsv", () => {
  it("writes a header row followed by one row per record", () => {
    const csv = toCsv([{ id: "1", name: "Acme" }], ["id", "name"]);
    expect(csv).toBe("id,name\r\n1,Acme");
  });

  it("quotes commas, quotes and newlines", () => {
    const csv = toCsv([{ note: 'He said "go", then\nleft' }], ["note"]);
    expect(csv).toBe('note\r\n"He said ""go"", then\nleft"');
  });

  it("neutralises spreadsheet formulas", () => {
    const csv = toCsv([{ memo: "=cmd|'/c calc'!A1" }], ["memo"]);
    expect(csv).toBe("memo\r\n\"'=cmd|'/c calc'!A1\"");
  });

  it("writes an empty cell for null and undefined", () => {
    const csv = toCsv([{ a: null, b: undefined }], ["a", "b"]);
    expect(csv).toBe("a,b\r\n,");
  });

  it("serialises objects as JSON so jsonb columns survive", () => {
    const csv = toCsv([{ payload: { rows: 2 } }], ["payload"]);
    expect(csv).toBe('payload\r\n"{""rows"":2}"');
  });
});

describe("table catalogue", () => {
  it("never exports the encrypted bank feed secrets", () => {
    expect(EXCLUDED_TABLES).toContain("acc_bank_connection_secret");
    expect(EXPORT_TABLES).not.toContain("acc_bank_connection_secret");
  });

  it("keeps vendor tax profiles out of the plain data set", () => {
    expect(EXPORT_TABLES).not.toContain(SENSITIVE_TABLE);
  });

  it("exports the migration ledger so the archive stays interpretable", () => {
    expect(EXPORT_TABLES).toContain("acc_schema_migrations");
  });

  it("exports the journal, the source of every reported figure", () => {
    expect(EXPORT_TABLES).toContain("acc_journal_entry");
    expect(EXPORT_TABLES).toContain("acc_journal_line");
  });
});

describe("sha256Hex", () => {
  it("matches the known digest of the empty string", async () => {
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});

describe("buildManifest", () => {
  const manifest = () =>
    JSON.parse(
      buildManifest({
        datasets: [
          { table: "acc_account", columns: ["id"], rows: [{ id: "1" }], sensitive: false },
          { table: "acc_vendor_tax_profile", columns: ["tin"], rows: [{ tin: "12-3456789" }], sensitive: true },
        ],
        files: [
          { path: "data/acc_account.csv", sha256: "aa", rowCount: 1 },
          { path: "sensitive/vendor-tax.csv", sha256: "bb", rowCount: 1 },
        ],
        totals: {
          trialBalanceDebitMinor: 24_625_360,
          trialBalanceCreditMinor: 24_625_360,
          arTotalMinor: 850_548,
          apTotalMinor: 1_586_500,
          journalLineCount: 120,
        },
        schemaVersion: "0059_company_export.sql",
        generatedAt: "2026-07-29T02:00:00.000Z",
        actorEmail: "admin@ctyhp.vn",
      }),
    );

  it("records the control totals a restore is checked against", () => {
    expect(manifest().controlTotals).toEqual({
      trialBalanceDebitMinor: 24_625_360,
      trialBalanceCreditMinor: 24_625_360,
      arTotalMinor: 850_548,
      apTotalMinor: 1_586_500,
      journalLineCount: 120,
    });
  });

  it("flags the sensitive file so nobody shares the archive unaware", () => {
    expect(manifest().containsSensitiveData).toBe(true);
    expect(manifest().files.find((f: { path: string }) => f.path.startsWith("sensitive/")))
      .toMatchObject({ sha256: "bb", rowCount: 1 });
  });

  it("never repeats a row value inside the manifest", () => {
    expect(JSON.stringify(manifest())).not.toContain("12-3456789");
  });

  it("names the migration the data was written under", () => {
    expect(manifest().schemaVersion).toBe("0059_company_export.sql");
  });
});

describe("archivePathFor", () => {
  it("puts an ordinary table under data/", () => {
    expect(archivePathFor("acc_invoice")).toBe("data/acc_invoice.csv");
  });

  it("isolates vendor tax profiles", () => {
    expect(archivePathFor(SENSITIVE_TABLE)).toBe("sensitive/vendor-tax.csv");
  });

  it("promotes the attachment inventory to the archive root", () => {
    expect(archivePathFor("acc_document_attachment")).toBe("attachments.csv");
  });
});

describe("exportFileName", () => {
  it("is filesystem safe and dated", () => {
    expect(exportFileName("CTY HP / Jewelry", "2026-07-29T02:00:00.000Z")).toBe(
      "cty-hp-jewelry-company-export-2026-07-29.zip",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ctyhp-accounting && npx vitest run tests/unit/company-export.test.ts`
Expected: FAIL — cannot resolve `@/lib/domain/company-export`.

- [ ] **Step 3: Write the domain module**

Create `ctyhp-accounting/lib/domain/company-export.ts`:

```ts
/**
 * Pure rules for the portable company archive: what is exported, how a cell is
 * written, and what the manifest claims. No database access lives here.
 */

export const SENSITIVE_TABLE = "acc_vendor_tax_profile";

/** Encrypted with an environment key, so a copy is a live secret and a useless restore. */
export const EXCLUDED_TABLES: readonly string[] = ["acc_bank_connection_secret"];

/** Every table written to data/, in dependency order so the archive reads top-down. */
export const EXPORT_TABLES: readonly string[] = [
  "acc_schema_migrations",
  "acc_currency",
  "acc_exchange_rate",
  "acc_company_setting_version",
  "acc_accounting_period",
  "acc_period_event",
  "acc_permission",
  "acc_role_permission",
  "acc_app_user",
  "acc_approval_policy",
  "acc_approval_request",
  "acc_account",
  "acc_sequence",
  "acc_journal_entry",
  "acc_journal_line",
  "acc_journal_reversal_link",
  "acc_customer",
  "acc_vendor",
  "acc_item",
  "acc_tax_code",
  "acc_1099_box",
  "acc_invoice",
  "acc_invoice_line",
  "acc_payment",
  "acc_payment_allocation",
  "acc_credit_memo",
  "acc_credit_memo_line",
  "acc_credit_memo_allocation",
  "acc_customer_refund",
  "acc_write_off",
  "acc_bill",
  "acc_bill_line",
  "acc_bill_payment",
  "acc_bill_payment_allocation",
  "acc_expense",
  "acc_expense_line",
  "acc_vendor_credit",
  "acc_vendor_credit_line",
  "acc_vendor_credit_allocation",
  "acc_purchase_order",
  "acc_purchase_order_line",
  "acc_goods_receipt",
  "acc_goods_receipt_line",
  "acc_po_variance_exception",
  "acc_purchasing_config",
  "acc_inventory_txn",
  "acc_fixed_asset",
  "acc_asset_depreciation_schedule",
  "acc_bank_account",
  "acc_bank_connection",
  "acc_bank_feed_account",
  "acc_bank_feed_sync_run",
  "acc_bank_import_batch",
  "acc_bank_transaction",
  "acc_reconciliation",
  "acc_reconciliation_line",
  "acc_statement_reconciliation",
  "acc_tax_payment",
  "acc_budget",
  "acc_budget_line",
  "acc_recurring_template",
  "acc_recurring_run",
  "acc_document_attachment",
  "acc_document_access_log",
  "acc_audit_log",
];

export interface ExportDataset {
  table: string;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  sensitive: boolean;
}

export interface ExportControlTotals {
  trialBalanceDebitMinor: number;
  trialBalanceCreditMinor: number;
  arTotalMinor: number;
  apTotalMinor: number;
  journalLineCount: number;
}

const FORMULA_LEAD = new Set(["=", "+", "-", "@"]);

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const raw = typeof value === "object" ? JSON.stringify(value) : String(value);
  // A leading =, +, - or @ makes Excel and Sheets evaluate the cell.
  const guarded = FORMULA_LEAD.has(raw[0] ?? "") ? `'${raw}` : raw;
  const mustQuote =
    guarded !== raw || /[",\r\n]/.test(guarded);
  return mustQuote ? `"${guarded.replaceAll('"', '""')}"` : guarded;
}

export function toCsv(rows: Array<Record<string, unknown>>, columns: string[]): string {
  const lines = [columns.map(cell).join(",")];
  for (const row of rows) lines.push(columns.map((column) => cell(row[column])).join(","));
  return lines.join("\r\n");
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function buildManifest(input: {
  datasets: ExportDataset[];
  files: Array<{ path: string; sha256: string; rowCount: number }>;
  totals: ExportControlTotals;
  schemaVersion: string;
  generatedAt: string;
  actorEmail: string;
}): string {
  return JSON.stringify(
    {
      format: "ctyhp-accounting-company-export",
      formatVersion: 1,
      generatedAt: input.generatedAt,
      generatedBy: input.actorEmail,
      schemaVersion: input.schemaVersion,
      containsSensitiveData: input.datasets.some((dataset) => dataset.sensitive),
      excludedTables: EXCLUDED_TABLES,
      controlTotals: input.totals,
      files: input.files,
      tables: input.datasets.map((dataset) => ({
        table: dataset.table,
        rowCount: dataset.rows.length,
        columns: dataset.columns,
        sensitive: dataset.sensitive,
      })),
    },
    null,
    2,
  );
}

/** Where a table's CSV lives inside the archive. */
export function archivePathFor(table: string): string {
  if (table === SENSITIVE_TABLE) return "sensitive/vendor-tax.csv";
  if (table === "acc_document_attachment") return "attachments.csv";
  return `data/${table}.csv`;
}

export function exportFileName(companyName: string, generatedAt: string): string {
  const slug = companyName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${slug || "company"}-company-export-${generatedAt.slice(0, 10)}.zip`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ctyhp-accounting && npx vitest run tests/unit/company-export.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 5: Prove the catalogue matches the live database**

Run:

```bash
cd ctyhp-accounting && node --env-file=.env.local -e "
const b=process.env.NEXT_PUBLIC_SUPABASE_URL,k=process.env.SUPABASE_SERVICE_ROLE_KEY;
fetch(b+'/rest/v1/',{headers:{apikey:k,Authorization:'Bearer '+k,Accept:'application/openapi+json'}})
 .then(r=>r.json()).then(async s=>{
  const live=Object.keys(s.paths).filter(p=>!p.startsWith('/rpc/')&&p!=='/').map(p=>p.slice(1)).sort();
  const mod=await import('./lib/domain/company-export.ts').catch(()=>null);
  const listed=new Set([...(mod?.EXPORT_TABLES??[]), 'acc_vendor_tax_profile', 'acc_bank_connection_secret']);
  console.log('live but unlisted:', live.filter(t=>!listed.has(t)).join(', ')||'(none)');
 });"
```

Expected: `live but unlisted: (none)`. If the import fails because Node cannot read TypeScript, paste the array into the script instead. Any table the script names must be added to `EXPORT_TABLES` or to `EXCLUDED_TABLES` with a reason.

- [ ] **Step 6: Commit**

```bash
git add ctyhp-accounting/lib/domain/company-export.ts ctyhp-accounting/tests/unit/company-export.test.ts
git commit -m "Add the company export domain rules"
```

---

### Task 2: Permission and audit migration

**Files:**
- Create: `ctyhp-accounting/supabase/migrations/0059_company_export.sql`
- Modify: `ctyhp-accounting/tests/unit/access.test.ts`

**Interfaces:**
- Produces: permission key `company.export`; RPC `acc_log_company_export(p_summary jsonb) returns uuid`

The audit row cannot be inserted from the client — `acc_audit_log` is written by
RPCs and triggers only. This RPC is the one write path for an export.

- [ ] **Step 1: Write the migration**

Create `ctyhp-accounting/supabase/migrations/0059_company_export.sql`:

```sql
-- Company data export: its own permission, and the only path that records one.

insert into acc_permission (key, label, category, description, is_enforced) values
  ('company.export', 'Export company data', 'Governance',
   'Download the full company data archive, including vendor tax identifiers', true)
on conflict (key) do nothing;

insert into acc_role_permission (role, permission_key)
select 'admin', 'company.export'
 where not exists (
   select 1 from acc_role_permission
    where role = 'admin' and permission_key = 'company.export'
 );

-- Records the shape of an export: row counts, checksum, whether the sensitive
-- file was included. Never the exported values, and never a tax identifier.
create or replace function acc_log_company_export(p_summary jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not acc_has_permission('company.export') then
    raise exception 'company.export permission is required to record an export';
  end if;

  if p_summary ? 'rows' or p_summary ? 'data' then
    raise exception 'The export audit summary must not carry exported data';
  end if;

  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
  values ('acc_company_export', gen_random_uuid(), 'export', auth.uid(),
          jsonb_build_object(
            'generated_at',   p_summary ->> 'generated_at',
            'schema_version', p_summary ->> 'schema_version',
            'manifest_sha256', p_summary ->> 'manifest_sha256',
            'table_count',    (p_summary ->> 'table_count')::int,
            'total_rows',     (p_summary ->> 'total_rows')::int,
            'included_sensitive', coalesce((p_summary ->> 'included_sensitive')::boolean, false)
          ))
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function acc_log_company_export(jsonb) from public;
grant execute on function acc_log_company_export(jsonb) to authenticated;

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Apply it through the Supabase SQL Editor**

The Postgres port is blocked, so `scripts/migrate.mjs` cannot run. Open the
Supabase dashboard → SQL Editor → paste the whole file → Run. Expected: success
with no rows returned.

- [ ] **Step 3: Record the migration and verify the objects**

Run:

```bash
cd ctyhp-accounting && node --env-file=.env.local -e "
const b=process.env.NEXT_PUBLIC_SUPABASE_URL,k=process.env.SUPABASE_SERVICE_ROLE_KEY;
const h={apikey:k,Authorization:'Bearer '+k,'Content-Type':'application/json'};
(async()=>{
 await fetch(b+'/rest/v1/acc_schema_migrations',{method:'POST',
   headers:{...h,Prefer:'resolution=ignore-duplicates'},
   body:JSON.stringify([{filename:'0059_company_export.sql'}])});
 const spec=await (await fetch(b+'/rest/v1/',{headers:{...h,Accept:'application/openapi+json'}})).json();
 console.log('rpc live:', !!spec.paths['/rpc/acc_log_company_export']);
 const perm=await (await fetch(b+'/rest/v1/acc_permission?key=eq.company.export&select=key,category,is_enforced',{headers:h})).json();
 console.log('permission:', JSON.stringify(perm));
})();"
```

Expected: `rpc live: true` and one permission row with category `Governance`
and `is_enforced: true`.

- [ ] **Step 4: Extend the access unit test**

Append to `ctyhp-accounting/tests/unit/access.test.ts`:

```ts
describe("permission catalogue", () => {
  it("files company export under governance", () => {
    expect(PERMISSION_CATEGORIES).toContain("Governance");
  });
});
```

- [ ] **Step 5: Run the unit suite**

Run: `cd ctyhp-accounting && npm test`
Expected: all tests pass, including the new one.

- [ ] **Step 6: Commit**

```bash
git add ctyhp-accounting/supabase/migrations/0059_company_export.sql ctyhp-accounting/tests/unit/access.test.ts
git commit -m "Add the company export permission and its audit RPC"
```

---

### Task 3: Export service

**Files:**
- Create: `ctyhp-accounting/lib/services/company-export.ts`

**Interfaces:**
- Consumes: `EXPORT_TABLES`, `SENSITIVE_TABLE`, `ExportDataset`, `ExportControlTotals` from Task 1.
- Produces:
  - `collectExportDatasets(sb: SupabaseClient): Promise<ExportDataset[]>`
  - `readControlTotals(sb: SupabaseClient, asOf: string): Promise<ExportControlTotals>`
  - `readSchemaVersion(sb: SupabaseClient): Promise<string>`
  - `class CompanyExportError extends Error`

- [ ] **Step 1: Write the service**

Create `ctyhp-accounting/lib/services/company-export.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  EXPORT_TABLES,
  SENSITIVE_TABLE,
  type ExportControlTotals,
  type ExportDataset,
} from "@/lib/domain/company-export";

export class CompanyExportError extends Error {}

const PAGE = 1000;

async function readTable(
  sb: SupabaseClient,
  table: string,
): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from(table).select("*").range(from, from + PAGE - 1);
    if (error) throw new CompanyExportError(`Reading ${table} failed: ${error.message}`);
    rows.push(...((data ?? []) as Array<Record<string, unknown>>));
    if (!data || data.length < PAGE) return rows;
  }
}

function columnsOf(rows: Array<Record<string, unknown>>): string[] {
  const seen = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) seen.add(key);
  return [...seen];
}

/** Every exported table, read with the caller's own client so RLS still applies. */
export async function collectExportDatasets(sb: SupabaseClient): Promise<ExportDataset[]> {
  const datasets: ExportDataset[] = [];
  for (const table of [...EXPORT_TABLES, SENSITIVE_TABLE]) {
    const rows = await readTable(sb, table);
    datasets.push({
      table,
      columns: columnsOf(rows),
      rows,
      sensitive: table === SENSITIVE_TABLE,
    });
  }
  return datasets;
}

export async function readControlTotals(
  sb: SupabaseClient,
  asOf: string,
): Promise<ExportControlTotals> {
  const balances = await sb.rpc("acc_ledger_balances", { p_from: "1900-01-01", p_to: asOf });
  if (balances.error) {
    throw new CompanyExportError(`Trial balance failed: ${balances.error.message}`);
  }
  const ar = await sb.rpc("acc_ar_ageing", { p_as_of: asOf });
  if (ar.error) throw new CompanyExportError(`AR ageing failed: ${ar.error.message}`);
  const ap = await sb.rpc("acc_ap_ageing", { p_as_of: asOf });
  if (ap.error) throw new CompanyExportError(`AP ageing failed: ${ap.error.message}`);

  const { count, error } = await sb
    .from("acc_journal_line")
    .select("id", { count: "exact", head: true });
  if (error) throw new CompanyExportError(`Counting journal lines failed: ${error.message}`);

  const sum = (rows: Array<{ balance_minor: number }> | null) =>
    (rows ?? []).reduce((total, row) => total + Number(row.balance_minor), 0);

  return {
    trialBalanceDebitMinor: (balances.data ?? []).reduce(
      (total: number, row: { debit_base: number }) => total + Number(row.debit_base),
      0,
    ),
    trialBalanceCreditMinor: (balances.data ?? []).reduce(
      (total: number, row: { credit_base: number }) => total + Number(row.credit_base),
      0,
    ),
    arTotalMinor: sum(ar.data),
    apTotalMinor: sum(ap.data),
    journalLineCount: count ?? 0,
  };
}

export async function readSchemaVersion(sb: SupabaseClient): Promise<string> {
  const { data, error } = await sb
    .from("acc_schema_migrations")
    .select("filename")
    .order("filename", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new CompanyExportError(`Reading the schema version failed: ${error.message}`);
  return data?.filename ?? "unknown";
}
```

- [ ] **Step 2: Typecheck**

Run: `cd ctyhp-accounting && npm run typecheck`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add ctyhp-accounting/lib/services/company-export.ts
git commit -m "Read every exported table through the caller's client"
```

---

### Task 4: Server Action

**Files:**
- Modify: `ctyhp-accounting/app/(app)/settings/company/actions.ts`

**Interfaces:**
- Consumes: everything from Tasks 1 and 3.
- Produces: `exportCompanyDataAction(): Promise<ActionResult<{ fileName: string; zipBase64: string; manifestSha256: string; totalRows: number }>>`

Base64 is the transport because a Server Action returns JSON-serialisable
values; the client decodes it into a `Blob`.

- [ ] **Step 1: Add the action**

Append to `ctyhp-accounting/app/(app)/settings/company/actions.ts`:

```ts
import { strToU8, zipSync } from "fflate";
import {
  archivePathFor,
  buildManifest,
  exportFileName,
  sha256Hex,
  toCsv,
} from "@/lib/domain/company-export";
import {
  collectExportDatasets,
  readControlTotals,
  readSchemaVersion,
} from "@/lib/services/company-export";

export async function exportCompanyDataAction(): Promise<
  ActionResult<{ fileName: string; zipBase64: string; manifestSha256: string; totalRows: number }>
> {
  const sb = await createSupabaseServerClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return { ok: false, error: "Your session has expired. Sign in again." };

  const { data: allowed, error: permissionError } = await sb.rpc("acc_has_permission", {
    p_key: "company.export",
  });
  if (permissionError || allowed !== true) {
    return { ok: false, error: "You do not have permission to export company data" };
  }

  try {
    const generatedAt = new Date().toISOString();
    const asOf = generatedAt.slice(0, 10);
    const [datasets, totals, schemaVersion, versions] = await Promise.all([
      collectExportDatasets(sb),
      readControlTotals(sb, asOf),
      readSchemaVersion(sb),
      listCompanySettingVersions(sb),
    ]);
    const legalName = versions[0]?.legal_name ?? "company";

    const entries: Record<string, Uint8Array> = {};
    const files: Array<{ path: string; sha256: string; rowCount: number }> = [];
    let totalRows = 0;

    for (const dataset of datasets) {
      const path = archivePathFor(dataset.table);
      const csv = toCsv(dataset.rows, dataset.columns);
      entries[path] = strToU8(csv);
      files.push({ path, sha256: await sha256Hex(csv), rowCount: dataset.rows.length });
      totalRows += dataset.rows.length;
    }

    const manifest = buildManifest({
      datasets,
      files,
      totals,
      schemaVersion,
      generatedAt,
      actorEmail: user.email ?? "unknown",
    });
    const manifestSha256 = await sha256Hex(manifest);
    entries["manifest.json"] = strToU8(manifest);
    entries["README.txt"] = strToU8(
      [
        "CTYHP Accounting — company data export",
        "",
        `Generated ${generatedAt} under schema ${schemaVersion}.`,
        "",
        "data/        one CSV per table, header row = column names",
        "sensitive/   vendor tax profiles, including taxpayer identification numbers",
        "attachments.csv  the attachment inventory — file bytes are NOT included;",
        "             each row carries the storage path, size, sha256 and scan status",
        "             so a restore of object storage can be verified against it",
        "manifest.json carries row counts, per-file sha256 and the control totals",
        "             a restored database must reproduce.",
        "",
        "Restore procedure: docs/operations/backup-and-restore.md",
      ].join("\n"),
    );

    const zip = zipSync(entries, { level: 6 });

    const { error: auditError } = await sb.rpc("acc_log_company_export", {
      p_summary: {
        generated_at: generatedAt,
        schema_version: schemaVersion,
        manifest_sha256: manifestSha256,
        table_count: datasets.length,
        total_rows: totalRows,
        included_sensitive: datasets.some((dataset) => dataset.sensitive),
      },
    });
    if (auditError) {
      return { ok: false, error: `The export was not recorded: ${auditError.message}` };
    }

    return {
      ok: true,
      data: {
        fileName: exportFileName(legalName, generatedAt),
        zipBase64: Buffer.from(zip).toString("base64"),
        manifestSha256,
        totalRows,
      },
    };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}
```

The audit failure returns an error instead of the archive on purpose: an
unrecorded export of taxpayer data is exactly what US-FR-013 forbids.

- [ ] **Step 2: Typecheck and lint**

Run: `cd ctyhp-accounting && npm run typecheck && npm run lint`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add "ctyhp-accounting/app/(app)/settings/company/actions.ts"
git commit -m "Gate, assemble and audit the company data export"
```

---

### Task 5: Settings card

**Files:**
- Create: `ctyhp-accounting/components/settings/CompanyExportCard.tsx`
- Modify: `ctyhp-accounting/app/(app)/settings/company/CompanySettingsClient.tsx`

**Interfaces:**
- Consumes: `exportCompanyDataAction` from Task 4.
- Produces: `<CompanyExportCard />`, a client component.

- [ ] **Step 1: Write the card**

Create `ctyhp-accounting/components/settings/CompanyExportCard.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Alert, App, Button, Card, Space, Typography } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import { exportCompanyDataAction } from "@/app/(app)/settings/company/actions";

export function CompanyExportCard() {
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);
  const [lastExport, setLastExport] = useState<{ rows: number; sha: string } | null>(null);

  async function download() {
    setBusy(true);
    try {
      const result = await exportCompanyDataAction();
      if (!result.ok || !result.data) {
        message.error(result.error ?? "The export failed");
        return;
      }
      const bytes = Uint8Array.from(atob(result.data.zipBase64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = result.data.fileName;
      link.click();
      URL.revokeObjectURL(url);
      setLastExport({ rows: result.data.totalRows, sha: result.data.manifestSha256 });
      message.success(`Exported ${result.data.totalRows.toLocaleString("en-US")} rows`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Company data export">
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          One archive of every accounting table as CSV, with a manifest whose control
          totals a restored database must reproduce. Attachments are listed, not included.
        </Typography.Paragraph>
        <Alert
          type="warning"
          showIcon
          message="This archive contains vendor taxpayer identification numbers"
          description="Store it where the company stores tax records. Every download is recorded in the audit log."
        />
        <Button type="primary" icon={<DownloadOutlined />} loading={busy} onClick={download}>
          Export company data
        </Button>
        {lastExport ? (
          <Typography.Text type="secondary">
            Last export in this session: {lastExport.rows.toLocaleString("en-US")} rows, manifest
            sha256 {lastExport.sha.slice(0, 12)}…
          </Typography.Text>
        ) : null}
      </Space>
    </Card>
  );
}
```

- [ ] **Step 2: Mount it on the company settings page**

In `ctyhp-accounting/app/(app)/settings/company/CompanySettingsClient.tsx`, import
the card and render it after the existing settings card:

```tsx
import { CompanyExportCard } from "@/components/settings/CompanyExportCard";
```

```tsx
<CompanyExportCard />
```

This file is already a client component, so the Ant Design compound-component
trap does not apply — but do not move this markup into `page.tsx`.

- [ ] **Step 3: Run the four gates**

Run: `cd ctyhp-accounting && npm run typecheck && npm test && npm run lint && npm run build`
Expected: zero errors from all four.

- [ ] **Step 4: Render-check the page**

Start the dev server, then run:

`cd ctyhp-accounting && node --env-file=.env.local scripts/smoke-pages.mjs`
Expected: every page 200, including `/settings/company`.

- [ ] **Step 5: Commit**

```bash
git add ctyhp-accounting/components/settings/CompanyExportCard.tsx "ctyhp-accounting/app/(app)/settings/company/CompanySettingsClient.tsx"
git commit -m "Add the company data export card to company settings"
```

---

### Task 6: Restore runbook and the first drill

**Files:**
- Create: `docs/operations/backup-and-restore.md`

- [ ] **Step 1: Take a real export**

Sign in as an administrator, open `/settings/company`, press **Export company
data**, and save the archive. Note the manifest's `controlTotals` and
`schemaVersion`.

- [ ] **Step 2: Verify the manifest against the database**

Run:

```bash
cd ctyhp-accounting && node --env-file=.env.local -e "
const b=process.env.NEXT_PUBLIC_SUPABASE_URL,k=process.env.SUPABASE_SERVICE_ROLE_KEY;
const h={apikey:k,Authorization:'Bearer '+k,'Content-Type':'application/json'};
const post=(fn,body)=>fetch(b+'/rest/v1/rpc/'+fn,{method:'POST',headers:h,body:JSON.stringify(body)}).then(r=>r.json());
(async()=>{
 const today=new Date().toISOString().slice(0,10);
 const tb=await post('acc_ledger_balances',{p_from:'1900-01-01',p_to:today});
 const ar=await post('acc_ar_ageing',{p_as_of:today});
 const ap=await post('acc_ap_ageing',{p_as_of:today});
 const sum=(rows,f)=>rows.reduce((s,x)=>s+Number(x[f]||0),0);
 console.log('trialBalanceDebitMinor', sum(tb,'debit_base'));
 console.log('trialBalanceCreditMinor', sum(tb,'credit_base'));
 console.log('arTotalMinor', sum(ar,'balance_minor'));
 console.log('apTotalMinor', sum(ap,'balance_minor'));
})();"
```

Expected: the four figures match `controlTotals` in the manifest exactly.

- [ ] **Step 3: Write the runbook**

Create `docs/operations/backup-and-restore.md` covering: what Supabase retains
and for how long; the recovery point objective and recovery time objective;
step-by-step point-in-time recovery from the dashboard; how to verify a
restored database by recomputing the four control totals and comparing them
against an export manifest; how the archive's `attachments` listing is used to
confirm object storage came back intact; the drill cadence; and a drill log
table with columns Date, Performed by, Method, Result, Notes.

Record Step 2's comparison as the first drill entry, with today's date, method
"export manifest verification against live database", and the outcome.

- [ ] **Step 4: Commit**

```bash
git add docs/operations/backup-and-restore.md
git commit -m "Document backup, restore and the first verification drill"
```
