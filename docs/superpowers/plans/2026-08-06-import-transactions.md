# Import Transactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Transactions tab on `/settings/import` that reads a categorized export from another product and, for each row, posts one two-sided journal entry and records a bank line already marked matched.

**Architecture:** One new import target whose fields cover the shapes other products actually emit — a single signed Amount or a Debit/Credit pair, a bank named per row or chosen for the file. A pure module turns any of those into one signed minor amount and a dedupe hash. One `security definer` RPC does the posting through `acc_post_entry`, so the closed-period guard and the balance check are the ones already in use.

**Tech Stack:** Next.js 16 App Router and Server Actions, React 19, TypeScript, Ant Design 5, Supabase/PostgreSQL PL/pgSQL, Vitest, Node `pg` rollback verification.

**Spec:** `docs/superpowers/specs/2026-08-06-import-transactions-design.md`
**Video:** `OneBook_Import_video.txt`, 2026-08-05, 01:34–02:26.

## Global Constraints

- Product name in user-visible copy is **One Book**. All UI copy is US English; currency is USD; "Sales Tax", never "VAT".
- Money is minor units end-to-end; convert only at the UI edge.
- **A bank account is an asset: debit means money in.** `signed = amount`, or `signed = debit − credit`. `signed > 0` debits the bank; `signed < 0` credits it.
- Posting happens **only** through `acc_post_entry(p_entry_date, p_description, p_source_type, p_source_id, p_currency, p_lines)`, never by inserting journal lines directly. Source type is `'bank'`.
- An account the company's chart does not have **refuses the whole file**. Never create an account from a transaction row.
- Re-importing the same file must change nothing: dedupe on `acc_bank_transaction (bank_account_id, raw_hash)`, which is already unique.
- Never set `created_by` / `created_at` / `updated_by` / `updated_at` from application code — `acc_stamp_actor()` owns them.
- No SQL in components. Writes go through `lib/services/data-import.ts` into the RPC.
- Adding a future product must mean adding aliases or an amount shape, not a new code path.
- Every migration must reach every company schema; the import always writes to the company the request resolved, never a named one.
- A Server Component must not read an Ant Design *sub*-component (`Typography.Title`, `Form.Item`, …).
- Keep every touched TS/TSX file under 400 lines. `ImportClient.tsx` is 378 today.
- Read the checked-in Next.js 16 docs in `node_modules/next/dist/docs/` before writing route or Server Action code.
- Verification gates, all with real pasted output: `npm test`, `npm run typecheck`, `npm run lint`, `npm run security:check-source`, `npm run build`, plus `scripts/smoke-pages.mjs`.

## File Map

| File | Responsibility |
|---|---|
| `ctyhp-accounting/lib/domain/import-mapping.ts` | Modify. `transactions` target, its fields, its label. |
| `ctyhp-accounting/lib/domain/transaction-import.ts` | Create. Signed amount, dedupe hash, row description. Pure. |
| `ctyhp-accounting/supabase/migrations/0099_import_transactions.sql` | Create. `acc_import_transactions`. |
| `ctyhp-accounting/lib/services/data-import.ts` | Modify. Preview and run for the new target. |
| `ctyhp-accounting/app/(app)/settings/import/actions.ts` | Modify. Carry the chosen bank account. |
| `ctyhp-accounting/app/(app)/settings/import/ImportClient.tsx` | Modify. The tab, the bank picker, the missing-account block. |
| `ctyhp-accounting/tests/unit/transaction-import.test.ts` | Create. Sign rule, hash, description. |
| `ctyhp-accounting/tests/unit/import-transactions-migration.test.ts` | Create. SQL contract. |
| `ctyhp-accounting/tests/unit/import-transactions-service.test.ts` | Create. Preview and run against a fake client. |
| `ctyhp-accounting/tests/unit/import-guidance-ui-contract.test.ts` | Modify. Tab, picker, ceiling. |
| `ctyhp-accounting/scripts/verify-import-transactions.mjs` | Create. Rollback-only behavioural verification. |
| `ctyhp-accounting/package.json` | Modify. `verify:import-transactions`. |

---

### Task 1: One signed amount, whatever shape the file used

**Files:**
- Modify: `ctyhp-accounting/lib/domain/import-mapping.ts`
- Create: `ctyhp-accounting/lib/domain/transaction-import.ts`
- Test: `ctyhp-accounting/tests/unit/transaction-import.test.ts`

**Interfaces:**
- Consumes: `applyMapping`'s record shape — `money` fields arrive as minor-unit numbers, `date` fields as `YYYY-MM-DD` strings.
- Produces: `ImportTarget` includes `"transactions"`; `TRANSACTION_FIELDS`; and from the new module `interface TransactionImportRecord`, `signedAmountMinor(record): SignedAmount`, `transactionRawHash(input): string`, `describeTransactionRow(record, signedMinor): string`.

- [ ] **Step 1: Write the failing tests**

