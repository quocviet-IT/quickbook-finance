# Scheduled Backups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take a snapshot of each company's books on a schedule, keep it where it can be found, and be able to restore it beside the running books with proof that it came back whole.

**Architecture:** The export that already exists is made deterministic and lifted into a service both the button and a cron job call. A nightly job claims a batch of the companies whose snapshots are oldest, writes each to a private bucket, and records it in a per-company `acc_backup` table — skipping any company whose books have not changed. Restore creates a new company through the existing provisioning path, loads the snapshot into it, and compares control totals.

**Tech Stack:** Next.js 16 App Router, Supabase (PostgREST + Storage), `fflate` for ZIP, Vitest 4 (`environment: "node"`, `include: ["tests/**/*.test.ts"]`), Ant Design 6.

## Global Constraints

- The working directory is `ctyhp-accounting/`. Every path below is relative to it.
- Money is integer minor units end-to-end; only the display edge converts.
- User-facing prose is US English. Code, identifiers, comments and documentation are English.
- Comments explain **why**, in the prose style the codebase already uses.
- Never swallow an error. Validating untrusted input is not swallowing.
- No hard-coded colour under `app/` or `components/`; take colour from `@/lib/design/tokens`.
- **A snapshot contains `acc_vendor_tax_profile`, which holds taxpayer identification numbers.** The manual export already refuses to hand over the archive when the audit write fails, because an unrecorded export of taxpayer data is what US-FR-013 forbids. The scheduled job inherits that rule: no audit row, no stored file.
- Test files must be `.ts` and contain no JSX. `vitest.config.ts` includes only `tests/**/*.test.ts`, so a `.tsx` test is not run at all and vitest prints "No test files found".
- Never import an Ant Design **runtime** module into a test. `import type` is free; a plain import costs 55 seconds.
- Four mandatory gates: `npm run build`, `npm test`, `npm run typecheck`, `npm run lint`.
- No Claude/AI attribution in commit messages. No force-push. Stage files individually, never `git add -A`.
- **Never trim test output.** No `tail`, no `head`, no `| grep` on a test run. A trimmed line has hidden a failure and put a red commit on main.
- Two suite files are known load-dependent flakes that pass in isolation: `tests/unit/quality-query-timing.test.ts` and `tests/unit/e2e-environment.test.ts`. A third, `tests/unit/quality-model-report.test.ts`, races vitest's own 5s default. Measure before calling any failure pre-existing — run the file alone.

## Measured before this plan was written

Do not re-derive these.

- Reading every exported table for the largest company (Pacific Four Nine):
  **28,549 rows, 42 PostgREST round trips, 18.6 seconds, 10.2 MB of raw JSON.**
- `app/api/companies/provision/route.ts` already sets `maxDuration = 300`, so
  one company fits with room. A job that walks *every* company does not stay
  fitting as companies grow, which is why the batch limit below exists.
- Row counts today: Pacific Four Nine 28,273 in the main tables; Aurora 394;
  North Star 159; Harbor Gems 9; Cascade 0. One company is the whole cost.
- The export already writes `manifest.json` carrying row counts, **per-file
  sha256**, and the control totals a restore must reproduce. The snapshot hash
  is built from those, not invented.
- The export already writes `attachments.csv` — an inventory of stored files
  with path, size, sha256 and scan status. **The bytes are not included**, so a
  snapshot does not restore documents; the inventory only lets a separate
  restore of object storage be checked.
- `readTable` in `lib/services/company-export.ts` pages with `.range()` and
  **no `.order()`**. On 2026-08-15 the live database held 20,740 journal
  lines and 7,533 journal entries in `co_pc_49` — twenty-one and eight pages
  respectively, read unordered. This is a live defect, not only a blocker
  for the hash; see Task 1.
- **Eight of the 74 exported tables have no `id` column.** They key on text:
  `acc_schema_migrations`, `acc_currency`, `acc_permission`,
  `acc_role_permission` (composite), `acc_approval_policy`, `acc_sequence`,
  `acc_purchasing_config`, `acc_1099_box`. Verified against all 114
  migrations. An unconditional `.order("id")` throws on every one of them.

## File Structure

- `lib/services/company-export.ts` — gains deterministic ordering. Existing file.
- `lib/domain/backup.ts` — new. Pure rules: the snapshot hash, the skip decision, the retention selection, the schema-version comparison. No I/O, so tests hold all of it.
- `lib/services/backup.ts` — new. Builds a snapshot, writes it to storage, records it, applies retention. Used by both the cron and the screen.
- `lib/services/backup-restore.ts` — new. Loads a snapshot into a freshly provisioned company and reports whether the control totals came back.
- `app/api/backups/run/route.ts` — new. The cron entry point.
- `app/(app)/settings/backups/page.tsx`, `BackupsClient.tsx`, `actions.ts` — new. The screen.
- `supabase/migrations/0114_backups.sql` — new. `acc_backup` and the `company.restore` permission.
- `vercel.json` — modified. A fifth cron entry.

---

### Task 1: Make the export deterministic — and fix the paged read it is hiding

This was written as housekeeping for the snapshot hash. It is not. Measured
against the live database on 2026-08-15:

```
co_pc_49   acc_journal_line   20,740 rows
co_pc_49   acc_journal_entry   7,533 rows
```

`readTable` pages those in requests of 1,000 (`PAGE` at
`lib/services/company-export.ts:11`) with no `ORDER BY`. Postgres makes no
promise about the order of an unordered query, and it does not have to answer
two of them the same way, so page 2 can repeat rows page 1 already returned and
omit others entirely. **The export of the one company that has data can already
be silently wrong** — the same total row count, with duplicates standing in for
what went missing.

That matters more than the hash. `docs/operations/backup-and-restore.md` calls
this export the verification control: the thing you compare a recovered database
against. A control that can quietly disagree with the truth is worse than none,
because it is believed.

The drill log entry dated 2026-07-29 records 957 rows across every table. The
defect was latent then. It became live when the company's ledger was imported.

**The premise this task was written on was false.** The first attempt at it
verified, against all 114 migrations, that 8 of the 74 exported tables have no
`id` column — they key on text instead:

| Table | Primary key |
|---|---|
| `acc_schema_migrations` | `filename` |
| `acc_currency` | `code` |
| `acc_permission` | `key` |
| `acc_role_permission` | `role, permission_key` (composite) |
| `acc_approval_policy` | `action_key` |
| `acc_sequence` | `key` |
| `acc_purchasing_config` | `singleton` |
| `acc_1099_box` | `code` |

An unconditional `.order("id")` would throw on every one of them, because
Postgres validates the column whether or not the table has rows. So the order
column is per table, and the third test below is the one that would have caught
this: it reads the `create table` statement out of the migrations and refuses an
order column the table does not declare.

**Files:**
- Modify: `lib/domain/company-export.ts` — the order-column map lives beside `EXPORT_TABLES`, which it must stay in step with
- Modify: `lib/services/company-export.ts` — `readTable` applies it
- Test: `tests/unit/company-export-order.test.ts`

**Interfaces:**
- Produces: `ORDER_COLUMNS: Record<string, string[]>` and `orderColumnsFor(table: string): string[]`, both exported from `lib/domain/company-export.ts`. Task 2's snapshot hash relies on the ordering they cause, not on the names.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/company-export-order.test.ts`:

