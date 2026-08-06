# Saved Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/reports/saved` screen where an administrator or accountant keeps a report produced by another system — QuickBooks, Wave, a bank — and anyone in the company reads it later, as a table when it is a CSV and as a download otherwise, without a single balance changing.

**Architecture:** A private storage bucket with **no `storage.objects` policy for `authenticated` at all**, so no browser session can touch an object directly. Authorisation happens in application code against the company schema the request already resolved, and is then carried by a short-lived signed URL minted with the service role. A per-schema `acc_saved_report` table holds the metadata under ordinary RLS, and writes go only through two `security definer` functions.

**Tech Stack:** Next.js 16 App Router and Server Actions, React 19, TypeScript, Ant Design 5, Supabase Storage signed URLs, Supabase/PostgreSQL PL/pgSQL, Vitest, Node `pg` rollback verification.

**Spec:** `docs/superpowers/specs/2026-08-06-saved-reports-design.md`

## Global Constraints

- Product name in user-visible copy is **One Book**. All UI copy is US English; currency is USD; "Sales Tax", never "VAT".
- **Nothing in this feature may post.** No `acc_post_entry`, no insert into `acc_journal_line`, no insert into `acc_bank_transaction`. The verification harness asserts the journal entry count is unchanged, and a unit test asserts the migration text contains none of those calls.
- **No hard delete.** Retiring a saved report sets `status = 'archived'` with actor, time and reason.
- Reads are gated by the existing permission `documents.read` (granted to every role); writes by `documents.manage` (admin and accountant only). Do not invent new permission keys.
- The service-role client may be used **only to move bytes in the `onebook-reports` bucket**, never to read or write a table. The session client decides; the admin client only carries.
- Never set `created_by` / `created_at` / `updated_by` / `updated_at` from application code — `acc_stamp_actor()` owns them. (`acc_saved_report` uses its own `uploaded_by` / `uploaded_at`, which the RPC sets.)
- No SQL in components. Writes go through `lib/services/saved-reports.ts` into the RPCs.
- Every migration must reach every company schema. The bucket registration is global and is held back by `scopeOf()`; the table, policies and functions are `public`-pinned and get retargeted per company by `retargetToSchema()`.
- A Server Component must not read an Ant Design *sub*-component (`Typography.Title`, `Form.Item`, `Input.TextArea`, …). Keep `page.tsx` a thin server wrapper.
- Keep every touched TS/TSX file under 400 lines.
- Read the checked-in Next.js 16 docs in `node_modules/next/dist/docs/` before writing route or Server Action code.
- Verification gates, all with real pasted output: `npm test`, `npm run typecheck`, `npm run lint`, `npm run security:check-source`, `npm run build`, plus `scripts/smoke-pages.mjs` against the built server.
- All npm and node commands run with the working directory `ctyhp-accounting`. Git commands run from the repository root, `c:\Users\pit010\QUICKBOOK_WEBAPP`.

## File Map

| File | Responsibility |
|---|---|
| `ctyhp-accounting/lib/csv.ts` | Modify. Export `parseCsvGrid` (raw rows, order and duplicate headers preserved); `parseCsv` calls it. Behaviour unchanged. |
| `ctyhp-accounting/lib/domain/saved-reports.ts` | Create. Constants, storage path, file validation, tabular test, preview grid, Zod schemas. Pure. |
| `ctyhp-accounting/supabase/migrations/0101_saved_reports.sql` | Create. Bucket, `acc_saved_report`, RLS, `acc_register_saved_report`, `acc_archive_saved_report`. |
| `ctyhp-accounting/scripts/verify-saved-reports.mjs` | Create. Rollback-only behavioural proof, including that no journal entry appears. |
| `ctyhp-accounting/lib/db/storage-admin.ts` | Create. The one service-role client allowed for this bucket, and only for its objects. |
| `ctyhp-accounting/lib/services/saved-reports.ts` | Create. Ticket, register, list, download URL, preview text, archive. |
| `ctyhp-accounting/app/(app)/reports/saved/actions.ts` | Create. Server actions, each guarding by role before calling the service. |
| `ctyhp-accounting/app/(app)/reports/saved/page.tsx` | Create. Thin server wrapper: active company, list, render client. |
| `ctyhp-accounting/app/(app)/reports/saved/SavedReportsClient.tsx` | Create. The list, the source filter, archive, and the two child components. |
| `ctyhp-accounting/app/(app)/reports/saved/SaveReportModal.tsx` | Create. Upload: file, title, source, period, notes. |
| `ctyhp-accounting/app/(app)/reports/saved/SavedReportViewer.tsx` | Create. Drawer: CSV as a table, everything else as a download. |
| `ctyhp-accounting/lib/domain/report-catalog.ts` | Modify. One `saved-reports` entry in the `accounting` group. |
| `ctyhp-accounting/components/reports/ReportsHub.tsx` | Modify. One icon for that entry. |
| `ctyhp-accounting/app/(app)/settings/import/ImportGuidance.tsx` | Modify. One line pointing a report — as opposed to a data file — at the new screen. |
| `ctyhp-accounting/package.json` | Modify. `verify:saved-reports` script. |

---

### Task 1: The pure module

Everything here is a function of its arguments. No Supabase, no React, no `Date.now()` inside the tested paths.

**Files:**
- Modify: `ctyhp-accounting/lib/csv.ts`
- Create: `ctyhp-accounting/lib/domain/saved-reports.ts`
- Test: `ctyhp-accounting/tests/unit/saved-reports.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `parseCsvGrid(text: string): string[][]` from `@/lib/csv`
  - `SAVED_REPORT_BUCKET: "onebook-reports"`
  - `SAVED_REPORT_MAX_BYTES: 10485760`
  - `SAVED_REPORT_SOURCES: readonly ["quickbooks","wave","bank","spreadsheet","other"]`
  - `type SavedReportSource = (typeof SAVED_REPORT_SOURCES)[number]`
  - `SAVED_REPORT_MIME_TYPES: readonly string[]`
  - `SAVED_REPORT_ACCEPT: string`
  - `savedReportExtension(mimeType: string): string`
  - `savedReportStoragePath(companyId: string, mimeType: string, objectId: string): string`
  - `isTabularSavedReport(mimeType: string): boolean`
  - `validateSavedReportFile(file: { name: string; type: string; size: number }): string | null`
  - `interface SavedReportPreview { headers: string[]; rows: string[][]; truncated: boolean }`
  - `savedReportPreview(text: string, limit?: number): SavedReportPreview`
  - `savedReportRegisterSchema` and `savedReportArchiveSchema` (Zod)
  - `type SavedReportRegisterInput = z.infer<typeof savedReportRegisterSchema>`

- [ ] **Step 1: Write the failing test**

Create `ctyhp-accounting/tests/unit/saved-reports.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseCsvGrid, parseCsv } from "@/lib/csv";
import {
  isTabularSavedReport,
  savedReportPreview,
  savedReportRegisterSchema,
  savedReportArchiveSchema,
  savedReportStoragePath,
  validateSavedReportFile,
  SAVED_REPORT_MAX_BYTES,
} from "@/lib/domain/saved-reports";

describe("parseCsvGrid", () => {
  it("keeps column order, blank headers and duplicates that keying would lose", () => {
    const grid = parseCsvGrid('Date,,Date\r\n2026-01-01,x,2026-02-01\r\n');
    expect(grid).toEqual([
      ["Date", "", "Date"],
      ["2026-01-01", "x", "2026-02-01"],
    ]);
  });

  it("still keys records the way every existing caller expects", () => {
    expect(parseCsv("Name,Amount\r\nAcme,10\r\n")).toEqual([{ name: "Acme", amount: "10" }]);
  });
});

describe("savedReportStoragePath", () => {
  it("puts the company first so an object can be traced back from the bucket", () => {
    const path = savedReportStoragePath(
      "6d0f1e2a-1111-4222-8333-444455556666",
      "text/csv",
      "aaaabbbb-cccc-4ddd-8eee-ffff00001111",
    );
    expect(path).toBe(
      "6d0f1e2a-1111-4222-8333-444455556666/aaaabbbb-cccc-4ddd-8eee-ffff00001111.csv",
    );
  });

  it("uses the extension the mime type implies, not the one the file claimed", () => {
    expect(savedReportStoragePath("c", "application/pdf", "o")).toBe("c/o.pdf");
  });
});

describe("isTabularSavedReport", () => {
  it("is true only for the format the viewer can actually render", () => {
    expect(isTabularSavedReport("text/csv")).toBe(true);
    expect(isTabularSavedReport("application/pdf")).toBe(false);
    expect(
      isTabularSavedReport(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ),
    ).toBe(false);
  });
});

describe("validateSavedReportFile", () => {
  it("accepts a normal CSV export", () => {
    expect(validateSavedReportFile({ name: "pnl-2025.csv", type: "text/csv", size: 4096 })).toBeNull();
  });

  it("refuses an empty file", () => {
    expect(validateSavedReportFile({ name: "a.csv", type: "text/csv", size: 0 })).toBe(
      "The selected file is empty.",
    );
  });

  it("names the limit when the file is too large", () => {
    expect(
      validateSavedReportFile({ name: "a.csv", type: "text/csv", size: SAVED_REPORT_MAX_BYTES + 1 }),
    ).toBe("The file must be 10 MB or smaller.");
  });

  it("names the formats it will take when the type is not one of them", () => {
    expect(validateSavedReportFile({ name: "a.docx", type: "application/msword", size: 10 })).toBe(
      "Use CSV, PDF, XLSX, PNG, or JPG.",
    );
  });
});