Create `ctyhp-accounting/tests/unit/transaction-import.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fieldsFor, TARGET_LABEL } from "@/lib/domain/import-mapping";
import {
  describeTransactionRow,
  signedAmountMinor,
  transactionRawHash,
  type TransactionImportRecord,
} from "@/lib/domain/transaction-import";

const base: TransactionImportRecord = {
  txn_date: "2026-01-15",
  description: "Zelle Transfer",
  bank_account: "121 - PC49 BoA CK 3388",
  category_account: "Inventory Purchase",
  amount: null,
  debit: null,
  credit: null,
};

describe("the transactions target", () => {
  it("asks for a date and a category, and leaves the rest to the file's shape", () => {
    const keys = fieldsFor("transactions").map((field) => field.key);
    expect(keys).toEqual([
      "txn_date",
      "description",
      "bank_account",
      "category_account",
      "amount",
      "debit",
      "credit",
    ]);
    const required = fieldsFor("transactions")
      .filter((field) => field.required)
      .map((field) => field.key);
    expect(required).toEqual(["txn_date", "category_account"]);
    expect(TARGET_LABEL.transactions).toBe("Transactions");
  });
});

describe("signedAmountMinor", () => {
  it("takes a single Amount column as already signed", () => {
    expect(signedAmountMinor({ ...base, amount: 12550 })).toEqual({ minor: 12550 });
    expect(signedAmountMinor({ ...base, amount: -3200 })).toEqual({ minor: -3200 });
  });

  it("treats a debit as money into the bank and a credit as money out", () => {
    expect(signedAmountMinor({ ...base, debit: 32000 })).toEqual({ minor: 32000 });
    expect(signedAmountMinor({ ...base, credit: 16800 })).toEqual({ minor: -16800 });
    // Both columns present on one row: net them, as a ledger would.
    expect(signedAmountMinor({ ...base, debit: 500, credit: 200 })).toEqual({ minor: 300 });
  });

  it("refuses a row with no amount at all", () => {
    const result = signedAmountMinor(base);
    expect(result).toEqual({ problem: expect.stringMatching(/amount/i) });
  });

  it("refuses a row where Amount and Debit/Credit disagree", () => {
    const result = signedAmountMinor({ ...base, amount: 500, debit: 900 });
    expect(result).toEqual({ problem: expect.stringMatching(/disagree/i) });
  });

  it("accepts Amount alongside a Debit/Credit that agrees with it", () => {
    expect(signedAmountMinor({ ...base, amount: 300, debit: 500, credit: 200 })).toEqual({
      minor: 300,
    });
  });

  it("refuses a row whose amount is zero", () => {
    expect(signedAmountMinor({ ...base, amount: 0 })).toEqual({
      problem: expect.stringMatching(/zero/i),
    });
  });
});

describe("transactionRawHash", () => {
  const input = {
    bankAccountId: "bank-1",
    txnDate: "2026-01-15",
    description: "Zelle Transfer",
    signedMinor: 12550,
  };

  it("is stable for the same row", () => {
    expect(transactionRawHash(input)).toBe(transactionRawHash({ ...input }));
  });

  it("changes when any part of the row changes", () => {
    const original = transactionRawHash(input);
    expect(transactionRawHash({ ...input, bankAccountId: "bank-2" })).not.toBe(original);
    expect(transactionRawHash({ ...input, txnDate: "2026-01-16" })).not.toBe(original);
    expect(transactionRawHash({ ...input, description: "Other" })).not.toBe(original);
    expect(transactionRawHash({ ...input, signedMinor: -12550 })).not.toBe(original);
  });

  it("is a hex digest, not the row itself", () => {
    expect(transactionRawHash(input)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("describeTransactionRow", () => {
  it("reads as the line a person would check", () => {
    const line = describeTransactionRow({ ...base, amount: -320000 }, -320000);
    expect(line).toContain("2026-01-15");
    expect(line).toContain("Inventory Purchase");
    expect(line).toContain("Zelle Transfer");
  });
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `npm test -- tests/unit/transaction-import.test.ts`

Expected: FAIL — `@/lib/domain/transaction-import` does not exist.

- [ ] **Step 3: Add the target and its fields**

In `ctyhp-accounting/lib/domain/import-mapping.ts`:

```ts
export type ImportTarget =
  | "chart_of_accounts"
  | "customers"
  | "vendors"
  | "items"
  | "invoices"
  | "transactions";
```

Add the field list beside the others:

```ts
/**
 * A categorized transaction from another product: both sides of the entry on
 * one row. Which columns carry the money differs by product, so the target
 * accepts either a signed Amount or a Debit/Credit pair and lets
 * `signedAmountMinor` decide — adding the next product is adding aliases here.
 */
const TRANSACTION_FIELDS: readonly FieldSpec[] = [
  {
    key: "txn_date",
    label: "Date",
    required: true,
    kind: "date",
    aliases: ["date", "transaction date", "posting date", "txn date"],
  },
  {
    key: "description",
    label: "Description",
    required: false,
    kind: "text",
    aliases: ["description", "memo", "notes", "details", "payee", "narrative"],
  },
  {
    key: "bank_account",
    label: "Bank account",
    required: false,
    kind: "text",
    aliases: ["bank", "bank account", "from account", "paid from", "source account"],
    hint: "Leave unmapped to use the account chosen above for every row.",
  },
  {
    key: "category_account",
    label: "Chart of account",
    required: true,
    kind: "text",
    aliases: [
      "chart of account",
      "chart of accounts",
      "category",
      "gl account",
      "expense account",
      "income account",
      "account name",
    ],
    hint: "Must already exist in this company's chart of accounts.",
  },
  {
    key: "amount",
    label: "Amount",
    required: false,
    kind: "money",
    aliases: ["amount", "total", "amount in business currency"],
    hint: "Signed: positive is money into the bank. Or map Debit and Credit instead.",
  },
  {
    key: "debit",
    label: "Debit",
    required: false,
    kind: "money",
    aliases: ["debit", "debit amount", "money in", "deposit"],
  },
  {
    key: "credit",
    label: "Credit",
    required: false,
    kind: "money",
    aliases: ["credit", "credit amount", "money out", "withdrawal"],
  },
];
```

Return it from `fieldsFor` and add `transactions: "Transactions"` to `TARGET_LABEL`.

- [ ] **Step 4: Write the pure module**

Create `ctyhp-accounting/lib/domain/transaction-import.ts`:

```ts
import { createHash } from "node:crypto";