```ts
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
    const sql = readdirSync(dir)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => readFileSync(join(dir, name), "utf8"))
      .join("\n");

    for (const [table, columns] of Object.entries(ORDER_COLUMNS)) {
      expect(EXPORTED, `${table} is in ORDER_COLUMNS but is not exported`).toContain(table);
      // `create table x (` or `create table if not exists x (`, then everything
      // up to the closing paren of the statement.
      const match = new RegExp(
        String.raw`create table (?:if not exists )?${table}\s*\(([\s\S]*?)\n\);`,
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/company-export-order.test.ts`
Expected: FAIL — `ORDER_COLUMNS` and `orderColumnsFor` are not exported yet, so
the import fails before any assertion runs.

- [ ] **Step 3: Add the order-column map**

In `lib/domain/company-export.ts`, below `EXPORT_TABLES` and `SENSITIVE_TABLE`:

```ts
/**
 * How each exported table is ordered when it is read.
 *
 * `readTable` pages with `.range()`, and Postgres does not have to answer two
 * unordered queries the same way — so without this, page two of a large table
 * can repeat rows page one already returned and drop others in their place. The
 * largest company here holds 20,740 journal lines, twenty-one pages of them.
 *
 * Most tables key on `id`, which is the default. These eight key on text and
 * have no `id` column at all; ordering them by one would not drift quietly, it
 * would throw, because Postgres validates the column even on an empty table.
 */
export const ORDER_COLUMNS: Record<string, string[]> = {
  acc_schema_migrations: ["filename"],
  acc_currency: ["code"],
  acc_permission: ["key"],
  acc_role_permission: ["role", "permission_key"],
  acc_approval_policy: ["action_key"],
  acc_sequence: ["key"],
  acc_purchasing_config: ["singleton"],
  acc_1099_box: ["code"],
};

export function orderColumnsFor(table: string): string[] {
  return ORDER_COLUMNS[table] ?? ["id"];
}
```

In `lib/services/company-export.ts`, import `orderColumnsFor` and apply it in
`readTable`:

```ts
async function readTable(
  sb: SupabaseClient,
  table: string,
): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = [];
  const orderBy = orderColumnsFor(table);
  for (let from = 0; ; from += PAGE) {
    let query = sb.from(table).select("*");
    for (const column of orderBy) query = query.order(column);
    const { data, error } = await query.range(from, from + PAGE - 1);
    if (error) throw new CompanyExportError(`Reading ${table} failed: ${error.message}`);
    rows.push(...((data ?? []) as Array<Record<string, unknown>>));
    if (!data || data.length < PAGE) return rows;
  }
}
```

If TypeScript objects to reassigning `query` across the `.order()` chain, give
it the type Supabase's builder returns rather than casting to `any` — a cast
here would hide exactly the kind of mistake this task exists to fix.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/company-export-order.test.ts`
Expected: PASS — 3 tests.

If the third test cannot find a `create table` statement for some table, do not
weaken the test to make it pass. Report which table, and stop: a table nobody
can find the definition of is worth a person looking at.

- [ ] **Step 5: Prove nothing else broke**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all four green. Paste each output whole — never trimmed.

- [ ] **Step 6: Commit**

```bash
git add lib/domain/company-export.ts lib/services/company-export.ts tests/unit/company-export-order.test.ts
git commit -m "fix(export): read every table in a fixed order, so a paged read cannot repeat or drop rows"
```

---

### Task 2: The pure rules

**Files:**
- Create: `lib/domain/backup.ts`
- Test: `tests/unit/backup-rules.test.ts`

**Interfaces:**
- Produces:
  - `snapshotHash(fileHashes: Record<string, string>): string`
  - `shouldSkip(current: string, previous: string | null): boolean`
  - `expiredBackups<T extends { id: string; takenAt: string }>(backups: readonly T[], keep: number): T[]`
  - `RestoreCompatibility = "ok" | "snapshot-is-newer"`
  - `restoreCompatibility(snapshotVersion: string, currentVersion: string): RestoreCompatibility`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/backup-rules.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  expiredBackups,
  restoreCompatibility,
  shouldSkip,
  snapshotHash,
} from "@/lib/domain/backup";

describe("the hash that decides whether a night is worth keeping", () => {
  it("is the same for the same files, whatever order they are given in", () => {
    // Stability is the whole point: if the hash moves on its own, every night
    // writes a new snapshot while the code believes it is comparing them.
    const a = snapshotHash({ "data/acc_account.csv": "aa", "data/acc_journal_line.csv": "bb" });
    const b = snapshotHash({ "data/acc_journal_line.csv": "bb", "data/acc_account.csv": "aa" });
    expect(a).toBe(b);
  });

  it("changes when any one file changes", () => {
    const before = snapshotHash({ "data/acc_account.csv": "aa" });
    const after = snapshotHash({ "data/acc_account.csv": "ab" });
    expect(after).not.toBe(before);
  });

  it("changes when a file is added, not only when one is edited", () => {
    const before = snapshotHash({ "data/acc_account.csv": "aa" });
    const after = snapshotHash({ "data/acc_account.csv": "aa", "data/acc_item.csv": "cc" });
    expect(after).not.toBe(before);
  });
});

describe("deciding whether to write tonight's snapshot", () => {
  it("skips when the books are byte-for-byte what they were", () => {
    expect(shouldSkip("abc", "abc")).toBe(true);
  });

  it("writes when they are not", () => {
    expect(shouldSkip("abc", "abd")).toBe(false);
  });

  it("writes when there is nothing to compare with", () => {
    // The first snapshot a company ever takes has no predecessor, and skipping
    // it would leave the company with none at all.
    expect(shouldSkip("abc", null)).toBe(false);
  });
});

describe("choosing what retention deletes", () => {
  const made = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `b${i}`,
      takenAt: `2026-08-${String(i + 1).padStart(2, "0")}`,
    }));

  it("keeps the newest and returns the rest", () => {
    const expired = expiredBackups(made(33), 30);
    expect(expired.map((b) => b.id)).toEqual(["b0", "b1", "b2"]);
  });

  it("returns nothing at exactly the limit", () => {
    // The boundary that decides whether a company loses its oldest snapshot one
    // night early.
    expect(expiredBackups(made(30), 30)).toEqual([]);
  });

  it("returns nothing below the limit", () => {
    expect(expiredBackups(made(4), 30)).toEqual([]);
  });

  it("orders by when it was taken, not by the order it was handed", () => {
    const shuffled = [made(3)[2], made(3)[0], made(3)[1]];
    expect(expiredBackups(shuffled, 2).map((b) => b.id)).toEqual(["b0"]);
  });
});

describe("whether a snapshot can be loaded by this code", () => {
  it("loads one taken on the same schema", () => {
    expect(restoreCompatibility("0111_x.sql", "0111_x.sql")).toBe("ok");
  });

  it("loads an older one, because columns added since take their defaults", () => {
    expect(restoreCompatibility("0090_x.sql", "0111_x.sql")).toBe("ok");
  });

  it("refuses one newer than the code reading it", () => {
    // A newer snapshot holds columns this code does not know about. Loading it
    // anyway drops them in silence, which is the one outcome worth refusing.
    expect(restoreCompatibility("0120_x.sql", "0111_x.sql")).toBe("snapshot-is-newer");
  });

  it("refuses when the snapshot does not say what it was taken on", () => {
    expect(restoreCompatibility("unknown", "0111_x.sql")).toBe("snapshot-is-newer");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/backup-rules.test.ts`
Expected: FAIL — `Cannot find package '@/lib/domain/backup'`.

- [ ] **Step 3: Write the rules**

Create `lib/domain/backup.ts`:

```ts
import { createHash } from "node:crypto";

/**
 * What decides whether tonight's books differ from last night's.
 *
 * Built from the per-file hashes the export manifest already carries, rather
 * than from the ZIP bytes: a ZIP embeds timestamps and would differ every night
 * whatever the books did.
 *
 * Sorted before hashing so the answer depends on the content and not on the
 * order the files happened to be built in.
 */
export function snapshotHash(fileHashes: Record<string, string>): string {
  const canonical = Object.keys(fileHashes)
    .sort()
    .map((name) => `${name}:${fileHashes[name]}`)
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Whether tonight can be left alone.
 *
 * Four of five companies here hold under 400 rows and may not change for weeks.
 * Thirty identical snapshots is not safety; it buries the ones worth looking at.
 * A company with no snapshot yet is never skipped — it would end up with none.
 */
export function shouldSkip(current: string, previous: string | null): boolean {
  return previous !== null && current === previous;
}

/** The snapshots past the retention limit, oldest first. */
export function expiredBackups<T extends { id: string; takenAt: string }>(
  backups: readonly T[],
  keep: number,
): T[] {
  const newestFirst = [...backups].sort((a, b) => b.takenAt.localeCompare(a.takenAt));
  // `slice(keep)` on the newest-first list is everything past the limit;
  // reversing puts them oldest-first, which is the order they are deleted in so
  // an interrupted run leaves the newest intact.
  return newestFirst.slice(keep).reverse();
}

export type RestoreCompatibility = "ok" | "snapshot-is-newer";

/**
 * Whether this code can load that snapshot.
 *
 * Migration filenames sort in the order they were applied, so comparing them as
 * strings compares the schemas. An older snapshot loads: columns added since
 * take their defaults. A newer one holds columns this code has never heard of,
 * and loading it anyway would drop them without a word — so it is refused, and
 * so is a snapshot that cannot say what it was taken on.
 */
export function restoreCompatibility(
  snapshotVersion: string,
  currentVersion: string,
): RestoreCompatibility {
  if (snapshotVersion === "unknown") return "snapshot-is-newer";
  return snapshotVersion > currentVersion ? "snapshot-is-newer" : "ok";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/backup-rules.test.ts`
Expected: PASS — 15 tests.

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: typecheck exit 0; lint 0 errors (11 pre-existing warnings in `lib/domain/periods.ts` and `scripts/verify-*.mjs`).

- [ ] **Step 6: Commit**

```bash
git add lib/domain/backup.ts tests/unit/backup-rules.test.ts
git commit -m "feat(backup): the rules that decide what is kept and what can be loaded"
```

---

### Task 3: Where a backup is recorded

**Files:**
- Create: `supabase/migrations/0114_backups.sql`
- Test: `tests/unit/backup-migration.test.ts`

**Interfaces:**
- Produces: table `acc_backup`, permission key `company.restore`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/backup-migration.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(join(process.cwd(), "supabase/migrations/0114_backups.sql"), "utf8");
// A Windows checkout ends lines with \r\n, and `.` does not match \r — a
// comment stripper written as /--.*$/ removes nothing here and every assertion
// below passes on a sentence in a comment. This has bitten this repository
// twice.
const body = sql
  .split(/\r?\n/)
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

describe("the backups migration", () => {
  it("creates the register in the company's own schema", () => {
    expect(body).toMatch(/create table if not exists acc_backup/i);
  });

  it("records what a restore has to check against", () => {
    for (const column of [
      "taken_at",
      "content_hash",
      "storage_path",
      "size_bytes",
      "schema_version",
      "control_totals",
      "status",
      "skip_reason",
    ]) {
      expect(body, `acc_backup is missing ${column}`).toContain(column);
    }
  });

  it("allows a skipped night to carry no file", () => {
    // A night where nothing changed is recorded, and has no storage path.
    expect(body).toMatch(/storage_path\s+text\b(?!\s+not null)/i);
  });

  it("refuses two snapshots of the same content on the same day", () => {
    expect(body).toMatch(/unique\s*\(\s*taken_at\s*,\s*content_hash\s*\)/i);
  });

  it("adds the permission that restoring takes", () => {
    expect(body).toContain("company.restore");
    // Restoring copies a whole book into a new company, so it is governed like
    // the other things that shape a company rather than like reading a report.
    expect(body).toMatch(/'company\.restore'.*'Governance'/s);
  });

  it("enables row-level security, like every other company table", () => {
    expect(body).toMatch(/alter table acc_backup enable row level security/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/backup-migration.test.ts`
Expected: FAIL — `ENOENT`, the migration does not exist.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/0114_backups.sql`:

```sql
-- One row per night a backup was considered, whether or not it produced a file.
--
-- Lives in the company's own schema like acc_import_batch, so row-level
-- security applies without a cross-company function.
create table if not exists acc_backup (
  id uuid primary key default gen_random_uuid(),
  taken_at date not null,
  -- Built from the export manifest's per-file hashes. A ZIP embeds timestamps
  -- and would differ every night whatever the books did.
  content_hash text not null,
  -- Null on a night that was skipped because nothing had changed.
  storage_path text,
  size_bytes bigint,
  schema_version text not null,
  control_totals jsonb not null,
  status text not null check (status in ('stored', 'skipped', 'failed')),
  skip_reason text,
  created_at timestamptz not null default now(),
  -- The same content on the same day is the same snapshot. Two runs in one
  -- night must not leave two rows claiming to be it.
  unique (taken_at, content_hash)
);

alter table acc_backup enable row level security;

create policy acc_backup_read on acc_backup
  for select using (acc_has_permission('company.export'));

comment on table acc_backup is
  'Nightly snapshots of this company''s books: what was taken, what it hashed to, and where it was put.';

-- Reading a snapshot is the same data by the same means as company.export, so
-- it reuses that. Restoring creates a company and copies an entire book, which
-- is strictly larger, so it gets its own.
insert into acc_permission (key, label, category, description, is_enforced)
values (
  'company.restore',
  'Restore a backup',
  'Governance',
  'Restore a backup into a new company, beside the running books',
  true
)
on conflict (key) do nothing;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/backup-migration.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Confirm the provisioning self-check still passes**

A migration that a new company cannot be built from is worse than none.

Run: `npm run verify:company-provisioning`
Expected: passes, and reports the new migration in the count.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0114_backups.sql tests/unit/backup-migration.test.ts
git commit -m "feat(backup): record every night a snapshot was considered"
```

---

### Task 4: Taking and keeping a snapshot

**Files:**
- Create: `lib/services/backup.ts`
- Test: `tests/unit/backup-service.test.ts`

**Interfaces:**
- Consumes: `snapshotDescription`, `snapshotHash`, `shouldSkip`, `expiredBackups` (Task 2); `collectExportDatasets`, `readControlTotals`, `readSchemaVersion` (existing).
- **Two changes Task 2 made that this task's code below predates.** `snapshotHash`
  is `async` — it reuses the existing `sha256Hex`, so it must be awaited. And the
  manifest is reduced to `{path: sha256}` by `snapshotDescription(manifest)`,
  which is the one place `generatedAt` and the actor are excluded. **Call it —
  do not build that record inline.** Nothing in the type system stops you: it
  takes a plain `Record<string, string>`, so a hand-built object of the same
  shape compiles. It would also silently reintroduce the defect the whole
  feature turns on, because a hash that moves every night makes `shouldSkip`
  never fire, and that failure raises no error at all.
- Produces:
  - `BACKUP_BUCKET = "onebook-backups"`
  - `BACKUP_KEEP = 30`
  - `takeCompanyBackup(sb, companyId, today): Promise<{ status: "stored" | "skipped"; hash: string; path: string | null; sizeBytes: number | null }>`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/backup-service.test.ts`. The test drives the service with a
stub client and asserts the three outcomes that matter: a first snapshot is
stored, an unchanged one is skipped without writing a file, and a snapshot is
not kept when the audit write fails.

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { SupabaseClient } from "@supabase/supabase-js";
import { takeCompanyBackup } from "@/lib/services/backup";

interface StubOptions {
  previousHash?: string | null;
  auditFails?: boolean;
}

/**
 * Enough of Supabase to drive the service.
 *
 * The datasets are deliberately tiny — this test is about the decisions the
 * service makes, not about the export, which has its own tests.
 */
function stub(options: StubOptions = {}) {
  const uploaded: string[] = [];
  const removed: string[] = [];
  const inserted: Record<string, unknown>[] = [];
  const sb = {
    from(table: string) {
      const chain: Record<string, unknown> = {
        select: () => chain,
        order: () => chain,
        eq: () => chain,
        limit: () => chain,
        range: () => Promise.resolve({ data: [], error: null }),
        maybeSingle: () =>
          Promise.resolve({
            data:
              table === "acc_backup"
                ? options.previousHash === undefined
                  ? null
                  : { content_hash: options.previousHash }
                : { filename: "0114_backups.sql" },
            error: null,
          }),
        insert: (row: Record<string, unknown>) => {
          inserted.push({ table, ...row });
          return Promise.resolve({
            error: table === "acc_audit_log" && options.auditFails ? { message: "no" } : null,
          });
        },
        delete: () => chain,
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(resolve),
      };
      return chain;
    },
    rpc: () => Promise.resolve({ data: [], error: null }),
    storage: {
      from() {
        return {
          upload: (path: string) => {
            uploaded.push(path);
            return Promise.resolve({ error: null });
          },
          remove: (paths: string[]) => {
            removed.push(...paths);
            return Promise.resolve({ error: null });
          },
        };
      },
    },
  } as unknown as SupabaseClient;
  return { sb, uploaded, removed, inserted };
}

describe("taking a company's nightly snapshot", () => {
  it("stores the first one, because there is nothing to compare it with", async () => {
    const { sb, uploaded } = stub({ previousHash: undefined });
    const result = await takeCompanyBackup(sb, "company-1", "2026-08-16");
    expect(result.status).toBe("stored");
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]).toMatch(/^company-1\/2026-08-16-[0-9a-f]{8}\.zip$/);
  });

  it("skips a night the books did not move, and writes no file", async () => {
    const first = stub({ previousHash: undefined });
    const seen = await takeCompanyBackup(first.sb, "company-1", "2026-08-16");

    const again = stub({ previousHash: seen.hash });
    const result = await takeCompanyBackup(again.sb, "company-1", "2026-08-17");
    expect(result.status).toBe("skipped");
    expect(result.path).toBeNull();
    expect(again.uploaded).toHaveLength(0);
  });

  it("keeps no file when the taxpayer data could not be recorded", async () => {
    // The manual export already refuses to hand over an archive it could not
    // record, because the snapshot carries taxpayer identification numbers. An
    // unattended job inherits the rule rather than being an exception to it.
    const { sb, removed } = stub({ previousHash: undefined, auditFails: true });
    await expect(takeCompanyBackup(sb, "company-1", "2026-08-16")).rejects.toThrow(/record/i);
    expect(removed).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/backup-service.test.ts`
Expected: FAIL — `Cannot find package '@/lib/services/backup'`.

- [ ] **Step 3: Write the service**

Create `lib/services/backup.ts`. It reuses the archive the manual export already
knows how to build, so the button and the job cannot drift apart.

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { expiredBackups, shouldSkip, snapshotDescription, snapshotHash } from "@/lib/domain/backup";
import {
  collectExportDatasets,
  readControlTotals,
  readSchemaVersion,
} from "@/lib/services/company-export";
import { buildExportArchive } from "@/lib/services/company-export";

export class BackupError extends Error {}

/** Private, and shaped like `onebook-reports`, which already holds saved files. */
export const BACKUP_BUCKET = "onebook-backups";

/** How many snapshots a company keeps. Size is not the constraint; noise is. */
export const BACKUP_KEEP = 30;

export async function takeCompanyBackup(
  sb: SupabaseClient,
  companyId: string,
  today: string,
): Promise<{
  status: "stored" | "skipped";
  hash: string;
  path: string | null;
  sizeBytes: number | null;
}> {
  const datasets = await collectExportDatasets(sb);
  const controlTotals = await readControlTotals(sb, today);
  const schemaVersion = await readSchemaVersion(sb);
  const archive = buildExportArchive({ datasets, controlTotals, schemaVersion, asOf: today });
  const hash = await snapshotHash(snapshotDescription(archive.manifest));

  const previous = await sb
    .from("acc_backup")
    .select("content_hash")
    .eq("status", "stored")
    .order("taken_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (previous.error) throw new BackupError(previous.error.message);

  if (shouldSkip(hash, (previous.data?.content_hash as string | undefined) ?? null)) {
    const { error } = await sb.from("acc_backup").insert({
      taken_at: today,
      content_hash: hash,
      storage_path: null,
      size_bytes: null,
      schema_version: schemaVersion,
      control_totals: controlTotals,
      status: "skipped",
      skip_reason: "The books have not changed since the last snapshot",
    });
    if (error) throw new BackupError(error.message);
    return { status: "skipped", hash, path: null, sizeBytes: null };
  }

  const path = `${companyId}/${today}-${hash.slice(0, 8)}.zip`;
  const upload = await sb.storage
    .from(BACKUP_BUCKET)
    .upload(path, archive.bytes, { contentType: "application/zip", upsert: true });
  if (upload.error) throw new BackupError(upload.error.message);

  // The snapshot carries acc_vendor_tax_profile, so it is taxpayer data leaving
  // the database. The manual export withholds the archive when this write
  // fails; here the file is already up, so it comes back down.
  const audit = await sb.from("acc_audit_log").insert({
    action: "company.backup",
    entity_type: "company",
    entity_id: companyId,
    detail: { storage_path: path, content_hash: hash, included_sensitive: true },
  });
  if (audit.error) {
    await sb.storage.from(BACKUP_BUCKET).remove([path]);
    throw new BackupError(`The backup was not recorded, so it was not kept: ${audit.error.message}`);
  }

  const { error } = await sb.from("acc_backup").insert({
    taken_at: today,
    content_hash: hash,
    storage_path: path,
    size_bytes: archive.bytes.byteLength,
    schema_version: schemaVersion,
    control_totals: controlTotals,
    status: "stored",
    skip_reason: null,
  });
  if (error) throw new BackupError(error.message);

  await applyRetention(sb);
  return { status: "stored", hash, path, sizeBytes: archive.bytes.byteLength };
}

/** Delete oldest-first, so an interrupted run never eats the newest snapshot. */
async function applyRetention(sb: SupabaseClient): Promise<void> {
  const { data, error } = await sb
    .from("acc_backup")
    .select("id,taken_at,storage_path")
    .eq("status", "stored")
    .order("taken_at", { ascending: false });
  if (error) throw new BackupError(error.message);
  const rows = ((data ?? []) as Array<{ id: string; taken_at: string; storage_path: string }>).map(
    (row) => ({ id: row.id, takenAt: row.taken_at, storagePath: row.storage_path }),
  );
  for (const expired of expiredBackups(rows, BACKUP_KEEP)) {
    await sb.storage.from(BACKUP_BUCKET).remove([expired.storagePath]);
    const removal = await sb.from("acc_backup").delete().eq("id", expired.id);
    if (removal.error) throw new BackupError(removal.error.message);
  }
}
```

**Note for the implementer:** `buildExportArchive` does not exist yet as a named
export. `exportCompanyDataAction` in `app/(app)/settings/company/actions.ts`
builds the ZIP inline with `fflate`'s `zipSync` and computes per-file hashes for
the manifest. Lift that block into `lib/services/company-export.ts` unchanged as
`buildExportArchive({ datasets, controlTotals, schemaVersion, asOf })` returning
`{ bytes: Uint8Array; fileHashes: Record<string, string> }`, and have the action
call it. The action's behaviour must not change — its audit write and its
withholding rule stay where they are.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/backup-service.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Prove the manual export still behaves**

Run: `npm test`
Expected: every test passes, including the existing company export tests. Paste
the output whole.

- [ ] **Step 6: Commit**

```bash
git add lib/services/backup.ts lib/services/company-export.ts "app/(app)/settings/company/actions.ts" tests/unit/backup-service.test.ts
git commit -m "feat(backup): take a snapshot, skip an unchanged night, keep thirty"
```

---

### Task 5: The nightly job

**Files:**
- Create: `app/api/backups/run/route.ts`
- Create: `lib/services/backup-queue.ts` — the pure choice of who is due
- Create: `lib/services/backup-queue-runner.ts` — the part that opens a connection and calls Task 4
- Modify: `vercel.json`
- Test: `tests/unit/backup-queue.test.ts`

**Interfaces:**
- Consumes: `takeCompanyBackup` (Task 4).
- Produces: `runDueCompanyBackups(): Promise<{ attempted: number; stored: number; skipped: number; failed: number }>`, `BACKUP_BATCH_LIMIT = 3`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/backup-queue.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { companiesDueForBackup, BACKUP_BATCH_LIMIT } from "@/lib/services/backup-queue";

const company = (slug: string, lastBackup: string | null) => ({ slug, lastBackup });

describe("choosing which companies tonight covers", () => {
  it("takes the ones waiting longest first", () => {
    // 18.6 seconds for the largest company today. A run that sweeps every
    // company stops fitting as they grow, so each run takes a batch and the
    // rest wait — the shape the provisioning queue already uses.
    const due = companiesDueForBackup([
      company("a", "2026-08-14"),
      company("b", "2026-08-10"),
      company("c", "2026-08-12"),
    ]);
    expect(due.map((c) => c.slug)).toEqual(["b", "c", "a"]);
  });

  it("puts a company that has never been backed up at the front", () => {
    const due = companiesDueForBackup([company("a", "2026-08-14"), company("new", null)]);
    expect(due[0].slug).toBe("new");
  });

  it("stops at the batch limit even with more waiting", () => {
    const many = Array.from({ length: 10 }, (_, i) => company(`c${i}`, `2026-08-0${i % 9}`));
    expect(companiesDueForBackup(many)).toHaveLength(BACKUP_BATCH_LIMIT);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/backup-queue.test.ts`
Expected: FAIL — `Cannot find package '@/lib/services/backup-queue'`.

- [ ] **Step 3: Write the queue and the route**

Create `lib/services/backup-queue.ts`:

```ts
import "server-only";

/**
 * How many companies one run covers.
 *
 * Measured: the largest company takes 18.6 seconds to read. Three fits inside
 * the 300-second ceiling the other cron routes already ask for, with room for a
 * company several times the size of today's largest.
 */
export const BACKUP_BATCH_LIMIT = 3;

export interface BackupCandidate {
  slug: string;
  /** ISO date of the last snapshot, or null if the company has never had one. */
  lastBackup: string | null;
}

/**
 * The companies this run should cover, longest-waiting first.
 *
 * A company gets a snapshot within the cycle rather than every night. Snapshots
 * are skipped anyway when nothing changed, and this exists to recover from a
 * mistake days old rather than minutes — so covering everyone eventually beats
 * a run that grows until it times out and covers nobody.
 */
export function companiesDueForBackup<T extends BackupCandidate>(companies: readonly T[]): T[] {
  return [...companies]
    .sort((a, b) => (a.lastBackup ?? "").localeCompare(b.lastBackup ?? ""))
    .slice(0, BACKUP_BATCH_LIMIT);
}
```

Create `app/api/backups/run/route.ts`, copying the authorisation block from
`app/api/companies/provision/route.ts` verbatim — it is a timing-safe compare
and must not be reinvented:

```ts
import { timingSafeEqual } from "node:crypto";
import { runDueCompanyBackups } from "@/lib/services/backup-queue-runner";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: Request): boolean {
  const configured = process.env.CRON_SECRET?.trim() ?? "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (configured.length < 24 || configured.length !== supplied.length) return false;
  return timingSafeEqual(Buffer.from(configured), Buffer.from(supplied));
}

/**
 * Tonight's snapshots.
 *
 * Covers a batch of the companies waiting longest rather than all of them: one
 * company already takes 18.6 seconds to read, and a run that sweeps everybody
 * is a run that eventually covers nobody.
 */
export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runDueCompanyBackups();
    return Response.json({ processedAt: new Date().toISOString(), ...result });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Backups failed" },
      { status: 500 },
    );
  }
}

/** Vercel cron issues GET; the behaviour is identical. */
export async function GET(request: Request) {
  return POST(request);
}
```

Create `lib/services/backup-queue-runner.ts` following
`lib/services/company-queue.ts`: open a service-role connection, read every
company and its last snapshot date, pass them through `companiesDueForBackup`,
and call `takeCompanyBackup` for each inside its own try/catch so one company's
failure records `failed` and does not stop the others.

Add to `vercel.json`, after the four entries already there:

```json
    {
      "path": "/api/backups/run",
      "schedule": "0 12 * * *"
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/backup-queue.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Prove the route exists and the schedule parses**

Run: `npm run build`
Expected: build succeeds and lists `/api/backups/run` among the routes.

- [ ] **Step 6: Commit**

```bash
git add app/api/backups/run/route.ts lib/services/backup-queue.ts lib/services/backup-queue-runner.ts vercel.json tests/unit/backup-queue.test.ts
git commit -m "feat(backup): a nightly job that covers the companies waiting longest"
```

---

### Task 6: The screen

**Files:**
- Create: `app/(app)/settings/backups/page.tsx`
- Create: `app/(app)/settings/backups/BackupsClient.tsx`
- Create: `app/(app)/settings/backups/actions.ts`
- Modify: `lib/domain/navigation.ts`
- Test: `tests/unit/backup-page-copy.test.ts`

**Interfaces:**
- Consumes: `acc_backup` (Task 3), `BACKUP_BUCKET` (Task 4).
- Produces: `listBackupsAction`, `downloadBackupAction`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/backup-page-copy.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const client = readFileSync(
  join(process.cwd(), "app/(app)/settings/backups/BackupsClient.tsx"),
  "utf8",
);

describe("what the backups screen tells a reader", () => {
  it("says outright that attachments are not in a snapshot", () => {
    // The export carries an inventory of stored files but not their bytes.
    // Unwritten, this is the misunderstanding that only surfaces at the worst
    // possible moment.
    expect(client.toLowerCase()).toMatch(/attachment/);
    expect(client.toLowerCase()).toMatch(/not included|does not include|are not/);
  });

  it("explains a night with no file rather than showing a blank row", () => {
    expect(client).toMatch(/have not changed|nothing changed|unchanged/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/backup-page-copy.test.ts`
Expected: FAIL — `ENOENT`, the client does not exist.

- [ ] **Step 3: Build the screen**

`app/(app)/settings/backups/actions.ts`. Note the permission check: this
repository has no `requirePermission` helper — a server action asks the database
directly through `acc_has_permission`, exactly as `exportCompanyDataAction` does
at `app/(app)/settings/company/actions.ts:87`, and returns the refusal in the
result rather than throwing:

```ts
"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/db/server";
import { createBackupStorageClient, BACKUP_BUCKET } from "@/lib/services/backup";

/** Long enough to click, short enough that a copied link is a spare key for long. */
const LINK_SECONDS = 300;

/** The shape the settings actions in this repository already return. */
export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

export interface BackupRow {
  id: string;
  takenOn: string;
  status: "stored" | "skipped" | "failed";
  skipReason: string | null;
  sizeBytes: number | null;
  journalLineCount: number | null;
}

async function mayExport(sb: SupabaseClient): Promise<boolean> {
  const { data, error } = await sb.rpc("acc_has_permission", { p_key: "company.export" });
  // A permission lookup that failed is not a permission granted.
  return !error && data === true;
}

export async function listBackupsAction(): Promise<ActionResult<BackupRow[]>> {
  const sb = await createSupabaseServerClient();
  if (!(await mayExport(sb))) {
    return { ok: false, error: "You do not have permission to read this company's backups" };
  }
  const { data, error } = await sb
    .from("acc_backup")
    .select("id,taken_on,status,skip_reason,size_bytes,control_totals")
    .order("taken_on", { ascending: false })
    .limit(60);
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    data: (data ?? []).map((row) => ({
      id: row.id as string,
      takenOn: row.taken_on as string,
      status: row.status as BackupRow["status"],
      skipReason: (row.skip_reason as string | null) ?? null,
      sizeBytes: (row.size_bytes as number | null) ?? null,
      journalLineCount:
        (row.control_totals as { journalLineCount?: number } | null)?.journalLineCount ?? null,
    })),
  };
}

export async function downloadBackupAction(
  id: string,
): Promise<ActionResult<{ url: string; fileName: string }>> {
  const sb = await createSupabaseServerClient();
  if (!(await mayExport(sb))) {
    return { ok: false, error: "You do not have permission to download this company's backups" };
  }
  // Read the row through the caller's own client first. The admin client below
  // ignores row-level security, so the row must be proven readable by the
  // person asking before it is used to mint a link.
  const { data, error } = await sb
    .from("acc_backup")
    .select("storage_path")
    .eq("id", id)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data?.storage_path) return { ok: false, error: "That snapshot has no stored file." };
  const path = data.storage_path as string;
  const fileName = path.split("/").pop() ?? "backup.zip";
  const admin = createBackupStorageClient();
  const signed = await admin.storage
    .from(BACKUP_BUCKET)
    .createSignedUrl(path, LINK_SECONDS, { download: fileName });
  if (signed.error || !signed.data) {
    return { ok: false, error: signed.error?.message ?? "Could not prepare the download" };
  }
  return { ok: true, data: { url: signed.data.signedUrl, fileName } };
}
```

`app/(app)/settings/backups/page.tsx`:

```tsx
import PageHeader from "@/components/PageHeader";
import { requireSettingsAccess, currentAccess } from "@/lib/db/settings-access";
import { listBackupsAction } from "./actions";
import BackupsClient from "./BackupsClient";

export const dynamic = "force-dynamic";

export default async function BackupsPage() {
  await requireSettingsAccess("/settings/backups");
  const [result, access] = await Promise.all([listBackupsAction(), currentAccess()]);
  return (
    <div>
      <PageHeader
        title="Backups"
        description="A snapshot of this company's books, taken on a schedule. Download one, or restore it into a new company to compare the two side by side."
      />
      <BackupsClient
        backups={result.ok ? (result.data ?? []) : []}
        loadError={result.ok ? null : (result.error ?? "Could not read the backups")}
        canRestore={(access.permissionKeys ?? []).includes("company.restore")}
      />
    </div>
  );
}
```

`app/(app)/settings/backups/BackupsClient.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Alert, Button, Space, message } from "antd";
import DataTable from "@/components/ui/DataTable";
import { dateColumn, statusColumn, actionsColumn } from "@/components/ui/columns";
import { longTextColumn } from "@/components/ui/long-text-column";
import { downloadBackupAction, type BackupRow } from "./actions";

function readableSize(bytes: number | null): string {
  if (bytes === null) return "—";
  return bytes >= 1_048_576
    ? `${(bytes / 1_048_576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default function BackupsClient({
  backups,
  loadError,
  canRestore,
}: {
  backups: BackupRow[];
  loadError: string | null;
  canRestore: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  async function download(row: BackupRow) {
    setBusy(row.id);
    try {
      const result = await downloadBackupAction(row.id);
      if (!result.ok || !result.data) throw new Error(result.error ?? "Could not prepare the download");
      window.location.href = result.data.url;
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Could not prepare the download");
    } finally {
      setBusy(null);
    }
  }

  const columns = [
    dateColumn<BackupRow>({ title: "Date", dataIndex: "takenOn", width: 130 }),
    statusColumn<BackupRow>({
      title: "Status",
      dataIndex: "status",
      width: 120,
      tone: (value) => (value === "stored" ? "success" : value === "skipped" ? "neutral" : "danger"),
    }),
    {
      title: "Why no file",
      dataIndex: "skipReason",
      ...longTextColumn(320),
    },
    {
      title: "Size",
      dataIndex: "sizeBytes",
      width: 110,
      align: "right" as const,
      render: (value: number | null) => readableSize(value),
    },
    {
      title: "Journal lines",
      dataIndex: "journalLineCount",
      width: 130,
      align: "right" as const,
      render: (value: number | null) => (value === null ? "—" : value.toLocaleString("en-US")),
    },
    actionsColumn<BackupRow>({
      title: "",
      width: canRestore ? 220 : 120,
      render: (_, row) => (
        <Space size="small">
          <Button
            size="small"
            disabled={row.status !== "stored"}
            loading={busy === row.id}
            onClick={() => download(row)}
          >
            Download
          </Button>
          {canRestore ? (
            <Button
              size="small"
              disabled={row.status !== "stored"}
              href={`/settings/backups/${row.id}/restore`}
            >
              Restore as new company
            </Button>
          ) : null}
        </Space>
      ),
    }),
  ];

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      {loadError ? <Alert type="error" showIcon message={loadError} /> : null}
      <Alert
        type="info"
        showIcon
        message="What a snapshot holds"
        description="A snapshot holds every table in this company's books, including vendor tax profiles. It does not include the files themselves — document scans and attachments are listed in the snapshot, but their contents are not included and a restore will not bring them back. A night with no file is one where the books have not changed since the previous snapshot."
      />
      <DataTable<BackupRow>
        rowKey="id"
        columns={columns}
        dataSource={backups}
        pagination={{ pageSize: 30 }}
      />
    </Space>
  );
}
```

Check the real signatures of `dateColumn`, `statusColumn` and `actionsColumn` in
`components/ui/columns.tsx` before writing the columns above — the kit is this
repository's own and the spec fields are named there, not guessed here.

In `lib/domain/navigation.ts`, add an entry to the Governance group's `items`
array, immediately after the `/settings/audit` entry at line 260:

```ts
      {
        href: "/settings/backups",
        title: "Backups",
        description: "Snapshots of this company's books, and restoring one into a new company.",
        anyPermissions: ["company.export"],
      },
```

Declaring it here is what makes both the card and the door work: the card comes
from this catalog, and `requireSettingsAccess("/settings/backups")` resolves its
gate through `settingsGateFor` on the same entry. A page whose href is missing
here has no gate to find.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/backup-page-copy.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 5: Prove no screen broke**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all four green. Paste each output whole.

Then start the built server and check the page renders:
`node --env-file=.env.local scripts/smoke-pages.mjs http://127.0.0.1:3000`
Expected: every page 200, including `/settings/backups`.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/settings/backups" lib/domain/navigation.ts tests/unit/backup-page-copy.test.ts
git commit -m "feat(backup): a screen that lists snapshots and says what they do not hold"
```

---

### Task 7: Restore, and the test that makes this real

Everything before this task writes files. This is the task that decides whether
any of it is a backup.

**Files:**
- Create: `lib/services/backup-restore.ts`
- Modify: `app/(app)/settings/backups/actions.ts`, `BackupsClient.tsx`
- Test: `tests/unit/backup-restore.test.ts`

**Interfaces:**
- Consumes: `restoreCompatibility` (Task 2), `acc_backup` (Task 3).
- Produces: `restoreBackupIntoNewCompany(sb, backupId, name): Promise<RestoreOutcome>` where `RestoreOutcome = { companyId: string; controlTotalsMatch: boolean; differences: string[] }`; `compareControlTotals(expected: ExportControlTotals, actual: ExportControlTotals)`; `RESTORE_EXCLUDED_TABLES`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/backup-restore.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { restoreCompatibility } from "@/lib/domain/backup";
import { RESTORE_EXCLUDED_TABLES, compareControlTotals } from "@/lib/services/backup-restore";

describe("what a restore refuses to carry over", () => {
  it("does not restore the user list or its role assignments", () => {
    // Loading these into the copy would silently grant access to a set of books
    // nobody has said those people may see. The person who ran the restore is
    // the copy's only user; the books themselves restore in full.
    expect(RESTORE_EXCLUDED_TABLES).toContain("acc_app_user");
    expect(RESTORE_EXCLUDED_TABLES).toContain("acc_role_permission");
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/backup-restore.test.ts`
Expected: FAIL — `Cannot find package '@/lib/services/backup-restore'`.

- [ ] **Step 3: Write the restore**

Create `lib/services/backup-restore.ts` exporting:

```ts
/**
 * Tables a restore deliberately leaves behind.
 *
 * These grant access. Loading them into the copy would hand a set of books to
 * whoever happened to be listed in the snapshot, without anybody deciding that.
 */
export const RESTORE_EXCLUDED_TABLES = ["acc_app_user", "acc_role_permission"] as const;

// The type `readControlTotals` already returns. Declaring a second one here
// would be two definitions of the same five figures, free to drift apart.
import type { ExportControlTotals } from "@/lib/domain/company-export";

/**
 * Whether the restored books add up to the snapshot they came from.
 *
 * Names each figure that disagrees. "The restore failed" tells nobody where to
 * look; "journalLineCount expected 3, got 2" does.
 */
export function compareControlTotals(
  expected: ExportControlTotals,
  actual: ExportControlTotals,
): { controlTotalsMatch: boolean; differences: string[] } {
  const differences: string[] = [];
  for (const key of Object.keys(expected) as Array<keyof ExportControlTotals>) {
    if (expected[key] !== actual[key]) {
      differences.push(`${key}: expected ${expected[key]}, got ${actual[key]}`);
    }
  }
  return { controlTotalsMatch: differences.length === 0, differences };
}
```

Then `restoreBackupIntoNewCompany(sb, backupId, name)`:

1. Read the `acc_backup` row; fail if `status !== 'stored'`.
2. Compare `schema_version` with the current one through `restoreCompatibility`;
   on `snapshot-is-newer`, throw with a message naming both versions.
3. Download the ZIP from `BACKUP_BUCKET` and unzip with `fflate`'s `unzipSync`.
4. Create a company through the existing provisioning path in
   `lib/services/company-queue.ts`, named `name`.
5. Insert each `data/*.csv` into the new company's schema in the order of
   `EXPORT_TABLES` — which is already dependency-ordered — skipping any table in
   `RESTORE_EXCLUDED_TABLES`.
6. Recompute control totals in the new company with `readControlTotals` and pass
   them through `compareControlTotals` against the snapshot's.
7. Return `{ companyId, controlTotalsMatch, differences }`. **Never write to the
   source company at any step.**

Wire a `restoreBackupAction(backupId, name)` behind `company.restore`, and a
button in `BackupsClient.tsx` that asks for the new company's name, then shows
the outcome — including each named difference when they do not match.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/backup-restore.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: The round trip, against a real company**

The unit tests prove the rules. This proves the feature.

Against a sample company with data — **never a live one** — run a backup, restore
it into a new company, and confirm the reported control totals match. Record the
company used, the snapshot hash, and the comparison output in the task report.

If the totals do not match, that is the finding, and the task is not done.

- [ ] **Step 6: Gates and commit**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all four green.

```bash
git add lib/services/backup-restore.ts "app/(app)/settings/backups" tests/unit/backup-restore.test.ts
git commit -m "feat(backup): restore a snapshot beside the running books, and prove it came back"
```

---

### Task 8: Tell the readers

Not optional, and not a tidy-up afterwards. The user has asked twice that a
shipped change reaches the Guide in the same piece of work.

**Files:**
- Modify: `lib/domain/changelog.ts`
- Modify: `lib/domain/system-guide.ts`
- Modify: `../docs/operations/backup-and-restore.md` (repository root, outside `ctyhp-accounting/`)

- [ ] **Step 1: Add the release**

Add this as the **first** element of `RELEASES` in `lib/domain/changelog.ts`.
`APP_VERSION` is derived from `RELEASES[0].version`, so putting it first is what
raises the version:

```ts
  {
    version: "1.21",
    date: "2026-08-15",
    headline:
      "Your books are copied on a schedule, and a copy can be opened as a second company to compare against.",
    changes: [
      {
        kind: "added",
        title: "A snapshot of your books is taken on a schedule",
        detail:
          "Settings now has a Backups page listing every snapshot taken of this "
          + "company, newest first, with the date, the size, and the number of "
          + "journal lines it holds. Each one can be downloaded as a single ZIP "
          + "file — the same file the Export button has always produced, kept "
          + "rather than only handed to the browser.",
        route: "/settings/backups",
      },
      {
        kind: "added",
        title: "A backup can be restored into a new company, without touching the running one",
        detail:
          "Restoring creates a separate company and loads the snapshot into it, "
          + "so the two sit side by side and can be compared figure by figure. "
          + "Nothing is written back to the books you are working in. After the "
          + "load, the trial balance, the receivable and payable totals and the "
          + "journal line count are recalculated and checked against the ones "
          + "recorded when the snapshot was taken; the screen says whether they "
          + "match, and names any that do not.",
        route: "/settings/backups",
      },
      {
        kind: "added",
        title: "A night where nothing changed is recorded as skipped, not copied again",
        detail:
          "A company whose books have not moved since the last snapshot gets a "
          + "row saying so and no new file. The list is therefore the history of "
          + "the days your books actually changed, which is worth reading in "
          + "itself.",
        route: "/settings/backups",
      },
      {
        kind: "changed",
        title: "Two exports of the same books now produce the same file",
        detail:
          "Rows are read in a fixed order, so exporting twice without changing "
          + "anything gives two identical files that can be compared directly. "
          + "Before this, the rows could come back in a different order each "
          + "time and the two files would differ without anything having "
          + "changed.",
        route: "/settings/company",
      },
    ],
  },
```

Note what this release does **not** claim. Attachments are not in a snapshot,
and a changelog entry that implied otherwise would be the misunderstanding the
spec set out to prevent — the screen's own alert carries that, and the guide
caution below repeats it.

- [ ] **Step 2: Add the guide flow**

Add this `GuideFlow` to the `GUIDE_FLOWS` array in `lib/domain/system-guide.ts`,
beside the other Settings-rooted flows:

```ts
  {
    id: "restore-a-backup",
    title: "Find a backup, and open it as a second company to compare against",
    purpose:
      "Your books are copied on a schedule. When a figure looks wrong, open the copy from before "
      + "it went wrong as a separate company, and read the two side by side.",
    route: "/settings/backups",
    cautions: [
      {
        title: "A snapshot does not include your attachments",
        body:
          "It holds every table in the books — accounts, entries, invoices, bills, customers, "
          + "vendors. It does not hold the files: document scans, bill attachments and feedback "
          + "images live in storage and are not copied. The snapshot lists them, so you can tell "
          + "what was attached, but restoring will not bring the files themselves back.",
      },
      {
        title: "The restored copy holds taxpayer identification numbers",
        body:
          "Vendor tax profiles come across with everything else. The copy is a company like any "
          + "other, so anybody you later give access to it can see them. Restore when you need "
          + "to, and delete the copy when the comparison is done.",
      },
      {
        title: "The people are not copied, only the books",
        body:
          "You are the restored company's only user. Nobody else gains access to a set of books "
          + "just because a copy of them was made.",
      },
    ],
    steps: [
      {
        action: "Find the day you want to go back to",
        control: "Backups",
        route: "/settings/backups",
        note:
          "One row per snapshot, newest first. A row saying skipped means the books had not "
          + "changed since the previous snapshot, so that day's figures are the ones in the row "
          + "above it.",
      },
      {
        action: "Take a copy of the file for yourself",
        control: "Download",
        note:
          "A single ZIP holding one CSV per table, plus a manifest listing the row counts and "
          + "the totals recorded when it was taken. The link is good for five minutes.",
      },
      {
        action: "Open that day's books as a separate company",
        control: "Restore as a new company",
        note:
          "Creates a new company and loads the snapshot into it. The company you are working in "
          + "is not touched, and cannot be — no part of this writes back to it.",
      },
      {
        action: "Check the copy came back whole",
        control: "Control totals",
        note:
          "After loading, the trial balance, the receivable and payable totals and the journal "
          + "line count are recalculated from the restored books and compared with the ones "
          + "recorded in the snapshot. A match is the evidence the copy is faithful. A mismatch "
          + "names the figure and both values rather than failing quietly.",
      },
      {
        action: "Read the two side by side",
        control: "Company switcher",
        note:
          "Switch between the restored copy and the running books and open the same report on "
          + "each. Comparing a balance sheet on both is the fastest way to see which account "
          + "moved and by how much.",
      },
    ],
  },
```

- [ ] **Step 3: Correct the operations runbook**

`docs/operations/backup-and-restore.md` is not incidental documentation. The
README written into every export archive ends with "Restore procedure:
docs/operations/backup-and-restore.md", so this is the page an operator opens
during an incident — the worst moment to read something untrue.

Three things in it stop being true when this ships.

Replace the paragraph at lines 32-34:

```markdown
The archive is not a substitute for a database backup. It cannot be loaded back
into the application — there is no importer. Its job is to be readable by any
tool, forever, and to let you prove a restore is correct.
```

with:

```markdown
The archive is not a substitute for a database backup: it holds one company, not
the database, and it does not carry the bytes of any attachment. But it is no
longer a dead end. Settings → Backups can load one back into a **new** company
and report whether the control totals came back — see section 4a. Restoring
*over* a damaged company is still not possible; the way back is to restore
beside it and compare.
```

Then add section 4a after section 4, and a line to section 5 saying the quarterly
drill can now be a restore rather than only a manifest comparison:

```markdown
### 4a. Restoring one company beside the running books

When one company's books are wrong and the rest of the database is healthy, a
Supabase restore is the wrong tool — it would replace every company to rescue
one. Instead:

1. **Settings → Backups** in the affected company. Pick the last snapshot before
   the damage. A row marked *skipped* means the books had not changed that day,
   so the figures are the ones in the row above it.
2. **Restore as a new company.** The running company is not written to.
3. Read the control-total result the restore reports. All five figures matching
   is the evidence the copy is faithful; a mismatch names the figure and both
   values.
4. Open the same report on both companies and compare. The difference tells you
   which account moved and by how much — which is the question an incident
   actually asks.
5. Correct the running books with a journal entry. Do not delete and re-import:
   the restored copy is evidence, and a closed period cannot be edited anyway.

The restored company holds vendor tax profiles. Delete it when the comparison is
done, and treat it as tax records until then.
```

Leave section 2 blank where it is blank. It asks for the Supabase plan's backup
retention, which is visible only to the project owner in billing, and filling it
in with a guess would be worse than the honest gap the runbook already flags.

- [ ] **Step 4: Run the tests that guard both**

Run: `npx vitest run tests/unit/changelog.test.ts tests/unit/system-guide.test.ts`
Expected: PASS. Both files assert every route named actually exists.

- [ ] **Step 5: Gates and commit**

Run: `npm test && npm run typecheck && npm run lint && npm run build`

```bash
git add lib/domain/changelog.ts lib/domain/system-guide.ts ../docs/operations/backup-and-restore.md
git commit -m "docs: tell people the backups exist, and what they do not cover"
```

---

## Acceptance criteria

- [ ] Every exported table is read with an explicit order, and a test proves it
- [ ] No order column names a column its table does not declare — checked against the migrations, not asserted
- [ ] The snapshot hash is stable across two runs over the same data
- [ ] A night whose books have not changed records a `skipped` row and writes no file
- [ ] A company with no previous snapshot is never skipped
- [ ] Retention keeps 30 and deletes oldest-first; the boundary at exactly 30 has a test
- [ ] A backup whose audit write fails leaves no file behind
- [ ] The cron covers a batch of the longest-waiting companies, not all of them
- [ ] A snapshot newer than the running code is refused, naming both versions
- [ ] A restore never writes to the source company
- [ ] A restore does not carry `acc_app_user` or `acc_role_permission`
- [ ] A restore reports control totals that match — demonstrated once against a real sample company, with the output recorded
- [ ] The screen says attachments are not included
- [ ] `changelog.ts` and `system-guide.ts` both carry the feature
- [ ] `docs/operations/backup-and-restore.md` no longer says there is no importer
- [ ] All four gates green, output pasted verbatim