describe("savedReportPreview", () => {
  it("splits the header off and reports that nothing was cut", () => {
    const preview = savedReportPreview("Account,Balance\r\nCash,100\r\nBank,200\r\n");
    expect(preview.headers).toEqual(["Account", "Balance"]);
    expect(preview.rows).toEqual([
      ["Cash", "100"],
      ["Bank", "200"],
    ]);
    expect(preview.truncated).toBe(false);
  });

  it("stops at the limit and says so, rather than rendering ten thousand rows", () => {
    const text = ["Account,Balance", ...Array.from({ length: 5 }, (_, i) => `A${i},${i}`)].join("\n");
    const preview = savedReportPreview(text, 2);
    expect(preview.rows).toHaveLength(2);
    expect(preview.truncated).toBe(true);
  });

  it("returns nothing rather than throwing on an empty file", () => {
    expect(savedReportPreview("")).toEqual({ headers: [], rows: [], truncated: false });
  });
});

describe("savedReportRegisterSchema", () => {
  const valid = {
    title: "Wave Profit and Loss 2025",
    source: "wave" as const,
    period_start: "2025-01-01",
    period_end: "2025-12-31",
    notes: null,
    file_name: "pnl.csv",
    storage_path: "company/object.csv",
    mime_type: "text/csv",
    size_bytes: 4096,
    sha256: "a".repeat(64),
  };

  it("accepts a complete report", () => {
    expect(savedReportRegisterSchema.parse(valid).title).toBe("Wave Profit and Loss 2025");
  });

  it("refuses a blank title", () => {
    expect(savedReportRegisterSchema.safeParse({ ...valid, title: "   " }).success).toBe(false);
  });

  it("refuses a period that ends before it starts", () => {
    const result = savedReportRegisterSchema.safeParse({
      ...valid,
      period_start: "2025-12-31",
      period_end: "2025-01-01",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a report with no period at all", () => {
    expect(
      savedReportRegisterSchema.safeParse({ ...valid, period_start: null, period_end: null }).success,
    ).toBe(true);
  });

  it("refuses a source nobody defined", () => {
    expect(savedReportRegisterSchema.safeParse({ ...valid, source: "sage" }).success).toBe(false);
  });

  it("refuses a hash that is not a sha256", () => {
    expect(savedReportRegisterSchema.safeParse({ ...valid, sha256: "abc" }).success).toBe(false);
  });
});

describe("savedReportArchiveSchema", () => {
  it("requires a reason, because an archived report with no reason explains nothing", () => {
    expect(savedReportArchiveSchema.safeParse({ id: crypto.randomUUID(), reason: "" }).success).toBe(
      false,
    );
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```
cd ctyhp-accounting
npx vitest run tests/unit/saved-reports.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/domain/saved-reports"`, and `parseCsvGrid` is not exported from `@/lib/csv`.

- [ ] **Step 3: Export the raw grid from the CSV parser**

In `ctyhp-accounting/lib/csv.ts`, rename the existing `parseCsv` body's row-collecting half into a new exported function and have `parseCsv` call it. Replace the whole of the existing `parseCsv` (from its doc comment down to the closing brace before `export interface CsvColumn`) with:

```ts
/**
 * CSV to raw rows (handles quoted fields, escaped quotes, CRLF).
 *
 * Column order, blank headers and repeated headers all survive, which keying by
 * header name cannot do — a report exported by another product has all three.
 */
export function parseCsvGrid(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    if (row.some((c) => c.trim() !== "")) rows.push(row);
  }
  return rows;
}

/**
 * Minimal CSV parser (handles quoted fields, escaped quotes, CRLF). Returns an
 * array of records keyed by the header row (lower-cased, trimmed).
 */
export function parseCsv(text: string): Record<string, string>[] {
  const rows = parseCsvGrid(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => {
    const rec: Record<string, string> = {};
    headers.forEach((h, i) => (rec[h] = (r[i] ?? "").trim()));
    return rec;
  });
}
```

- [ ] **Step 4: Write the domain module**

Create `ctyhp-accounting/lib/domain/saved-reports.ts`:

```ts
import { z } from "zod";
import { parseCsvGrid } from "@/lib/csv";

/**
 * A report produced somewhere else, kept as it arrived.
 *
 * Nothing here reads figures out of a file. That is the whole point: an
 * imported file posts, a saved report does not, and the two must never be
 * confused by the code any more than by the person using it.
 */

export const SAVED_REPORT_BUCKET = "onebook-reports";

/** Ten megabytes, the same ceiling supporting documents use. */
export const SAVED_REPORT_MAX_BYTES = 10_485_760;

export const SAVED_REPORT_SOURCES = [
  "quickbooks",
  "wave",
  "bank",
  "spreadsheet",
  "other",
] as const;
export type SavedReportSource = (typeof SAVED_REPORT_SOURCES)[number];

export const SAVED_REPORT_SOURCE_LABEL: Record<SavedReportSource, string> = {
  quickbooks: "QuickBooks",
  wave: "Wave",
  bank: "Bank",
  spreadsheet: "Spreadsheet",
  other: "Other",
};

/**
 * Deliberately narrower than the attachment allowlist. Nothing in this bucket
 * is scanned, so the list holds only formats a browser will not execute, and
 * every signed URL is issued as a download besides.
 */
export const SAVED_REPORT_MIME_TYPES = [
  "text/csv",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/png",
  "image/jpeg",
] as const;

export const SAVED_REPORT_ACCEPT = ".csv,.pdf,.xlsx,.png,.jpg,.jpeg";

const EXTENSIONS: Record<string, string> = {
  "text/csv": "csv",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "image/png": "png",
  "image/jpeg": "jpg",
};

export function savedReportExtension(mimeType: string): string {
  return EXTENSIONS[mimeType] ?? "bin";
}

/**
 * `<company id>/<object id>.<ext>`.
 *
 * The company id is there so an object found in the bucket can be traced back
 * to the books it belongs to. Nothing authorises on it — authorisation happens
 * before a signed URL is minted, never from a path.
 */
export function savedReportStoragePath(
  companyId: string,
  mimeType: string,
  objectId: string,
): string {
  return `${companyId}/${objectId}.${savedReportExtension(mimeType)}`;
}

/** Whether the viewer can show this file as a table rather than a download. */
export function isTabularSavedReport(mimeType: string): boolean {
  return mimeType === "text/csv";
}

export function validateSavedReportFile(file: {
  name: string;
  type: string;
  size: number;
}): string | null {
  if (!file.name.trim()) return "Choose a file with a valid name.";
  if (file.name.length > 255) return "The file name must be 255 characters or fewer.";
  if (file.size <= 0) return "The selected file is empty.";
  if (file.size > SAVED_REPORT_MAX_BYTES) return "The file must be 10 MB or smaller.";
  if (!SAVED_REPORT_MIME_TYPES.includes(file.type as (typeof SAVED_REPORT_MIME_TYPES)[number])) {
    return "Use CSV, PDF, XLSX, PNG, or JPG.";
  }
  return null;
}

export interface SavedReportPreview {
  headers: string[];
  rows: string[][];
  truncated: boolean;
}

/**
 * The first rows of a CSV, ready to render.
 *
 * A report from another product has blank and repeated column headings, so the
 * grid is kept as rows rather than keyed records — keying would silently merge
 * two columns called "Amount" into one.
 */
export function savedReportPreview(text: string, limit = 500): SavedReportPreview {
  const grid = parseCsvGrid(text);
  if (grid.length === 0) return { headers: [], rows: [], truncated: false };
  const [headers, ...body] = grid;
  return {
    headers,
    rows: body.slice(0, limit),
    truncated: body.length > limit,
  };
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date");

export const savedReportRegisterSchema = z
  .object({
    title: z.string().trim().min(1, "Give the report a title").max(200),
    source: z.enum(SAVED_REPORT_SOURCES),
    period_start: isoDate.nullable(),
    period_end: isoDate.nullable(),
    notes: z.string().trim().max(2000).nullable(),
    file_name: z.string().trim().min(1).max(255),
    storage_path: z.string().min(1).max(400),
    mime_type: z.enum(SAVED_REPORT_MIME_TYPES),
    size_bytes: z.number().int().positive().max(SAVED_REPORT_MAX_BYTES),
    sha256: z.string().regex(/^[0-9a-f]{64}$/, "Expected a sha256 digest"),
  })
  .refine(
    (value) =>
      !value.period_start || !value.period_end || value.period_end >= value.period_start,
    { message: "The period cannot end before it starts", path: ["period_end"] },
  );

export type SavedReportRegisterInput = z.infer<typeof savedReportRegisterSchema>;

export const savedReportArchiveSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(1, "Say why this report is being archived").max(500),
});
```

- [ ] **Step 5: Run the tests and watch them pass**

```
cd ctyhp-accounting
npx vitest run tests/unit/saved-reports.test.ts
```

Expected: PASS, 19 tests.

- [ ] **Step 6: Prove the CSV refactor broke nothing**

```
cd ctyhp-accounting
npx vitest run tests/unit
```

Expected: the whole unit suite passes. `parseCsv` is used by the import screen and several report exports; if any of those move, the extraction was not behaviour-free and must be corrected rather than the test.

- [ ] **Step 7: Commit**

```bash
cd /c/Users/pit010/QUICKBOOK_WEBAPP
git add ctyhp-accounting/lib/csv.ts ctyhp-accounting/lib/domain/saved-reports.ts ctyhp-accounting/tests/unit/saved-reports.test.ts
git commit -m "Describe a report that is kept rather than posted"
```

---

### Task 2: The migration, and the proof it posts nothing

**Files:**
- Create: `ctyhp-accounting/supabase/migrations/0101_saved_reports.sql`
- Create: `ctyhp-accounting/scripts/verify-saved-reports.mjs`
- Modify: `ctyhp-accounting/package.json`
- Test: `ctyhp-accounting/tests/unit/saved-reports-migration.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 (SQL and a Node script).
- Produces, for Task 3 to call:
  - `acc_register_saved_report(p_title text, p_source text, p_period_start date, p_period_end date, p_notes text, p_file_name text, p_storage_path text, p_mime_type text, p_size_bytes int, p_sha256 text) returns uuid`
  - `acc_archive_saved_report(p_id uuid, p_reason text) returns void`
  - table `acc_saved_report` with the columns listed in the migration below.

- [ ] **Step 1: Write the failing test**

Create `ctyhp-accounting/tests/unit/saved-reports-migration.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase", "migrations", "0101_saved_reports.sql"),
  "utf8",
);

describe("0101_saved_reports", () => {
  it("never posts — this is the promise the whole feature makes", () => {
    expect(sql).not.toMatch(/acc_post_entry/);
    expect(sql).not.toMatch(/insert\s+into\s+acc_journal_line/i);
    expect(sql).not.toMatch(/insert\s+into\s+acc_journal_entry/i);
    expect(sql).not.toMatch(/insert\s+into\s+acc_bank_transaction/i);
  });

  it("gates writing on documents.manage rather than a role name", () => {
    expect(sql).toMatch(/acc_has_permission\('documents\.manage'\)/);
  });

  it("lets every role that may read a document read a saved report", () => {
    expect(sql).toMatch(/acc_has_permission\('documents\.read'\)/);
  });

  it("gives the table no insert, update or delete policy", () => {
    expect(sql).not.toMatch(/create policy[\s\S]{0,120}for\s+insert\s+[\s\S]{0,80}acc_saved_report/i);
    expect(sql).not.toMatch(/on acc_saved_report\s+for (insert|update|delete)/i);
  });

  it("refuses a hard delete by archiving instead", () => {
    expect(sql).toMatch(/status = 'archived'/);
    expect(sql).not.toMatch(/delete\s+from\s+acc_saved_report/i);
  });

  it("keeps one active row per file, so the same report cannot be saved twice", () => {
    expect(sql).toMatch(
      /create unique index acc_saved_report_sha_idx[\s\S]{0,120}where status = 'active'/,
    );
  });

  it("registers the bucket privately", () => {
    expect(sql).toMatch(/insert into storage\.buckets/);
    expect(sql).toMatch(/'onebook-reports'/);
  });

  it("grants no storage policy to a browser session", () => {
    expect(sql).not.toMatch(/create policy[\s\S]{0,200}on storage\.objects/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```
cd ctyhp-accounting
npx vitest run tests/unit/saved-reports-migration.test.ts
```

Expected: FAIL — `ENOENT: no such file or directory ... 0101_saved_reports.sql`.

- [ ] **Step 3: Write the migration**

Create `ctyhp-accounting/supabase/migrations/0101_saved_reports.sql`:

```sql
-- ============================================================================
-- 0101  Keeping a report that came from somewhere else
--
-- Asked for on the import screen, 2026-08-05: "Boss Alex want to save outside
-- report in One Book, so every time he pull it."
--
-- Importing a file posts it. This is the opposite: a report produced by another
-- product is kept exactly as it arrived and read again later. Nothing here
-- calls acc_post_entry, writes a journal line, or records a bank transaction,
-- and tests assert that rather than trusting this comment.
--
-- The bucket has no storage.objects policy for an application session, so a
-- browser cannot reach an object at all. Every transfer is authorised in the
-- application, against the company schema the request resolved, and carried by
-- a short-lived signed URL minted with the service role. That is deliberate:
-- the policies on 'accounting-documents' are global objects pinned to public.,
-- so outside the first company they consult the wrong table — a gap this
-- migration steps around rather than inherits.
-- ============================================================================

set search_path = public;

create table if not exists acc_saved_report (
  id             uuid primary key default gen_random_uuid(),
  title          text not null check (length(btrim(title)) > 0),
  source         text not null
                 check (source in ('quickbooks', 'wave', 'bank', 'spreadsheet', 'other')),
  period_start   date,
  period_end     date,
  notes          text,
  file_name      text not null check (length(btrim(file_name)) > 0),
  storage_bucket text not null default 'onebook-reports'
                 check (storage_bucket = 'onebook-reports'),
  storage_path   text not null unique check (storage_path !~ '\.\.'),
  mime_type      text not null check (mime_type in (
                   'text/csv',
                   'application/pdf',
                   'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                   'image/png',
                   'image/jpeg'
                 )),
  size_bytes     int not null check (size_bytes between 1 and 10485760),
  sha256         text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  status         text not null default 'active' check (status in ('active', 'archived')),
  uploaded_by    uuid references auth.users (id),
  uploaded_at    timestamptz not null default now(),
  archived_by    uuid references auth.users (id),
  archived_at    timestamptz,
  archive_reason text,
  check (period_end is null or period_start is null or period_end >= period_start)
);

-- The same file cannot be saved twice while a live copy is here. Archiving one
-- frees its hash, so a corrected re-issue of the same report can be saved after
-- the old copy is retired.
create unique index if not exists acc_saved_report_sha_idx
  on acc_saved_report (sha256) where status = 'active';

create index if not exists acc_saved_report_listing_idx
  on acc_saved_report (status, uploaded_at desc);

alter table acc_saved_report enable row level security;

drop policy if exists acc_saved_report_sel on acc_saved_report;
create policy acc_saved_report_sel on acc_saved_report
  for select using (acc_has_permission('documents.read'));

-- No insert, update or delete policy exists, so an application session can only
-- write this table through the two functions below.
revoke all on table acc_saved_report from public, anon;
grant select on table acc_saved_report to authenticated;
grant all    on table acc_saved_report to service_role;

/**
 * Record a report that has already been uploaded to the bucket.
 *
 * The upload was authorised when its signed URL was minted; this is where the
 * row that makes it findable is written, and where a second copy of the same
 * file is refused.
 */
create or replace function acc_register_saved_report(
  p_title        text,
  p_source       text,
  p_period_start date,
  p_period_end   date,
  p_notes        text,
  p_file_name    text,
  p_storage_path text,
  p_mime_type    text,
  p_size_bytes   int,
  p_sha256       text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not acc_has_permission('documents.manage') then
    raise exception 'Not authorized to save a report';
  end if;

  if exists (select 1 from acc_saved_report
              where sha256 = p_sha256 and status = 'active') then
    raise exception 'This report is already saved (%)',
      (select title from acc_saved_report
        where sha256 = p_sha256 and status = 'active' limit 1);
  end if;

  insert into acc_saved_report (
    title, source, period_start, period_end, notes,
    file_name, storage_path, mime_type, size_bytes, sha256, uploaded_by
  ) values (
    btrim(p_title), p_source, p_period_start, p_period_end, nullif(btrim(coalesce(p_notes, '')), ''),
    btrim(p_file_name), p_storage_path, p_mime_type, p_size_bytes, p_sha256, auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

/**
 * Retire a saved report.
 *
 * There is no delete. A report somebody relied on last quarter should still be
 * explicable next quarter, so it keeps its row, its reason and its actor.
 */
create or replace function acc_archive_saved_report(p_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not acc_has_permission('documents.manage') then
    raise exception 'Not authorized to archive a report';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Say why this report is being archived';
  end if;

  update acc_saved_report
     set status = 'archived',
         archived_by = auth.uid(),
         archived_at = now(),
         archive_reason = btrim(p_reason)
   where id = p_id and status = 'active';

  if not found then
    raise exception 'Report not found, or already archived';
  end if;
end;
$$;

revoke all on function acc_register_saved_report(text, text, date, date, text, text, text, text, int, text)
  from public, anon;
grant execute on function acc_register_saved_report(text, text, date, date, text, text, text, text, int, text)
  to authenticated, service_role;

revoke all on function acc_archive_saved_report(uuid, text) from public, anon;
grant execute on function acc_archive_saved_report(uuid, text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- The bucket. Global: one copy for the whole deployment, held back from company
-- schemas by scopeOf(). Private, and with no policy for `authenticated`, so RLS
-- denies every direct read and write from a browser session.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'onebook-reports',
  'onebook-reports',
  false,
  10485760,
  array[
    'text/csv',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/png',
    'image/jpeg'
  ]::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
```

- [ ] **Step 4: Run the migration test and watch it pass**

```
cd ctyhp-accounting
npx vitest run tests/unit/saved-reports-migration.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Write the rollback-only behavioural harness**

Create `ctyhp-accounting/scripts/verify-saved-reports.mjs`:

```js
/**
 * Behavioural verification of the saved report functions.
 *
 * Everything happens inside ONE transaction that is always rolled back: 0101 is
 * applied, real rows are written into a real company, and none of it survives.
 * That is what makes this safe to run against a database holding real books.
 *
 * The point of the second scenario is the promise the feature makes: saving a
 * report must not move the ledger by so much as one entry.
 *
 * Run: node --env-file=.env.local scripts/verify-saved-reports.mjs
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const client = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30_000,
});

let passed = 0;
let failed = 0;

function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const one = async (sql, params = []) => (await client.query(sql, params)).rows[0];

async function scenario(name, body) {
  console.log(`\n== ${name}`);
  await client.query("savepoint case_start");
  try {
    await body();
  } catch (error) {
    failed += 1;
    console.log(`  FAIL  scenario threw — ${error.message}`);
  } finally {
    await client.query("rollback to savepoint case_start");
  }
}

async function attempt(sql, params) {
  try {
    await client.query(sql, params);
    return null;
  } catch (error) {
    await client.query("rollback to savepoint before_call");
    return error.message;
  }
}

const hash = (seed) => seed.padEnd(64, "0").slice(0, 64);

const register = (sha, title = "Wave Profit and Loss 2025") =>
  client.query(
    `select acc_register_saved_report($1, 'wave', '2025-01-01', '2025-12-31', null,
                                      'pnl.csv', $2, 'text/csv', 4096, $3) as id`,
    [title, `company/${sha}.csv`, sha],
  );

await client.connect();
await client.query("begin");
try {
  const migration = await readFile(
    join(projectRoot, "supabase", "migrations", "0101_saved_reports.sql"),
    "utf8",
  );
  await client.query(migration);
  console.log("Applied 0101 inside the transaction (never committed).");

  const admin = await one(
    `select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`,
  );
  if (!admin) throw new Error("no active admin to authenticate as");
  const asUser = (id) =>
    client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: id, role: "authenticated" }),
    ]);
  await asUser(admin.id);

  await scenario("a report is saved and can be read back", async () => {
    const sha = hash("aaaa1111");
    const created = (await register(sha)).rows[0];
    check("it returned an id", Boolean(created.id));
    const row = await one(`select * from acc_saved_report where id = $1`, [created.id]);
    check("the row is active", row?.status === "active", row?.status);
    check("the uploader was recorded", row?.uploaded_by === admin.id);
    check("the title was trimmed and kept", row?.title === "Wave Profit and Loss 2025");
  });

  await scenario("saving a report moves nothing in the ledger", async () => {
    const before = await one(
      `select (select count(*)::int from acc_journal_entry) as entries,
              (select count(*)::int from acc_journal_line)  as lines,
              (select count(*)::int from acc_bank_transaction) as bank`,
    );
    await register(hash("bbbb2222"));
    const after = await one(
      `select (select count(*)::int from acc_journal_entry) as entries,
              (select count(*)::int from acc_journal_line)  as lines,
              (select count(*)::int from acc_bank_transaction) as bank`,
    );
    check("no journal entry appeared", before.entries === after.entries,
      `${before.entries} -> ${after.entries}`);
    check("no journal line appeared", before.lines === after.lines,
      `${before.lines} -> ${after.lines}`);
    check("no bank transaction appeared", before.bank === after.bank,
      `${before.bank} -> ${after.bank}`);
  });

  await scenario("the same file cannot be saved twice", async () => {
    const sha = hash("cccc3333");
    await register(sha);
    await client.query("savepoint before_call");
    const refusal = await attempt(
      `select acc_register_saved_report('Second copy', 'wave', null, null, null,
                                        'pnl.csv', $1, 'text/csv', 4096, $2)`,
      [`company/second-${sha}.csv`, sha],
    );
    check("it is refused", /already saved/i.test(refusal ?? ""), refusal ?? "none");
  });

  await scenario("archiving frees the hash and keeps the record", async () => {
    const sha = hash("dddd4444");
    const created = (await register(sha)).rows[0];
    await client.query(`select acc_archive_saved_report($1, 'Replaced by a corrected export')`, [
      created.id,
    ]);
    const row = await one(`select * from acc_saved_report where id = $1`, [created.id]);
    check("the row is archived, not deleted", row?.status === "archived", row?.status);
    check("the reason was kept", row?.archive_reason === "Replaced by a corrected export");
    check("the actor was recorded", row?.archived_by === admin.id);
    await client.query("savepoint before_call");
    const again = await attempt(
      `select acc_register_saved_report('Corrected export', 'wave', null, null, null,
                                        'pnl.csv', $1, 'text/csv', 4096, $2)`,
      [`company/again-${sha}.csv`, sha],
    );
    check("the same file may be saved again once the old copy is retired", again === null,
      again ?? "");
  });

  await scenario("an archive with no reason is refused", async () => {
    const created = (await register(hash("eeee5555"))).rows[0];
    await client.query("savepoint before_call");
    const refusal = await attempt(`select acc_archive_saved_report($1, '   ')`, [created.id]);
    check("it is refused", /why this report is being archived/i.test(refusal ?? ""),
      refusal ?? "none");
  });

  await scenario("a viewer can read but cannot save or archive", async () => {
    const created = (await register(hash("ffff6666"))).rows[0];
    const viewer = await one(
      `select id from acc_app_user where role = 'viewer' and status = 'active' limit 1`,
    );
    if (!viewer) {
      console.log("  SKIP  no active viewer to authenticate as");
      return;
    }
    await asUser(viewer.id);

    await client.query("savepoint before_call");
    const saving = await attempt(
      `select acc_register_saved_report('Viewer upload', 'other', null, null, null,
                                        'x.csv', 'company/viewer.csv', 'text/csv', 10, $1)`,
      [hash("9999")],
    );
    check("saving is refused", /Not authorized/i.test(saving ?? ""), saving ?? "none");

    await client.query("savepoint before_call");
    const archiving = await attempt(`select acc_archive_saved_report($1, 'no reason to')`, [
      created.id,
    ]);
    check("archiving is refused", /Not authorized/i.test(archiving ?? ""), archiving ?? "none");

    await asUser(admin.id);
  });
} catch (error) {
  failed += 1;
  console.log(`  FAIL  verification threw — ${error.message}`);
} finally {
  await client.query("rollback");
  console.log("\nROLLBACK — no saved report row was kept.");
  await client.end();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 6: Register the script**

In `ctyhp-accounting/package.json`, in `"scripts"`, immediately after the `"verify:import-transactions"` line, add:

```json
    "verify:saved-reports": "node --env-file=.env.local scripts/verify-saved-reports.mjs",
```

- [ ] **Step 7: Run the harness against the live database**

```
cd ctyhp-accounting
npm run verify:saved-reports
```

Expected: every scenario PASS, then `ROLLBACK — no saved report row was kept.` and `N passed, 0 failed`. A failure here is a defect in the migration, not in the harness — read the message and fix the SQL. If `SUPABASE_DB_URL` cannot connect from this network, say so plainly and do not mark the task done.

- [ ] **Step 8: Commit**

```bash
cd /c/Users/pit010/QUICKBOOK_WEBAPP
git add ctyhp-accounting/supabase/migrations/0101_saved_reports.sql ctyhp-accounting/scripts/verify-saved-reports.mjs ctyhp-accounting/package.json ctyhp-accounting/tests/unit/saved-reports-migration.test.ts
git commit -m "Keep a saved report out of the ledger, and prove it"
```

---

### Task 3: The service layer

**Files:**
- Create: `ctyhp-accounting/lib/db/storage-admin.ts`
- Create: `ctyhp-accounting/lib/services/saved-reports.ts`
- Test: `ctyhp-accounting/tests/unit/saved-reports-service.test.ts`

**Interfaces:**
- Consumes: `SAVED_REPORT_BUCKET`, `savedReportStoragePath`, `isTabularSavedReport`, `savedReportRegisterSchema`, `SavedReportRegisterInput`, `SavedReportSource` from `@/lib/domain/saved-reports`; `acc_register_saved_report` and `acc_archive_saved_report` from Task 2.
- Produces:
  - `class SavedReportError extends Error`
  - `interface SavedReportRow { id, title, source, period_start, period_end, notes, file_name, storage_path, mime_type, size_bytes, sha256, status, uploaded_by, uploaded_at, archived_at, archive_reason }`
  - `createSavedReportUploadTicket(companyId: string, mimeType: string): Promise<{ path: string; token: string }>`
  - `registerSavedReport(sb: SupabaseClient, input: SavedReportRegisterInput): Promise<string>`
  - `listSavedReports(sb: SupabaseClient, includeArchived: boolean): Promise<SavedReportRow[]>`
  - `createSavedReportDownloadUrl(sb: SupabaseClient, id: string): Promise<{ url: string; fileName: string }>`
  - `readSavedReportText(sb: SupabaseClient, id: string): Promise<string>`
  - `archiveSavedReport(sb: SupabaseClient, id: string, reason: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `ctyhp-accounting/tests/unit/saved-reports-service.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const storage = {
  createSignedUploadUrl: vi.fn(),
  createSignedUrl: vi.fn(),
  download: vi.fn(),
};
vi.mock("@/lib/db/storage-admin", () => ({
  createSavedReportStorageClient: () => ({ storage: { from: () => storage } }),
}));

const {
  SavedReportError,
  archiveSavedReport,
  createSavedReportDownloadUrl,
  createSavedReportUploadTicket,
  readSavedReportText,
  registerSavedReport,
} = await import("@/lib/services/saved-reports");

/** A Supabase client stub that answers exactly the calls the service makes. */
function stubClient(options: {
  row?: Record<string, unknown> | null;
  rpcError?: { message: string; code?: string };
}) {
  return {
    rpc: vi.fn(async () => ({
      data: options.rpcError ? null : "3f2c1b8e-0000-4000-8000-000000000001",
      error: options.rpcError ?? null,
    })),
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: options.row ?? null, error: null }),
        }),
      }),
    }),
  } as never;
}

const csvRow = {
  id: "3f2c1b8e-0000-4000-8000-000000000001",
  file_name: "pnl.csv",
  storage_path: "company/object.csv",
  mime_type: "text/csv",
};

beforeEach(() => {
  storage.createSignedUploadUrl.mockReset();
  storage.createSignedUrl.mockReset();
  storage.download.mockReset();
});

describe("createSavedReportUploadTicket", () => {
  it("returns the path it minted the ticket for", async () => {
    storage.createSignedUploadUrl.mockResolvedValue({
      data: { path: "ignored", token: "tok" },
      error: null,
    });
    const ticket = await createSavedReportUploadTicket(
      "6d0f1e2a-1111-4222-8333-444455556666",
      "text/csv",
    );
    expect(ticket.token).toBe("tok");
    expect(ticket.path.startsWith("6d0f1e2a-1111-4222-8333-444455556666/")).toBe(true);
    expect(ticket.path.endsWith(".csv")).toBe(true);
  });

  it("does not swallow a storage failure", async () => {
    storage.createSignedUploadUrl.mockResolvedValue({ data: null, error: { message: "no bucket" } });
    await expect(createSavedReportUploadTicket("c", "text/csv")).rejects.toThrow(SavedReportError);
  });
});

describe("registerSavedReport", () => {
  const input = {
    title: "Wave Profit and Loss 2025",
    source: "wave" as const,
    period_start: null,
    period_end: null,
    notes: null,
    file_name: "pnl.csv",
    storage_path: "company/object.csv",
    mime_type: "text/csv" as const,
    size_bytes: 4096,
    sha256: "a".repeat(64),
  };

  it("returns the new id", async () => {
    await expect(registerSavedReport(stubClient({}), input)).resolves.toBe(
      "3f2c1b8e-0000-4000-8000-000000000001",
    );
  });

  it("passes the database's own refusal through instead of a generic message", async () => {
    const sb = stubClient({ rpcError: { message: "This report is already saved (Wave P&L)" } });
    await expect(registerSavedReport(sb, input)).rejects.toThrow(
      "This report is already saved (Wave P&L)",
    );
  });
});

describe("readSavedReportText", () => {
  it("refuses a format the viewer cannot render, rather than returning bytes as text", async () => {
    const sb = stubClient({ row: { ...csvRow, mime_type: "application/pdf" } });
    await expect(readSavedReportText(sb, csvRow.id)).rejects.toThrow(
      "This report cannot be shown as a table",
    );
    expect(storage.download).not.toHaveBeenCalled();
  });

  it("refuses a report this company cannot see", async () => {
    const sb = stubClient({ row: null });
    await expect(readSavedReportText(sb, csvRow.id)).rejects.toThrow("Report not found");
    expect(storage.download).not.toHaveBeenCalled();
  });

  it("returns the text once the session client has confirmed the row", async () => {
    storage.download.mockResolvedValue({ data: new Blob(["Account,Balance\nCash,1\n"]), error: null });
    await expect(readSavedReportText(stubClient({ row: csvRow }), csvRow.id)).resolves.toContain(
      "Account,Balance",
    );
  });
});

describe("createSavedReportDownloadUrl", () => {
  it("asks for a download rather than an inline view", async () => {
    storage.createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://x/y" }, error: null });
    const result = await createSavedReportDownloadUrl(stubClient({ row: csvRow }), csvRow.id);
    expect(result).toEqual({ url: "https://x/y", fileName: "pnl.csv" });
    expect(storage.createSignedUrl).toHaveBeenCalledWith("company/object.csv", 60, {
      download: "pnl.csv",
    });
  });

  it("refuses a report the session cannot see", async () => {
    await expect(createSavedReportDownloadUrl(stubClient({ row: null }), csvRow.id)).rejects.toThrow(
      "Report not found",
    );
    expect(storage.createSignedUrl).not.toHaveBeenCalled();
  });
});

describe("archiveSavedReport", () => {
  it("does not swallow the database's refusal", async () => {
    const sb = stubClient({ rpcError: { message: "Not authorized to archive a report" } });
    await expect(archiveSavedReport(sb, csvRow.id, "wrong file")).rejects.toThrow(
      "Not authorized to archive a report",
    );
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```
cd ctyhp-accounting
npx vitest run tests/unit/saved-reports-service.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/services/saved-reports"`.

- [ ] **Step 3: Write the storage client**

Create `ctyhp-accounting/lib/db/storage-admin.ts`:

```ts
import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SAVED_REPORT_BUCKET } from "@/lib/domain/saved-reports";

/**
 * A service-role client for one job: moving bytes in and out of the
 * `onebook-reports` bucket.
 *
 * That bucket has no storage policy for an application session, because a
 * policy on `storage.objects` is a single global object and cannot tell which
 * company is asking. Authorisation therefore happens in the service, against
 * the company schema the request already resolved, and this client only carries
 * what the session client has already agreed to.
 *
 * It must never read or write a table. Accounting data stays under RLS and the
 * role guards, without exception.
 */
export function createSavedReportStorageClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key || key.length < 20 || /^REPLACE/i.test(key)) {
    throw new Error(
      `Saving a report needs SUPABASE_SERVICE_ROLE_KEY in the environment; ` +
        `the ${SAVED_REPORT_BUCKET} bucket is private and has no session policy.`,
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
```

- [ ] **Step 4: Write the service**

Create `ctyhp-accounting/lib/services/saved-reports.ts`:

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSavedReportStorageClient } from "@/lib/db/storage-admin";
import {
  isTabularSavedReport,
  SAVED_REPORT_BUCKET,
  savedReportStoragePath,
  type SavedReportRegisterInput,
  type SavedReportSource,
} from "@/lib/domain/saved-reports";

export class SavedReportError extends Error {}

export interface SavedReportRow {
  id: string;
  title: string;
  source: SavedReportSource;
  period_start: string | null;
  period_end: string | null;
  notes: string | null;
  file_name: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  status: "active" | "archived";
  uploaded_by: string | null;
  uploaded_at: string;
  archived_at: string | null;
  archive_reason: string | null;
}

const COLUMNS =
  "id,title,source,period_start,period_end,notes,file_name,storage_path,mime_type," +
  "size_bytes,sha256,status,uploaded_by,uploaded_at,archived_at,archive_reason";

/** How long a signed link lives. Long enough to click, short enough to be useless if shared. */
const LINK_SECONDS = 60;

/** The largest slice of a CSV the preview will ever pull across. */
const PREVIEW_BYTES = 1_000_000;

/**
 * A one-time ticket the browser can upload to.
 *
 * The caller has already established that this session may write in this
 * company. The path is minted here rather than accepted from the client, so a
 * request cannot name a path belonging to another company.
 */
export async function createSavedReportUploadTicket(
  companyId: string,
  mimeType: string,
): Promise<{ path: string; token: string }> {
  const path = savedReportStoragePath(companyId, mimeType, crypto.randomUUID());
  const admin = createSavedReportStorageClient();
  const { data, error } = await admin.storage.from(SAVED_REPORT_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    throw new SavedReportError(error?.message ?? "Could not prepare the upload");
  }
  return { path, token: data.token };
}

export async function registerSavedReport(
  sb: SupabaseClient,
  input: SavedReportRegisterInput,
): Promise<string> {
  const { data, error } = await sb.rpc("acc_register_saved_report", {
    p_title: input.title,
    p_source: input.source,
    p_period_start: input.period_start,
    p_period_end: input.period_end,
    p_notes: input.notes,
    p_file_name: input.file_name,
    p_storage_path: input.storage_path,
    p_mime_type: input.mime_type,
    p_size_bytes: input.size_bytes,
    p_sha256: input.sha256,
  });
  if (error) throw new SavedReportError(error.message);
  return data as string;
}

export async function listSavedReports(
  sb: SupabaseClient,
  includeArchived = false,
): Promise<SavedReportRow[]> {
  let query = sb.from("acc_saved_report").select(COLUMNS);
  if (!includeArchived) query = query.eq("status", "active");
  const { data, error } = await query.order("uploaded_at", { ascending: false });
  if (error) throw new SavedReportError(error.message);
  return (data ?? []) as unknown as SavedReportRow[];
}

/**
 * Read the row through the session client first.
 *
 * This is where authorisation for the object happens: the session client is
 * bound to one company's schema and filtered by `documents.read`, so a row it
 * cannot see is a report this request may not have.
 */
async function requireReadableRow(sb: SupabaseClient, id: string): Promise<SavedReportRow> {
  const { data, error } = await sb
    .from("acc_saved_report")
    .select(COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new SavedReportError(error.message);
  if (!data) throw new SavedReportError("Report not found");
  return data as unknown as SavedReportRow;
}

export async function createSavedReportDownloadUrl(
  sb: SupabaseClient,
  id: string,
): Promise<{ url: string; fileName: string }> {
  const row = await requireReadableRow(sb, id);
  const admin = createSavedReportStorageClient();
  const { data, error } = await admin.storage
    .from(SAVED_REPORT_BUCKET)
    .createSignedUrl(row.storage_path, LINK_SECONDS, { download: row.file_name });
  if (error || !data) throw new SavedReportError(error?.message ?? "Could not prepare the download");
  return { url: data.signedUrl, fileName: row.file_name };
}

/**
 * The text of a saved CSV, read by the server so the browser never holds a
 * storage credential for a preview it only renders.
 */
export async function readSavedReportText(sb: SupabaseClient, id: string): Promise<string> {
  const row = await requireReadableRow(sb, id);
  if (!isTabularSavedReport(row.mime_type)) {
    throw new SavedReportError("This report cannot be shown as a table. Download it instead.");
  }
  const admin = createSavedReportStorageClient();
  const { data, error } = await admin.storage.from(SAVED_REPORT_BUCKET).download(row.storage_path);
  if (error || !data) throw new SavedReportError(error?.message ?? "Could not read the report");
  const text = await data.slice(0, PREVIEW_BYTES).text();
  return text;
}

export async function archiveSavedReport(
  sb: SupabaseClient,
  id: string,
  reason: string,
): Promise<void> {
  const { error } = await sb.rpc("acc_archive_saved_report", { p_id: id, p_reason: reason });
  if (error) throw new SavedReportError(error.message);
}
```

- [ ] **Step 5: Run the tests and watch them pass**

```
cd ctyhp-accounting
npx vitest run tests/unit/saved-reports-service.test.ts
```

Expected: PASS, 10 tests.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/pit010/QUICKBOOK_WEBAPP
git add ctyhp-accounting/lib/db/storage-admin.ts ctyhp-accounting/lib/services/saved-reports.ts ctyhp-accounting/tests/unit/saved-reports-service.test.ts
git commit -m "Carry a saved report's bytes without handing out a credential"
```

---

### Task 4: The screen — list, actions, and the way in

At the end of this task `/reports/saved` exists, lists what is saved, and archives a report. Uploading and viewing arrive in Tasks 5 and 6; until then the page shows the empty state and the list, which is enough to be reviewed on its own.

**Files:**
- Create: `ctyhp-accounting/app/(app)/reports/saved/actions.ts`
- Create: `ctyhp-accounting/app/(app)/reports/saved/page.tsx`
- Create: `ctyhp-accounting/app/(app)/reports/saved/SavedReportsClient.tsx`
- Modify: `ctyhp-accounting/lib/domain/report-catalog.ts`
- Modify: `ctyhp-accounting/components/reports/ReportsHub.tsx`
- Test: `ctyhp-accounting/tests/unit/report-catalog.test.ts` (create if absent)

**Interfaces:**
- Consumes: everything Task 3 produced; `SAVED_REPORT_SOURCE_LABEL` from Task 1.
- Produces, for Tasks 5 and 6:
  - `interface SavedReportActionResult<T = undefined> { ok: boolean; error?: string; data?: T }`
  - `createSavedReportUploadTicketAction(mimeType: string): Promise<SavedReportActionResult<{ path: string; token: string; bucket: string }>>`
  - `registerSavedReportAction(input: SavedReportRegisterInput): Promise<SavedReportActionResult<{ id: string }>>`
  - `archiveSavedReportAction(id: string, reason: string): Promise<SavedReportActionResult>`
  - `savedReportDownloadUrlAction(id: string): Promise<SavedReportActionResult<{ url: string; fileName: string }>>`
  - `savedReportPreviewAction(id: string): Promise<SavedReportActionResult<{ text: string }>>`
  - `SavedReportsClient` props: `{ reports: SavedReportRow[]; canManage: boolean }`

- [ ] **Step 1: Write the failing test**

Create `ctyhp-accounting/tests/unit/report-catalog.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { REPORT_CATALOG, REPORT_GROUPS } from "@/lib/domain/report-catalog";

describe("REPORT_CATALOG", () => {
  it("offers the saved reports archive", () => {
    const entry = REPORT_CATALOG.find((report) => report.id === "saved-reports");
    expect(entry).toBeDefined();
    expect(entry?.href).toBe("/reports/saved");
    expect(entry?.group).toBe("accounting");
  });

  it("gives every report a group that exists", () => {
    const groups = new Set(REPORT_GROUPS.map((group) => group.id));
    for (const report of REPORT_CATALOG) expect(groups.has(report.group)).toBe(true);
  });

  it("gives every report a unique id and href", () => {
    expect(new Set(REPORT_CATALOG.map((r) => r.id)).size).toBe(REPORT_CATALOG.length);
    expect(new Set(REPORT_CATALOG.map((r) => r.href)).size).toBe(REPORT_CATALOG.length);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```
cd ctyhp-accounting
npx vitest run tests/unit/report-catalog.test.ts
```

Expected: FAIL — `expected undefined to be defined` for the `saved-reports` entry.

- [ ] **Step 3: Add the catalog entry and its icon**

In `ctyhp-accounting/lib/domain/report-catalog.ts`, inside `REPORT_CATALOG`, immediately after the `journal-report` entry, add:

```ts
  {
    id: "saved-reports",
    title: "Saved Reports",
    description:
      "Keep a report from QuickBooks, Wave, or a bank and read it here later. Saved reports never affect a balance.",
    href: "/reports/saved",
    group: "accounting",
  },
```

In `ctyhp-accounting/components/reports/ReportsHub.tsx`, add `InboxOutlined` to the existing `@ant-design/icons` import list, and add to `REPORT_ICONS` after the `"journal-report"` line:

```tsx
  "saved-reports": <InboxOutlined />,
```

- [ ] **Step 4: Run the catalog test and watch it pass**

```
cd ctyhp-accounting
npx vitest run tests/unit/report-catalog.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Write the server actions**

Create `ctyhp-accounting/app/(app)/reports/saved/actions.ts`:

```ts
"use server";
import { revalidatePath } from "next/cache";
import { canWrite } from "@/lib/domain/roles";
import { getUserRole } from "@/lib/auth";
import { resolveActiveCompany } from "@/lib/db/company";
import { createSupabaseServerClient } from "@/lib/db/server";
import {
  savedReportArchiveSchema,
  savedReportRegisterSchema,
  SAVED_REPORT_BUCKET,
  type SavedReportRegisterInput,
} from "@/lib/domain/saved-reports";
import {
  archiveSavedReport,
  createSavedReportDownloadUrl,
  createSavedReportUploadTicket,
  readSavedReportText,
  registerSavedReport,
  SavedReportError,
} from "@/lib/services/saved-reports";

export interface SavedReportActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

async function guardManage(): Promise<string | null> {
  const role = await getUserRole();
  return canWrite(role) ? null : "You do not have permission to save a report";
}

function msg(error: unknown): string {
  if (error instanceof SavedReportError || error instanceof Error) return error.message;
  return "An unexpected error occurred";
}

export async function createSavedReportUploadTicketAction(
  mimeType: string,
): Promise<SavedReportActionResult<{ path: string; token: string; bucket: string }>> {
  const denied = await guardManage();
  if (denied) return { ok: false, error: denied };
  const company = await resolveActiveCompany();
  if (!company.active) return { ok: false, error: "No company is selected" };
  try {
    const ticket = await createSavedReportUploadTicket(company.active.id, mimeType);
    return { ok: true, data: { ...ticket, bucket: SAVED_REPORT_BUCKET } };
  } catch (error) {
    return { ok: false, error: msg(error) };
  }
}

export async function registerSavedReportAction(
  input: SavedReportRegisterInput,
): Promise<SavedReportActionResult<{ id: string }>> {
  const denied = await guardManage();
  if (denied) return { ok: false, error: denied };
  const parsed = savedReportRegisterSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That report cannot be saved" };
  }
  try {
    const sb = await createSupabaseServerClient();
    const id = await registerSavedReport(sb, parsed.data);
    revalidatePath("/reports/saved");
    return { ok: true, data: { id } };
  } catch (error) {
    return { ok: false, error: msg(error) };
  }
}

export async function archiveSavedReportAction(
  id: string,
  reason: string,
): Promise<SavedReportActionResult> {
  const denied = await guardManage();
  if (denied) return { ok: false, error: denied };
  const parsed = savedReportArchiveSchema.safeParse({ id, reason });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That report cannot be archived" };
  }
  try {
    const sb = await createSupabaseServerClient();
    await archiveSavedReport(sb, parsed.data.id, parsed.data.reason);
    revalidatePath("/reports/saved");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: msg(error) };
  }
}

export async function savedReportDownloadUrlAction(
  id: string,
): Promise<SavedReportActionResult<{ url: string; fileName: string }>> {
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await createSavedReportDownloadUrl(sb, id) };
  } catch (error) {
    return { ok: false, error: msg(error) };
  }
}

export async function savedReportPreviewAction(
  id: string,
): Promise<SavedReportActionResult<{ text: string }>> {
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: { text: await readSavedReportText(sb, id) } };
  } catch (error) {
    return { ok: false, error: msg(error) };
  }
}
```

Note there is no role guard on the two read actions: the session client is filtered by the `documents.read` policy, and a row the caller may not see is refused as "Report not found" inside the service. Adding a role check here would be a second, looser statement of the same rule.

- [ ] **Step 6: Write the page**

Create `ctyhp-accounting/app/(app)/reports/saved/page.tsx`:

```tsx
import PageHeader from "@/components/PageHeader";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import { getUserRole } from "@/lib/auth";
import { resolveActiveCompany } from "@/lib/db/company";
import { createSupabaseServerClient } from "@/lib/db/server";
import { canWrite } from "@/lib/domain/roles";
import { listSavedReports } from "@/lib/services/saved-reports";
import SavedReportsClient from "./SavedReportsClient";

export const dynamic = "force-dynamic";

export default async function SavedReportsPage() {
  const sb = await createSupabaseServerClient();
  const [entity, role, reports] = await Promise.all([
    resolveActiveCompany(),
    getUserRole(),
    listSavedReports(sb, true),
  ]);
  return (
    <div>
      <PageHeader
        meta={
          <ReportEntityBadge
            companyName={entity.active?.dbaName || entity.active?.legalName || "No company selected"}
            isSample={entity.active?.isSample ?? false}
          />
        }
        title="Saved Reports"
        description="Reports produced outside One Book, kept as they arrived. Nothing on this page affects a balance."
      />
      <SavedReportsClient reports={reports} canManage={canWrite(role)} />
    </div>
  );
}
```

- [ ] **Step 7: Write the list client**

Create `ctyhp-accounting/app/(app)/reports/saved/SavedReportsClient.tsx`:

```tsx
"use client";
import { useState } from "react";
import { App, Button, Card, Empty, Input, Modal, Space, Table, Tag } from "antd";
import { InboxOutlined } from "@ant-design/icons";
import {
  SAVED_REPORT_SOURCE_LABEL,
  type SavedReportSource,
} from "@/lib/domain/saved-reports";
import type { SavedReportRow } from "@/lib/services/saved-reports";
import { archiveSavedReportAction } from "./actions";

export interface SavedReportsClientProps {
  reports: SavedReportRow[];
  canManage: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatPeriod(row: SavedReportRow): string {
  if (!row.period_start && !row.period_end) return "—";
  return `${row.period_start ?? "…"} → ${row.period_end ?? "…"}`;
}

export default function SavedReportsClient({ reports, canManage }: SavedReportsClientProps) {
  const { message } = App.useApp();
  const [archiving, setArchiving] = useState<SavedReportRow | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const confirmArchive = async () => {
    if (!archiving) return;
    setBusy(true);
    const result = await archiveSavedReportAction(archiving.id, reason);
    setBusy(false);
    if (!result.ok) {
      message.error(result.error ?? "Could not archive that report");
      return;
    }
    message.success("Report archived");
    setArchiving(null);
    setReason("");
  };

  return (
    <Card>
      <Table
        size="small"
        rowKey="id"
        dataSource={reports}
        locale={{
          emptyText: (
            <Empty
              image={<InboxOutlined style={{ fontSize: 36 }} />}
              description="No reports saved yet. Anything saved here is kept as it arrived and never posted."
            />
          ),
        }}
        columns={[
          {
            title: "Report",
            dataIndex: "title",
            render: (title: string, row: SavedReportRow) => (
              <Space direction="vertical" size={0}>
                <span>{title}</span>
                <span style={{ color: "#8c8c8c", fontSize: 12 }}>
                  {row.file_name} · {formatBytes(row.size_bytes)}
                </span>
              </Space>
            ),
          },
          {
            title: "From",
            dataIndex: "source",
            width: 130,
            filters: (Object.keys(SAVED_REPORT_SOURCE_LABEL) as SavedReportSource[]).map((key) => ({
              text: SAVED_REPORT_SOURCE_LABEL[key],
              value: key,
            })),
            onFilter: (value, row) => row.source === value,
            render: (source: SavedReportSource) => (
              <Tag>{SAVED_REPORT_SOURCE_LABEL[source] ?? source}</Tag>
            ),
          },
          { title: "Period", width: 200, render: (_, row) => formatPeriod(row) },
          {
            title: "Saved",
            dataIndex: "uploaded_at",
            width: 130,
            render: (value: string) => value.slice(0, 10),
          },
          {
            title: "",
            width: 110,
            render: (_, row) =>
              row.status === "archived" ? (
                <Tag color="default">archived</Tag>
              ) : canManage ? (
                <Button size="small" onClick={() => setArchiving(row)}>
                  Archive
                </Button>
              ) : null,
          },
        ]}
      />

      <Modal
        open={Boolean(archiving)}
        title={`Archive "${archiving?.title ?? ""}"`}
        okText="Archive"
        confirmLoading={busy}
        onOk={confirmArchive}
        onCancel={() => {
          setArchiving(null);
          setReason("");
        }}
      >
        <p>
          The report stays in One Book with its history. Say why it is being retired so the next
          person reading it knows.
        </p>
        <Input
          placeholder="Replaced by a corrected export"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </Modal>
    </Card>
  );
}
```

- [ ] **Step 8: Check it renders**

```
cd ctyhp-accounting
npm run typecheck
npx vitest run tests/unit/rsc-antd.test.ts
```

Expected: typecheck clean, and the RSC guard passes — `page.tsx` reads no Ant Design sub-component.

- [ ] **Step 9: Commit**

```bash
cd /c/Users/pit010/QUICKBOOK_WEBAPP
git add ctyhp-accounting/app/\(app\)/reports/saved ctyhp-accounting/lib/domain/report-catalog.ts ctyhp-accounting/components/reports/ReportsHub.tsx ctyhp-accounting/tests/unit/report-catalog.test.ts
git commit -m "Give a report from another system somewhere to live"
```

---

### Task 5: Saving a report

**Files:**
- Create: `ctyhp-accounting/app/(app)/reports/saved/SaveReportModal.tsx`
- Modify: `ctyhp-accounting/app/(app)/reports/saved/SavedReportsClient.tsx`

**Interfaces:**
- Consumes: `createSavedReportUploadTicketAction`, `registerSavedReportAction` from Task 4; `calculateFileSha256` from `@/lib/client/documents`; `validateSavedReportFile`, `SAVED_REPORT_ACCEPT`, `SAVED_REPORT_SOURCES`, `SAVED_REPORT_SOURCE_LABEL` from Task 1.
- Produces: `SaveReportModal` with props `{ open: boolean; onClose: () => void; onSaved: () => void }`.

- [ ] **Step 1: Write the modal**

Create `ctyhp-accounting/app/(app)/reports/saved/SaveReportModal.tsx`:

```tsx
"use client";
import { useState } from "react";
import { App, DatePicker, Form, Input, Modal, Select, Upload } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import type { Dayjs } from "dayjs";
import { createSupabaseBrowserClient } from "@/lib/db/client";
import { calculateFileSha256 } from "@/lib/client/documents";
import {
  SAVED_REPORT_ACCEPT,
  SAVED_REPORT_SOURCES,
  SAVED_REPORT_SOURCE_LABEL,
  validateSavedReportFile,
  type SavedReportRegisterInput,
  type SavedReportSource,
} from "@/lib/domain/saved-reports";
import { createSavedReportUploadTicketAction, registerSavedReportAction } from "./actions";

export interface SaveReportModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

interface FormValues {
  title: string;
  source: SavedReportSource;
  period?: [Dayjs, Dayjs];
  notes?: string;
}

export default function SaveReportModal({ open, onClose, onSaved }: SaveReportModalProps) {
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    form.resetFields();
    setFile(null);
  };

  const submit = async () => {
    if (!file) {
      message.error("Choose the report file first");
      return;
    }
    const values = await form.validateFields();
    setBusy(true);
    let uploadedPath: string | null = null;
    try {
      const ticket = await createSavedReportUploadTicketAction(file.type);
      if (!ticket.ok || !ticket.data) throw new Error(ticket.error ?? "Could not prepare the upload");

      const sb = createSupabaseBrowserClient();
      const upload = await sb.storage
        .from(ticket.data.bucket)
        .uploadToSignedUrl(ticket.data.path, ticket.data.token, file);
      if (upload.error) throw new Error(upload.error.message);
      uploadedPath = ticket.data.path;

      const registered = await registerSavedReportAction({
        title: values.title,
        source: values.source,
        period_start: values.period?.[0]?.format("YYYY-MM-DD") ?? null,
        period_end: values.period?.[1]?.format("YYYY-MM-DD") ?? null,
        notes: values.notes?.trim() ? values.notes.trim() : null,
        file_name: file.name,
        storage_path: ticket.data.path,
        mime_type: file.type as SavedReportRegisterInput["mime_type"],
        size_bytes: file.size,
        sha256: await calculateFileSha256(file),
      });
      if (!registered.ok) throw new Error(registered.error ?? "Could not save that report");

      uploadedPath = null;
      message.success("Report saved");
      reset();
      onSaved();
    } catch (error) {
      // An uploaded object with no row is invisible and undeletable from the
      // screen, so the failed upload is cleaned up before the error is shown.
      if (uploadedPath) {
        const sb = createSupabaseBrowserClient();
        await sb.storage.from("onebook-reports").remove([uploadedPath]).catch(() => undefined);
      }
      message.error(error instanceof Error ? error.message : "Could not save that report");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Save a report from another system"
      okText="Save report"
      confirmLoading={busy}
      onOk={submit}
      onCancel={() => {
        reset();
        onClose();
      }}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" initialValues={{ source: "wave" }}>
        <Form.Item label="Report file" required>
          <Upload.Dragger
            accept={SAVED_REPORT_ACCEPT}
            maxCount={1}
            beforeUpload={(candidate) => {
              const problem = validateSavedReportFile({
                name: candidate.name,
                type: candidate.type,
                size: candidate.size,
              });
              if (problem) {
                message.error(problem);
                return Upload.LIST_IGNORE;
              }
              setFile(candidate as unknown as File);
              return false;
            }}
            onRemove={() => setFile(null)}
          >
            <p>
              <UploadOutlined /> CSV, PDF, XLSX, PNG or JPG, up to 10 MB
            </p>
            <p style={{ color: "#8c8c8c" }}>
              The file is kept exactly as it is. Nothing in it is posted to the ledger.
            </p>
          </Upload.Dragger>
        </Form.Item>
        <Form.Item
          name="title"
          label="Title"
          rules={[{ required: true, message: "Give the report a title" }]}
        >
          <Input placeholder="Profit and Loss 2025 (Wave)" maxLength={200} />
        </Form.Item>
        <Form.Item name="source" label="Where it came from" rules={[{ required: true }]}>
          <Select
            options={SAVED_REPORT_SOURCES.map((source) => ({
              value: source,
              label: SAVED_REPORT_SOURCE_LABEL[source],
            }))}
          />
        </Form.Item>
        <Form.Item name="period" label="Period it covers">
          <DatePicker.RangePicker style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item name="notes" label="Notes">
          <Input.TextArea rows={2} maxLength={2000} placeholder="Prepared by the outgoing bookkeeper" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
```

- [ ] **Step 2: Mount it from the list**

In `ctyhp-accounting/app/(app)/reports/saved/SavedReportsClient.tsx`:

Add to the imports:

```tsx
import { useRouter } from "next/navigation";
import SaveReportModal from "./SaveReportModal";
```

Add to the component body, above `const confirmArchive`:

```tsx
  const router = useRouter();
  const [saving, setSaving] = useState(false);
```

Replace the opening `<Card>` tag with:

```tsx
    <Card
      extra={
        canManage ? (
          <Button type="primary" onClick={() => setSaving(true)}>
            Save a report
          </Button>
        ) : null
      }
    >
```

And immediately before the closing `</Card>`, add:

```tsx
      <SaveReportModal
        open={saving}
        onClose={() => setSaving(false)}
        onSaved={() => {
          setSaving(false);
          router.refresh();
        }}
      />
```

- [ ] **Step 3: Check the types and the line count**

```
cd ctyhp-accounting
npm run typecheck
npx wc -l "app/(app)/reports/saved/SavedReportsClient.tsx" "app/(app)/reports/saved/SaveReportModal.tsx"
```

Expected: typecheck clean, and both files under 400 lines. If `SavedReportsClient.tsx` is close to the ceiling, move the table's `columns` array into a `savedReportColumns()` function in the same file rather than splitting the component.

- [ ] **Step 4: Commit**

```bash
cd /c/Users/pit010/QUICKBOOK_WEBAPP
git add ctyhp-accounting/app/\(app\)/reports/saved
git commit -m "Let an accountant put an outside report somewhere it will be found"
```

---

### Task 6: Reading a saved report

**Files:**
- Create: `ctyhp-accounting/app/(app)/reports/saved/SavedReportViewer.tsx`
- Modify: `ctyhp-accounting/app/(app)/reports/saved/SavedReportsClient.tsx`
- Modify: `ctyhp-accounting/app/(app)/settings/import/ImportGuidance.tsx`

**Interfaces:**
- Consumes: `savedReportPreviewAction`, `savedReportDownloadUrlAction` from Task 4; `savedReportPreview`, `isTabularSavedReport` from Task 1.
- Produces: `SavedReportViewer` with props `{ report: SavedReportRow | null; onClose: () => void }`.

- [ ] **Step 1: Write the viewer**

Create `ctyhp-accounting/app/(app)/reports/saved/SavedReportViewer.tsx`:

```tsx
"use client";
import { useCallback, useEffect, useState } from "react";
import { Alert, App, Button, Drawer, Space, Spin, Table, Typography } from "antd";
import {
  isTabularSavedReport,
  savedReportPreview,
  type SavedReportPreview,
} from "@/lib/domain/saved-reports";
import type { SavedReportRow } from "@/lib/services/saved-reports";
import { savedReportDownloadUrlAction, savedReportPreviewAction } from "./actions";

export interface SavedReportViewerProps {
  report: SavedReportRow | null;
  onClose: () => void;
}

const EMPTY: SavedReportPreview = { headers: [], rows: [], truncated: false };

export default function SavedReportViewer({ report, onClose }: SavedReportViewerProps) {
  const { message } = App.useApp();
  const [preview, setPreview] = useState<SavedReportPreview>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPreview(EMPTY);
    setProblem(null);
    if (!report || !isTabularSavedReport(report.mime_type)) return;
    setLoading(true);
    savedReportPreviewAction(report.id).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (!result.ok || !result.data) {
        setProblem(result.error ?? "Could not read that report");
        return;
      }
      setPreview(savedReportPreview(result.data.text));
    });
    return () => {
      cancelled = true;
    };
  }, [report]);

  const download = useCallback(async () => {
    if (!report) return;
    const opened = window.open("about:blank");
    if (opened) opened.opener = null;
    const result = await savedReportDownloadUrlAction(report.id);
    if (!result.ok || !result.data) {
      opened?.close();
      message.error(result.error ?? "Could not prepare the download");
      return;
    }
    if (opened) opened.location.href = result.data.url;
    else window.location.href = result.data.url;
  }, [report, message]);

  return (
    <Drawer
      open={Boolean(report)}
      onClose={onClose}
      width={900}
      title={report?.title ?? ""}
      extra={<Button onClick={download}>Download original</Button>}
    >
      {report ? (
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Typography.Text type="secondary">
            {report.file_name} · saved {report.uploaded_at.slice(0, 10)}
            {report.notes ? ` · ${report.notes}` : ""}
          </Typography.Text>

          {report.status === "archived" ? (
            <Alert
              type="warning"
              showIcon
              message="This report is archived"
              description={report.archive_reason ?? "No reason was recorded."}
            />
          ) : null}

          {!isTabularSavedReport(report.mime_type) ? (
            <Alert
              type="info"
              showIcon
              message="This format is not shown as a table"
              description="One Book shows saved CSV files on screen. Download the original to open this one."
            />
          ) : problem ? (
            <Alert type="error" showIcon message={problem} />
          ) : loading ? (
            <Spin />
          ) : (
            <>
              {preview.truncated ? (
                <Alert
                  type="info"
                  showIcon
                  message="Showing the first 500 rows. Download the original for the whole report."
                />
              ) : null}
              <Table
                size="small"
                rowKey={(_, index) => String(index)}
                pagination={{ pageSize: 25 }}
                scroll={{ x: true }}
                dataSource={preview.rows.map((row, index) => ({ index, row }))}
                columns={preview.headers.map((header, column) => ({
                  title: header || `Column ${column + 1}`,
                  key: String(column),
                  render: (_: unknown, item: { row: string[] }) => item.row[column] ?? "",
                }))}
              />
            </>
          )}
        </Space>
      ) : null}
    </Drawer>
  );
}
```

- [ ] **Step 2: Open it from the list**

In `ctyhp-accounting/app/(app)/reports/saved/SavedReportsClient.tsx`:

Add to the imports:

```tsx
import SavedReportViewer from "./SavedReportViewer";
```

Add to the component body, after `const [saving, setSaving] = useState(false);`:

```tsx
  const [viewing, setViewing] = useState<SavedReportRow | null>(null);
```

In the `Report` column's `render`, make the title open the viewer by replacing `<span>{title}</span>` with:

```tsx
                <a onClick={() => setViewing(row)}>{title}</a>
```

And immediately before the closing `</Card>`, after `<SaveReportModal … />`, add:

```tsx
      <SavedReportViewer report={viewing} onClose={() => setViewing(null)} />
```

- [ ] **Step 3: Point a report at the right screen from Import**

In `ctyhp-accounting/app/(app)/settings/import/ImportGuidance.tsx`, add this alert as the last element the component renders, immediately before its closing fragment or wrapper tag:

```tsx
      <Alert
        type="info"
        showIcon
        message="Holding a report rather than a data file?"
        description={
          <>
            A Profit and Loss, a Balance Sheet or a bank statement you only want to keep can be
            saved under <a href="/reports/saved">Reports → Saved Reports</a>. Importing posts;
            saving does not affect a balance at all.
          </>
        }
      />
```

If `Alert` is not already imported in that file, add it to the existing `antd` import.

- [ ] **Step 4: Check the types**

```
cd ctyhp-accounting
npm run typecheck
npx vitest run tests/unit
```

Expected: typecheck clean and the whole unit suite green.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/pit010/QUICKBOOK_WEBAPP
git add ctyhp-accounting/app/\(app\)/reports/saved ctyhp-accounting/app/\(app\)/settings/import/ImportGuidance.tsx
git commit -m "Read a saved report without leaving One Book"
```

---

### Task 7: Gates, live migration, and the honest report

**Files:**
- Modify: `docs/superpowers/plans/2026-08-06-saved-reports.md` (tick the boxes)

- [ ] **Step 1: Run every gate**

```
cd ctyhp-accounting
npm test
npm run typecheck
npm run lint
npm run security:check-source
npm run build
```

Expected: tests all pass; typecheck silent; lint reports 0 errors (the 11 pre-existing warnings in `scripts/verify-*.mjs` are known); the credential check prints nothing; the build completes. Paste the real output. Do not proceed past a failure.

- [ ] **Step 2: Smoke the built server**

```
cd ctyhp-accounting
npm start
```

In a second shell:

```
cd ctyhp-accounting
node --env-file=.env.local scripts/smoke-pages.mjs http://localhost:3000
```

Expected: every page 200, now including `/reports/saved`. Stop the server afterwards.

Note: `npm start` dies when it is launched from the Bash tool; start it detached from PowerShell. A wall of `fetch failed` means the server is gone, not that the pages regressed.

- [ ] **Step 3: Re-run the behavioural harness**

```
cd ctyhp-accounting
npm run verify:saved-reports
```

Expected: all scenarios PASS, then `ROLLBACK`.

- [ ] **Step 4: Apply 0101 to every company schema**

```
cd ctyhp-accounting
node --env-file=.env.local scripts/migrate.mjs
```

Expected: `0101_saved_reports.sql` applied to `public`, `co_pc_49`, `co_north_star`, `co_harbor_gems` and `co_cascade_metals`. Then confirm the functions exist in each:

```
cd ctyhp-accounting
node --env-file=.env.local -e "const pg=require('pg');(async()=>{const c=new pg.Client({connectionString:process.env.SUPABASE_DB_URL,ssl:{rejectUnauthorized:false}});await c.connect();const r=await c.query(\"select n.nspname, p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in ('acc_register_saved_report','acc_archive_saved_report') order by 1,2\");console.table(r.rows);await c.end();})()"
```

Expected: both functions in all five schemas, ten rows.

- [ ] **Step 5: Tick the plan and commit**

```bash
cd /c/Users/pit010/QUICKBOOK_WEBAPP
git add docs/superpowers/plans/2026-08-06-saved-reports.md
git commit -m "Record the saved reports plan as executed"
```

- [ ] **Step 6: Report to the user, in Vietnamese**

State plainly:

- What the screen does, and the one sentence that matters: **saving a report changes no balance** — with the harness line that proves it, not the claim on its own.
- **That saved reports are not virus-scanned**, why (the multi-company gap in the attachment bucket's policies), and what stands in its place (a narrow format list, downloads never opened inline).
- That the table view is **CSV only**, and that XLSX and PDF download.
- That feedback report `428ca4db` stays `reviewing` until slice 4 gives the Wave *Account Transactions* file somewhere to go. Never resolve a feedback report from a script.
- Ask whether to continue with slice 4.