/**
 * One categorized transaction, as the column mapper hands it over.
 *
 * `money` fields arrive already in minor units and `date` fields already as
 * `YYYY-MM-DD`; everything here is about deciding what the row *means*.
 */
export interface TransactionImportRecord {
  txn_date: string;
  description: string | null;
  bank_account: string | null;
  category_account: string;
  amount: number | null;
  debit: number | null;
  credit: number | null;
}

export type SignedAmount = { minor: number } | { problem: string };

/**
 * How much money moved, and which way.
 *
 * A bank account is an asset, so a debit is money in. Products disagree about
 * whether to write one signed column or a pair; this is the only place that
 * knows, which is what lets the next product be an alias change.
 */
export function signedAmountMinor(record: TransactionImportRecord): SignedAmount {
  const hasPair = record.debit !== null || record.credit !== null;
  const fromPair = (record.debit ?? 0) - (record.credit ?? 0);
  const fromAmount = record.amount;

  if (fromAmount === null && !hasPair) {
    return { problem: "This row has no amount: map Amount, or map Debit and Credit." };
  }
  if (fromAmount !== null && hasPair && fromAmount !== fromPair) {
    return {
      problem:
        `Amount (${fromAmount}) and Debit/Credit (${fromPair}) disagree on this row; ` +
        "map one or the other.",
    };
  }

  const minor = fromAmount ?? fromPair;
  if (minor === 0) return { problem: "This row moves zero, so there is nothing to post." };
  return { minor };
}

/**
 * The key that makes importing twice harmless.
 *
 * Two identical rows in one file are two real transactions and both are kept;
 * the same row in a file imported again is one transaction, and the unique
 * index on (bank_account_id, raw_hash) is what enforces that.
 */
export function transactionRawHash(input: {
  bankAccountId: string;
  txnDate: string;
  description: string | null;
  signedMinor: number;
}): string {
  return createHash("sha256")
    .update(
      [input.bankAccountId, input.txnDate, (input.description ?? "").trim(), input.signedMinor].join(
        " ",
      ),
    )
    .digest("hex");
}

/** The one line the dry run shows for a row. */
export function describeTransactionRow(
  record: TransactionImportRecord,
  signedMinor: number,
): string {
  const direction = signedMinor > 0 ? "in" : "out";
  return (
    `${record.txn_date} · ${record.description || "(no description)"} · ` +
    `${record.category_account} · ${direction}`
  );
}
```

- [ ] **Step 5: Run the tests and verify GREEN**

Run: `npm test -- tests/unit/transaction-import.test.ts tests/unit/import-mapping.test.ts tests/unit/import-shape.test.ts`

Expected: PASS. If `import-shape.test.ts` fails because its loop now covers a
sixth target, add `"transactions"` to the `TARGETS` array in that test — the
template must exist for every target.

- [ ] **Step 6: Commit**

```bash
git add ctyhp-accounting/lib/domain/import-mapping.ts ctyhp-accounting/lib/domain/transaction-import.ts ctyhp-accounting/tests/unit/transaction-import.test.ts ctyhp-accounting/tests/unit/import-shape.test.ts
git commit -m "Read one signed amount out of whatever shape the export used"
```

---

### Task 2: Posting a row, once

**Files:**
- Create: `ctyhp-accounting/supabase/migrations/0099_import_transactions.sql`
- Test: `ctyhp-accounting/tests/unit/import-transactions-migration.test.ts`

**Interfaces:**
- Consumes: `acc_is_staff()`, `acc_post_entry`, `acc_to_base_minor`, `acc_bank_transaction`, `acc_bank_account`, `acc_account`, `acc_reconciliation`.
- Produces: `acc_import_transactions(p_rows jsonb, p_default_bank_account_id uuid) returns jsonb` with `{ imported, skipped }`.

- [ ] **Step 1: Write the failing migration contract test**

Create `ctyhp-accounting/tests/unit/import-transactions-migration.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planCompanySchema } from "@/lib/domain/schema-template";

const file = "0099_import_transactions.sql";
const sql = readFileSync(join(process.cwd(), "supabase", "migrations", file), "utf8");

describe("import transactions migration", () => {
  it("exposes one gated function", () => {
    expect(sql).toMatch(/create or replace function acc_import_transactions\s*\(/i);
    expect(sql).toContain("acc_is_staff()");
    expect(sql).toMatch(/revoke all on function acc_import_transactions\(jsonb, uuid\) from public/i);
    expect(sql).toMatch(
      /grant execute on function acc_import_transactions\(jsonb, uuid\)\s*\n?\s*to authenticated, service_role/i,
    );
  });

  it("posts through the same door every other document uses", () => {
    expect(sql).toContain("acc_post_entry(");
    expect(sql).toContain("acc_to_base_minor(");
    // Never a direct write to the ledger.
    expect(sql).not.toMatch(/insert into acc_journal_line/i);
    expect(sql).not.toMatch(/insert into acc_journal_entry/i);
  });

  it("resolves an account by code, by code and name, or by name", () => {
    expect(sql).toMatch(/account_code\s*=/i);
    expect(sql).toMatch(/account_code \|\| ' - ' \|\| name/i);
    expect(sql).toMatch(/lower\(btrim\(/i);
    expect(sql).toMatch(/raise exception 'Account not found/i);
  });

  it("records the bank line as already matched, and links it", () => {
    expect(sql).toMatch(/insert into acc_bank_transaction/i);
    expect(sql).toMatch(/'matched'/);
    expect(sql).toMatch(/on conflict \(bank_account_id, raw_hash\) do nothing/i);
    expect(sql).toMatch(/insert into acc_reconciliation/i);
    expect(sql).toMatch(/'approved'/);
  });

  it("never creates an account from a transaction row", () => {
    expect(sql).not.toMatch(/insert into acc_account\b/i);
  });

  it("retargets into a company schema", () => {
    const plan = planCompanySchema([{ file, sql }], "co_probe");
    expect(plan.skipped).toEqual([]);
    expect(plan.statements.join("\n")).toContain("set search_path = co_probe");
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- tests/unit/import-transactions-migration.test.ts`

Expected: FAIL with `ENOENT`.

- [ ] **Step 3: Write migration 0099**

Create `ctyhp-accounting/supabase/migrations/0099_import_transactions.sql`:

```sql
-- ============================================================================
-- 0099  Bringing categorized transactions across from another product
--
-- Asked for on video, 2026-08-05: "transactions coming from Wave because it is
-- already categorized there". Each row carries both sides — a bank account and
-- a chart-of-account — so each row is a journal entry, not a line waiting to be
-- matched by hand.
--
-- Two rules this function exists to keep:
--
--   * It posts through acc_post_entry like every other document, so the closed
--     period guard and the balance check are the ones already trusted.
--   * It writes an acc_bank_transaction marked matched for every entry. Without
--     it, connecting a bank feed for the same account later would import the
--     same money a second time with nothing to say it was already here.
--
-- An account the chart does not have raises. Creating one from a transaction
-- row is how a chart of accounts fills with typos.
-- ============================================================================

set search_path = public;

/** Resolve "121", "121 - PC49 BoA CK 3388" or "PC49 BoA CK 3388" to one account. */
create or replace function acc_resolve_account_ref(p_ref text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  v_ref text := lower(btrim(coalesce(p_ref, '')));
  v_id  uuid;
begin
  if v_ref = '' then return null; end if;

  select id into v_id from acc_account
   where lower(btrim(account_code)) = v_ref and status <> 'archived'
   limit 1;
  if v_id is not null then return v_id; end if;

  select id into v_id from acc_account
   where lower(btrim(account_code || ' - ' || name)) = v_ref and status <> 'archived'
   limit 1;
  if v_id is not null then return v_id; end if;

  select id into v_id from acc_account
   where lower(btrim(name)) = v_ref and status <> 'archived'
   limit 1;
  return v_id;
end;
$$;

revoke all on function acc_resolve_account_ref(text) from public, anon;
grant execute on function acc_resolve_account_ref(text) to authenticated, service_role;

create or replace function acc_import_transactions(
  p_rows jsonb,
  p_default_bank_account_id uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r            jsonb;
  v_bank       uuid;
  v_category   uuid;
  v_signed     bigint;
  v_abs        bigint;
  v_date       date;
  v_desc       text;
  v_hash       text;
  v_currency   text;
  v_base       bigint;
  v_entry      uuid;
  v_txn        uuid;
  v_line       uuid;
  v_feed       uuid;
  v_imported   int := 0;
  v_skipped    int := 0;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to import transactions';
  end if;

  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    v_date   := (r->>'txn_date')::date;
    v_desc   := btrim(coalesce(r->>'description', ''));
    v_signed := (r->>'signed_minor')::bigint;
    v_abs    := abs(v_signed);
    if v_signed = 0 then
      raise exception 'A transaction of zero cannot be posted (%)', v_date;
    end if;

    -- The client resolved these too; doing it again here is what makes the
    -- server the authority rather than the screen.
    v_bank := coalesce(acc_resolve_account_ref(r->>'bank_account'), p_default_bank_account_id);
    if v_bank is null then
      raise exception 'Account not found for bank "%"', coalesce(r->>'bank_account', '(none)');
    end if;
    v_category := acc_resolve_account_ref(r->>'category_account');
    if v_category is null then
      raise exception 'Account not found for "%"', coalesce(r->>'category_account', '(none)');
    end if;

    v_hash := r->>'raw_hash';
    select id into v_feed from acc_bank_account where account_id = v_bank limit 1;

    -- The bank line first: if this file has been imported before, the unique
    -- index refuses it and the row is skipped whole, ledger included.
    v_txn := null;
    if v_feed is not null then
      insert into acc_bank_transaction
        (bank_account_id, txn_date, description, amount_minor, raw_hash, status, source)
      values (v_feed, v_date, v_desc, v_signed, v_hash, 'matched', 'file_upload')
      on conflict (bank_account_id, raw_hash) do nothing
      returning id into v_txn;

      if v_txn is null then
        v_skipped := v_skipped + 1;
        continue;
      end if;
    end if;

    select code into v_currency from acc_currency where is_base limit 1;
    v_base := acc_to_base_minor(v_abs, v_currency, v_date);

    v_entry := acc_post_entry(
      v_date,
      case when v_desc = '' then 'Imported transaction' else v_desc end,
      'bank', null, v_currency,
      case when v_signed > 0 then
        jsonb_build_array(
          jsonb_build_object('account_id', v_bank, 'debit_minor', v_abs, 'credit_minor', 0,
            'amount_base_minor', v_base, 'memo', v_desc),
          jsonb_build_object('account_id', v_category, 'debit_minor', 0, 'credit_minor', v_abs,
            'amount_base_minor', v_base, 'memo', v_desc)
        )
      else
        jsonb_build_array(
          jsonb_build_object('account_id', v_category, 'debit_minor', v_abs, 'credit_minor', 0,
            'amount_base_minor', v_base, 'memo', v_desc),
          jsonb_build_object('account_id', v_bank, 'debit_minor', 0, 'credit_minor', v_abs,
            'amount_base_minor', v_base, 'memo', v_desc)
        )
      end);

    -- A bank line marked matched that points at nothing would be a lie.
    if v_txn is not null then
      select id into v_line from acc_journal_line
       where journal_entry_id = v_entry and account_id = v_bank limit 1;
      insert into acc_reconciliation (bank_transaction_id, journal_line_id, status, confidence)
      values (v_txn, v_line, 'approved', 1.000);
    end if;

    v_imported := v_imported + 1;
  end loop;

  return jsonb_build_object('imported', v_imported, 'skipped', v_skipped);
end;
$$;

revoke all on function acc_import_transactions(jsonb, uuid) from public, anon;
grant execute on function acc_import_transactions(jsonb, uuid) to authenticated, service_role;
```

- [ ] **Step 4: Run the tests and verify GREEN**

Run: `npm test -- tests/unit/import-transactions-migration.test.ts tests/unit/schema-template.test.ts`

Expected: PASS, both files.

- [ ] **Step 5: Commit**

```bash
git add ctyhp-accounting/supabase/migrations/0099_import_transactions.sql ctyhp-accounting/tests/unit/import-transactions-migration.test.ts
git commit -m "Post an imported transaction through the door every document uses"
```

---

### Task 3: Preview that refuses before it posts

**Files:**
- Modify: `ctyhp-accounting/lib/services/data-import.ts`
- Test: `ctyhp-accounting/tests/unit/import-transactions-service.test.ts`

**Interfaces:**
- Consumes: `applyMapping`, `signedAmountMinor`, `transactionRawHash`, `describeTransactionRow`, and `acc_import_transactions`.
- Produces: `ImportPreview` gains `duplicates?: number` and `missingAccounts?: string[]`; `previewImport` and `runImport` accept `options.bankAccountId?: string | null`.

- [ ] **Step 1: Write the failing service tests**

Create `ctyhp-accounting/tests/unit/import-transactions-service.test.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { previewImport, runImport } from "@/lib/services/data-import";

const HEADERS = ["Date", "Description", "Bank", "Chart of account", "Amount"];
const MAPPING = {
  txn_date: 0,
  description: 1,
  bank_account: 2,
  category_account: 3,
  amount: 4,
  debit: null,
  credit: null,
};
const ROWS = [
  HEADERS,
  ["2026-01-15", "Zelle Transfer", "121 - PC49 BoA CK 3388", "Inventory Purchase", "-3200.00"],
  ["2026-01-16", "Deposit", "121 - PC49 BoA CK 3388", "Sales", "969.00"],
];

/** A chart with both accounts, and no bank transactions yet. */
function companyClient(overrides: { accounts?: string[][]; hashes?: string[] } = {}) {
  const accounts = overrides.accounts ?? [
    ["121", "PC49 BoA CK 3388"],
    ["", "Inventory Purchase"],
    ["", "Sales"],
  ];
  const rpc = vi.fn().mockResolvedValue({ data: { imported: 2, skipped: 0 }, error: null });
  const from = (table: string) => {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve(
          table === "acc_account"
            ? {
                data: accounts.map(([account_code, name], index) => ({
                  id: `account-${index}`,
                  account_code,
                  name,
                })),
                error: null,
              }
            : {
                data: (overrides.hashes ?? []).map((raw_hash) => ({ raw_hash })),
                error: null,
              },
        ).then(resolve),
    };
    return chain;
  };
  return { rpc, from } as unknown as SupabaseClient & { rpc: typeof rpc };
}

describe("previewImport for transactions", () => {
  it("counts the rows it can post and names the ones it cannot", async () => {
    const sb = companyClient();

    const preview = await previewImport(sb, "transactions", ROWS, MAPPING);

    expect(preview.creates).toBe(2);
    expect(preview.missingAccounts ?? []).toEqual([]);
    expect(preview.rows[0].name).toContain("Inventory Purchase");
  });

  it("blocks the file by naming every account the chart does not have", async () => {
    const sb = companyClient({ accounts: [["121", "PC49 BoA CK 3388"]] });

    const preview = await previewImport(sb, "transactions", ROWS, MAPPING);

    expect(preview.missingAccounts).toEqual(["Inventory Purchase", "Sales"]);
  });

  it("reports a row already imported rather than counting it again", async () => {
    const first = await previewImport(companyClient(), "transactions", ROWS, MAPPING);
    const knownHash = String(first.rows[0].key);
    const sb = companyClient({ hashes: [knownHash] });

    const preview = await previewImport(sb, "transactions", ROWS, MAPPING);

    expect(preview.duplicates).toBe(1);
    expect(preview.creates).toBe(1);
  });

  it("refuses a row with no amount, and keeps the others", async () => {
    const rows = [...ROWS, ["2026-01-17", "No amount", "121 - PC49 BoA CK 3388", "Sales", ""]];

    const preview = await previewImport(companyClient(), "transactions", rows, MAPPING);

    expect(preview.problems.some((problem) => /amount/i.test(problem.message))).toBe(true);
    expect(preview.creates).toBe(2);
  });
});

describe("runImport for transactions", () => {
  it("sends resolved rows and the chosen bank account to the RPC", async () => {
    const sb = companyClient();

    const outcome = await runImport(sb, "transactions", ROWS, MAPPING, {
      bankAccountId: "account-0",
    });

    expect(outcome.created).toBe(2);
    expect(sb.rpc).toHaveBeenCalledWith(
      "acc_import_transactions",
      expect.objectContaining({ p_default_bank_account_id: "account-0" }),
    );
    const sent = sb.rpc.mock.calls[0][1] as { p_rows: Record<string, unknown>[] };
    expect(sent.p_rows[0]).toMatchObject({
      txn_date: "2026-01-15",
      category_account: "Inventory Purchase",
      signed_minor: -320000,
    });
    expect(String(sent.p_rows[0].raw_hash)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses to run at all when an account is missing", async () => {
    const sb = companyClient({ accounts: [["121", "PC49 BoA CK 3388"]] });

    await expect(
      runImport(sb, "transactions", ROWS, MAPPING, { bankAccountId: "account-0" }),
    ).rejects.toThrow(/Inventory Purchase/);
    expect(sb.rpc).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- tests/unit/import-transactions-service.test.ts`

Expected: FAIL — the transactions case does not exist.

- [ ] **Step 3: Extend the preview type and add the transactions case**

In `ctyhp-accounting/lib/services/data-import.ts`, extend `ImportPreview`:

```ts
  /** Rows already imported, matched on their hash. Counted, never re-posted. */
  duplicates?: number;
  /** Accounts named by the file that this company's chart does not have. */
  missingAccounts?: string[];
```

Add a helper and the preview branch, before the `existingKeys` call:

```ts
/** Every way a file may name an account, mapped to the account it means. */
async function accountIndex(sb: SupabaseClient): Promise<Map<string, string>> {
  const { data, error } = await sb
    .from("acc_account")
    .select("id,account_code,name")
    .neq("status", "archived");
  if (error) throw new DataImportError(error.message);
  const index = new Map<string, string>();
  for (const row of (data ?? []) as { id: string; account_code: string; name: string }[]) {
    const add = (key: string) => {
      const k = key.trim().toLowerCase();
      if (k) index.set(k, row.id);
    };
    add(row.account_code);
    add(row.name);
    add(`${row.account_code} - ${row.name}`);
  }
  return index;
}

async function existingHashes(sb: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await sb.from("acc_bank_transaction").select("raw_hash");
  if (error) throw new DataImportError(error.message);
  return new Set(((data ?? []) as { raw_hash: string }[]).map((row) => row.raw_hash));
}
```

The preview branch, mirroring the invoices branch already in the file:

```ts
  if (target === "transactions") {
    const [index, hashes] = await Promise.all([accountIndex(sb), existingHashes(sb)]);
    const records = parsed.records as unknown as TransactionImportRecord[];
    const problems = [...parsed.problems];
    const missing = new Set<string>();
    const rows: ImportPreviewRow[] = [];
    let duplicates = 0;

    records.forEach((record, position) => {
      const signed = signedAmountMinor(record);
      if ("problem" in signed) {
        problems.push({ row: position + 1, message: signed.problem });
        return;
      }
      const bankRef = record.bank_account ?? "";
      const bankId = index.get(bankRef.trim().toLowerCase()) ?? options.bankAccountId ?? null;
      if (bankRef && !index.has(bankRef.trim().toLowerCase())) missing.add(bankRef);
      if (!index.has(record.category_account.trim().toLowerCase())) {
        missing.add(record.category_account);
      }

      const hash = transactionRawHash({
        bankAccountId: bankId ?? "",
        txnDate: record.txn_date,
        description: record.description,
        signedMinor: signed.minor,
      });
      if (hashes.has(hash)) {
        duplicates += 1;
        return;
      }
      rows.push({
        key: hash,
        name: describeTransactionRow(record, signed.minor),
        action: "create",
        openingBalanceMinor: signed.minor,
        values: { ...record, signed_minor: signed.minor },
      });
    });

    return {
      target,
      rows,
      problems,
      blankRows: parsed.blankRows,
      creates: rows.length,
      updates: 0,
      openingTotalMinor: rows.reduce((sum, row) => sum + row.openingBalanceMinor, 0),
      duplicates,
      missingAccounts: [...missing],
    };
  }
```

`previewImport` takes a third options argument to carry the chosen bank account:

```ts
export async function previewImport(
  sb: SupabaseClient,
  target: ImportTarget,
  rows: readonly (readonly string[])[],
  mapping: Record<string, number | null>,
  options: { bankAccountId?: string | null } = {},
): Promise<ImportPreview> {
```

- [ ] **Step 4: Add the run branch**

In `runImport`, beside the invoices branch:

```ts
  if (target === "transactions") {
    const preview = await previewImport(sb, target, rows, mapping, options);
    if (preview.missingAccounts && preview.missingAccounts.length > 0) {
      throw new DataImportError(
        `These accounts are not in this company's chart of accounts: ${preview.missingAccounts.join(", ")}. ` +
          "Import the chart of accounts first.",
      );
    }
    if (preview.rows.length === 0) {
      throw new DataImportError("Nothing in this file could be imported");
    }
    const { data, error } = await sb.rpc("acc_import_transactions", {
      p_rows: preview.rows.map((row) => ({
        txn_date: row.values.txn_date,
        description: row.values.description,
        bank_account: row.values.bank_account,
        category_account: row.values.category_account,
        signed_minor: row.values.signed_minor,
        raw_hash: row.key,
      })),
      p_default_bank_account_id: options.bankAccountId ?? null,
    });
    if (error) throw new DataImportError(error.message);
    const result = (Array.isArray(data) ? data[0] : data) as
      | { imported?: number; skipped?: number }
      | null;
    return {
      created: Number(result?.imported ?? 0),
      updated: 0,
      skipped: Number(result?.skipped ?? 0) + (preview.duplicates ?? 0),
    };
  }
```

and widen its options to `{ openingBalancesAsOf?: string | null; bankAccountId?: string | null }`.

- [ ] **Step 5: Run the tests and typecheck**

Run: `npm test -- tests/unit/import-transactions-service.test.ts`

Expected: PASS, 6 tests.

Run: `npm run typecheck`

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add ctyhp-accounting/lib/services/data-import.ts ctyhp-accounting/tests/unit/import-transactions-service.test.ts
git commit -m "Refuse an import that names an account this company does not have"
```

---

### Task 4: The tab

**Files:**
- Modify: `ctyhp-accounting/app/(app)/settings/import/actions.ts`
- Modify: `ctyhp-accounting/app/(app)/settings/import/ImportClient.tsx`
- Modify: `ctyhp-accounting/app/(app)/settings/import/page.tsx`
- Test: `ctyhp-accounting/tests/unit/import-guidance-ui-contract.test.ts`

**Interfaces:**
- Consumes: `previewImport`, `runImport` with `options.bankAccountId`.
- Produces: the `transactions` tab, a bank-account picker, and a step-3 block when `missingAccounts` is non-empty.

- [ ] **Step 1: Extend the UI contract test**

Add to `ctyhp-accounting/tests/unit/import-guidance-ui-contract.test.ts`:

```ts
describe("the transactions tab", () => {
  it("offers the tab and a bank account to post against", () => {
    const client = read("ImportClient.tsx");
    expect(client).toContain('"transactions"');
    expect(client).toContain("bankAccounts");
    expect(client).toMatch(/Post to bank account/i);
  });

  it("blocks the import when the chart is missing an account", () => {
    const client = read("ImportClient.tsx");
    expect(client).toContain("missingAccounts");
    expect(client).toMatch(/Import the chart of accounts first/i);
  });

  it("keeps the import screen under the ceiling", () => {
    expect(read("ImportClient.tsx").split(/\r?\n/).length).toBeLessThanOrEqual(400);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- tests/unit/import-guidance-ui-contract.test.ts`

Expected: FAIL on the three new cases.

- [ ] **Step 3: Pass the bank accounts to the screen**

In `ctyhp-accounting/app/(app)/settings/import/page.tsx`, import `listAccounts`
from `@/lib/services/accounts`, load them beside whatever the page already loads,
filter to the ones a bank line can post to, and pass them down:

```tsx
  const bankAccounts = accounts.filter(
    (account) =>
      (account.account_type === "bank" || account.account_code === "1210") &&
      account.is_posting_account &&
      account.status === "active",
  );
```

`bankAccounts={bankAccounts}` on `ImportClient`.

- [ ] **Step 4: Carry the choice through the action**

In `ctyhp-accounting/app/(app)/settings/import/actions.ts`, add
`bankAccountId: string | null` to the preview and run action inputs and pass it
into `previewImport` / `runImport` as `{ bankAccountId }`. Keep every existing
guard exactly as it is.

- [ ] **Step 5: Add the tab, the picker and the block**

In `ImportClient.tsx`:

- add `"transactions"` to the `TARGETS` array so the segmented control offers it;
- add `bankAccounts: AccountRow[]` to the props and
  `const [bankAccountId, setBankAccountId] = useState<string | null>(null);`
- render the picker beside the upload button, only for this tab:

```tsx
        {target === "transactions" ? (
          <Select
            allowClear
            style={{ minWidth: 280 }}
            placeholder="Post to bank account"
            value={bankAccountId ?? undefined}
            onChange={(value) => setBankAccountId(value ?? null)}
            options={bankAccounts.map((account) => ({
              value: account.id,
              label: `${account.account_code} — ${account.name}`,
            }))}
          />
        ) : null}
```

- pass `bankAccountId` to both actions;
- above the Import button in step 3, block on missing accounts:

```tsx
          {preview.missingAccounts && preview.missingAccounts.length > 0 ? (
            <Alert
              type="error"
              showIcon
              message="Some accounts in this file are not in this company's chart of accounts"
              description={`${preview.missingAccounts.join(", ")}. Import the chart of accounts first, then bring the transactions across.`}
            />
          ) : null}
          {preview.duplicates ? (
            <Alert
              type="info"
              showIcon
              message={`${preview.duplicates} row(s) were imported before and will be skipped.`}
            />
          ) : null}
```

and add `|| (preview.missingAccounts?.length ?? 0) > 0` to the Import button's
`disabled` condition. If `Select` is no longer imported in this file, import it
from `antd` again.

- [ ] **Step 6: Run the tests, typecheck and lint**

Run:

```bash
npm test -- tests/unit/import-guidance-ui-contract.test.ts tests/unit/rsc-antd.test.ts
npm run typecheck
npx eslint 'app/(app)/settings/import/*.tsx' 'app/(app)/settings/import/actions.ts'
```

Expected: all pass with zero errors.

- [ ] **Step 7: Commit**

```bash
git add 'ctyhp-accounting/app/(app)/settings/import' ctyhp-accounting/tests/unit/import-guidance-ui-contract.test.ts
git commit -m "Bring categorized transactions in through their own tab"
```

---

### Task 5: Prove it against a real company, then ship

**Files:**
- Create: `ctyhp-accounting/scripts/verify-import-transactions.mjs`
- Modify: `ctyhp-accounting/package.json`

- [ ] **Step 1: Add the package script**

```json
"verify:import-transactions": "node --env-file=.env.local scripts/verify-import-transactions.mjs",
```

- [ ] **Step 2: Write the rollback-only harness**

Create `ctyhp-accounting/scripts/verify-import-transactions.mjs`, copying the
header comment style, `client`, `check`, `one`, `scenario` and `attempt` helpers
from `scripts/verify-bank-categories.mjs`. Body:

```js
await client.connect();
await client.query("begin");
try {
  const migration = await readFile(
    join(projectRoot, "supabase", "migrations", "0099_import_transactions.sql"),
    "utf8",
  );
  await client.query(migration);
  console.log("Applied 0099 inside the transaction (never committed).");

  const admin = await one(
    `select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`,
  );
  await client.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: admin.id, role: "authenticated" }),
  ]);

  const bank = await one(
    `select id, account_code, name from acc_account
      where account_type = 'bank' and is_posting_account and status = 'active'
      order by account_code limit 1`,
  );
  const expense = await one(
    `select id, account_code, name from acc_account
      where account_type = 'expense' and is_posting_account and status = 'active'
      order by account_code limit 1`,
  );
  if (!bank || !expense) throw new Error("need a bank and an expense account to post between");

  const rows = (hash) => JSON.stringify([
    {
      txn_date: "2026-03-15",
      description: "Imported verification",
      bank_account: bank.account_code,
      category_account: expense.name,
      signed_minor: -12345,
      raw_hash: hash,
    },
  ]);

  await scenario("a row posts an entry and a matched bank line", async () => {
    const result = await one(`select acc_import_transactions($1::jsonb, $2) as out`, [
      rows("verify-hash-1"),
      bank.id,
    ]);
    check("one row imported", result.out.imported === 1, JSON.stringify(result.out));

    const txn = await one(
      `select t.id, t.status, t.amount_minor from acc_bank_transaction t where t.raw_hash = $1`,
      ["verify-hash-1"],
    );
    check("the bank line is matched", txn?.status === "matched", txn?.status);
    check("it carries the signed amount", Number(txn.amount_minor) === -12345);

    const entry = await one(
      `select e.id, e.status,
              (select sum(debit_minor) from acc_journal_line where journal_entry_id = e.id) as debit,
              (select sum(credit_minor) from acc_journal_line where journal_entry_id = e.id) as credit
         from acc_journal_entry e
        where e.source_type = 'bank' and e.entry_date = '2026-03-15'
        order by e.posted_at desc limit 1`,
    );
    check("the entry posted", entry?.status === "posted");
    check("and it balances", String(entry.debit) === String(entry.credit), `${entry.debit}/${entry.credit}`);

    const link = await one(
      `select 1 as ok from acc_reconciliation where bank_transaction_id = $1 and status = 'approved'`,
      [txn.id],
    );
    check("the bank line points at the entry", Boolean(link));
  });

  await scenario("importing the same file twice changes nothing", async () => {
    await client.query(`select acc_import_transactions($1::jsonb, $2)`, [
      rows("verify-hash-2"),
      bank.id,
    ]);
    const before = await one(`select count(*)::int as n from acc_journal_entry`);
    const again = await one(`select acc_import_transactions($1::jsonb, $2) as out`, [
      rows("verify-hash-2"),
      bank.id,
    ]);
    const after = await one(`select count(*)::int as n from acc_journal_entry`);
    check("the second run skipped it", again.out.skipped === 1, JSON.stringify(again.out));
    check("no new entry was posted", before.n === after.n, `${before.n} -> ${after.n}`);
  });

  await scenario("an account the chart does not have refuses the call", async () => {
    await client.query("savepoint before_call");
    const refusal = await attempt(`select acc_import_transactions($1::jsonb, $2)`, [
      JSON.stringify([
        {
          txn_date: "2026-03-16",
          description: "Unknown category",
          bank_account: bank.account_code,
          category_account: "No Such Account Anywhere",
          signed_minor: -100,
          raw_hash: "verify-hash-3",
        },
      ]),
      bank.id,
    ]);
    check("it is refused", /Account not found/i.test(refusal ?? ""), refusal ?? "none");
    const leftover = await one(`select count(*)::int as n from acc_bank_transaction where raw_hash = $1`, [
      "verify-hash-3",
    ]);
    check("and nothing was written", leftover.n === 0);
  });

  await scenario("a viewer cannot import", async () => {
    const viewer = await one(
      `select id from acc_app_user where role = 'viewer' and status = 'active' limit 1`,
    );
    if (!viewer) {
      console.log("  SKIP  no active viewer to authenticate as");
      return;
    }
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: viewer.id, role: "authenticated" }),
    ]);
    await client.query("savepoint before_call");
    const refusal = await attempt(`select acc_import_transactions($1::jsonb, $2)`, [
      rows("verify-hash-4"),
      bank.id,
    ]);
    check("it is refused", /Not authorized/i.test(refusal ?? ""), refusal ?? "none");
  });
} catch (error) {
  failed += 1;
  console.log(`  FAIL  verification threw — ${error.message}`);
} finally {
  await client.query("rollback");
  console.log("\nROLLBACK — no entry and no bank line was kept.");
  await client.end();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 3: Static safety check, then run it**

Run:

```bash
grep -niE "^[^/*]*\bcommit\b" scripts/verify-import-transactions.mjs
npm run security:check-source
npm run verify:import-transactions
```

Expected: the grep prints nothing, the credential check passes, every assertion
prints PASS, the final line confirms `ROLLBACK`, and `0 failed`.

- [ ] **Step 4: Run every project gate**

```bash
npm test
npm run typecheck
npm run lint
npm run security:check-source
npm run build
```

Expected: all tests pass, typecheck and the credential check clean, lint zero
errors with only the pre-existing `scripts/verify-*.mjs` warnings, build exits 0.

- [ ] **Step 5: Smoke the built server**

Start the built server, then run:

```bash
node --env-file=.env.local scripts/smoke-pages.mjs http://127.0.0.1:3000
```

Expected: every page 200, `/settings/import` among them. Stop the server
afterwards.

- [ ] **Step 6: Apply the migration to every company**

Run: `node --env-file=.env.local scripts/migrate.mjs`

Expected: `0099_import_transactions.sql ... ok` for `public` and each company
schema, then confirm `acc_import_transactions` and `acc_resolve_account_ref`
exist in all four.

- [ ] **Step 7: Review the diff, commit and report**

```bash
git diff --check
git status --short
git log --oneline -7
```

Confirm only planned files changed and `.claude/settings.json` is untouched, then
commit the harness. In the completion report, say plainly which file this tab
reads — the categorized export named in the video — and that the *Account
Transactions* report from feedback 428ca4db still waits for slice 4.
