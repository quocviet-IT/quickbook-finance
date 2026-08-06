# Import Guidance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Before anyone maps a column on `/settings/import`, the screen says what the selected tab needs, offers a template that matches it exactly, and — when the file is something else — says which something else, with a way to switch.

**Architecture:** One new pure module derives everything shown from `fieldsFor(target)`, the list the mapper already uses, so guidance cannot drift from behaviour. The 413-line `ImportClient.tsx` gives up its column table in a behaviour-free move first, so the guidance panel does not push an already-over-ceiling file further over. Nothing in this slice writes to the database.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Ant Design 5, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-05-import-guidance-design.md`
**Feedback:** report `428ca4db-a090-417a-8ed6-a40ef4f7d81e`, `/settings/import`, 2026-08-04.

## Global Constraints

- Product name in user-visible copy is **One Book**. All UI copy is US English; currency is USD; "Sales Tax", never "VAT".
- **No database change.** This slice writes nothing, so there is no migration and no rollback-only verification script.
- Detection is advisory. It must never block an import the mapper would accept — the required-field gate and the dry run remain the only gates.
- Guidance is derived from `fieldsFor(target)`. No second list of field names anywhere.
- `acc_bank_transaction.category`, posting, and the ledger are untouched by this slice.
- A Server Component must not read an Ant Design *sub*-component (`Typography.Title`, `Form.Item`, …).
- Keep every touched TS/TSX file under 400 lines. `ImportClient.tsx` is **413** today; it must end this work **under 400**.
- Read the checked-in Next.js 16 docs in `node_modules/next/dist/docs/` before writing route or Server Action code.
- Verification gates, all with real pasted output: `npm test`, `npm run typecheck`, `npm run lint`, `npm run security:check-source`, `npm run build`, plus `scripts/smoke-pages.mjs`.

## File Map

| File | Responsibility |
|---|---|
| `ctyhp-accounting/lib/domain/import-shape.ts` | Create. `templateCsvFor`, `detectFileShape`, `describeShapeMismatch`. Pure. |
| `ctyhp-accounting/app/(app)/settings/import/ImportColumnsTable.tsx` | Create. The column-mapping table, moved out unchanged. |
| `ctyhp-accounting/app/(app)/settings/import/ImportGuidance.tsx` | Create. What the tab needs, the template, where it comes from. |
| `ctyhp-accounting/app/(app)/settings/import/ImportClient.tsx` | Modify. Loses the table, gains the panel and the mismatch warning. |
| `ctyhp-accounting/tests/unit/import-shape.test.ts` | Create. Templates, detection, the mismatch sentence. |
| `ctyhp-accounting/tests/unit/import-guidance-ui-contract.test.ts` | Create. Component split, wiring, 400-line ceiling. |

---

### Task 1: Knowing what a file is

**Files:**
- Create: `ctyhp-accounting/lib/domain/import-shape.ts`
- Test: `ctyhp-accounting/tests/unit/import-shape.test.ts`

**Interfaces:**
- Consumes: `fieldsFor`, `proposeMapping`, `TARGET_LABEL`, `type ImportTarget`, `type FieldSpec` from `@/lib/domain/import-mapping`.
- Produces: `templateCsvFor(target: ImportTarget): string`; `detectFileShape(headers: readonly string[]): FileShapeDetection`; `describeShapeMismatch(selected: ImportTarget, detection: FileShapeDetection): string | null`; `interface FileShapeDetection { target: ImportTarget | null; matchedRequired: number; requiredTotal: number; looksLikeLedgerDetail: boolean; looksLikeWaveAccountTransactions: boolean }`.

- [ ] **Step 1: Write the failing tests**

Create `ctyhp-accounting/tests/unit/import-shape.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fieldsFor, type ImportTarget } from "@/lib/domain/import-mapping";
import {
  describeShapeMismatch,
  detectFileShape,
  templateCsvFor,
} from "@/lib/domain/import-shape";

const TARGETS: ImportTarget[] = [
  "chart_of_accounts",
  "customers",
  "vendors",
  "items",
  "invoices",
];

/** The headers of the file attached to feedback report 428ca4db. */
const WAVE_ACCOUNT_TRANSACTIONS = [
  "ACCOUNT NUMBER",
  "DATE",
  "DESCRIPTION",
  "DEBIT (In Business Currency)",
  "CREDIT (In Business Currency)",
  "BALANCE (In Business Currency)",
];

const QUICKBOOKS_CHART = ["Account Number", "Account Name", "Type", "Description", "Balance"];

describe("templateCsvFor", () => {
  it("writes the header row from the mapper's own labels, for every target", () => {
    for (const target of TARGETS) {
      const [header, example, ...rest] = templateCsvFor(target).trim().split("\n");
      const labels = fieldsFor(target).map((field) => field.label);
      expect(header.split(",").length, target).toBe(labels.length);
      expect(example.split(",").length, target).toBe(labels.length);
      expect(rest, target).toEqual([]);
      // Derived, not a second list: every label appears in the header row.
      for (const label of labels) expect(header, `${target}/${label}`).toContain(label);
    }
  });

  it("answers the report's question with a chart of accounts example", () => {
    const csv = templateCsvFor("chart_of_accounts");
    expect(csv).toContain("Account code");
    expect(csv).toContain("121");
  });
});

describe("detectFileShape", () => {
  it("recognises the file from the report as Wave's account transactions", () => {
    const detection = detectFileShape(WAVE_ACCOUNT_TRANSACTIONS);

    expect(detection.looksLikeLedgerDetail).toBe(true);
    expect(detection.looksLikeWaveAccountTransactions).toBe(true);
    // It must not claim this is a chart of accounts; that belief is the bug.
    expect(detection.target).not.toBe("chart_of_accounts");
    expect(detection.matchedRequired).toBeLessThan(detection.requiredTotal);
  });

  it("keeps ledger detail and the Wave report as two separate signals", () => {
    const noBalance = detectFileShape(["Account", "Date", "Description", "Debit", "Credit"]);

    expect(noBalance.looksLikeLedgerDetail).toBe(true);
    expect(noBalance.looksLikeWaveAccountTransactions).toBe(false);
  });

  it("recognises a genuine chart of accounts export", () => {
    const detection = detectFileShape(QUICKBOOKS_CHART);

    expect(detection.target).toBe("chart_of_accounts");
    expect(detection.matchedRequired).toBe(detection.requiredTotal);
    expect(detection.looksLikeLedgerDetail).toBe(false);
  });

  it("guesses nothing rather than wrongly, for an unrecognisable file", () => {
    const detection = detectFileShape(["foo", "bar", "baz"]);

    expect(detection.target).toBeNull();
    expect(detection.looksLikeLedgerDetail).toBe(false);
    expect(detection.looksLikeWaveAccountTransactions).toBe(false);
  });

  it("says nothing about an empty file", () => {
    const detection = detectFileShape([]);

    expect(detection.target).toBeNull();
    expect(detection.looksLikeWaveAccountTransactions).toBe(false);
  });
});

describe("describeShapeMismatch", () => {
  it("stays quiet when the file and the tab agree", () => {
    expect(describeShapeMismatch("chart_of_accounts", detectFileShape(QUICKBOOKS_CHART))).toBeNull();
  });

  it("names the Wave report and says it has no tab yet", () => {
    const message = describeShapeMismatch(
      "chart_of_accounts",
      detectFileShape(WAVE_ACCOUNT_TRANSACTIONS),
    );

    expect(message).toBeTruthy();
    expect(message).toMatch(/one row per transaction/i);
    expect(message).toMatch(/chart of accounts/i);
  });

  it("points at the tab a recognised file belongs in", () => {
    const message = describeShapeMismatch("customers", detectFileShape(QUICKBOOKS_CHART));

    expect(message).toMatch(/chart of accounts/i);
  });
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `npm test -- tests/unit/import-shape.test.ts`

Expected: FAIL — `Cannot find package '@/lib/domain/import-shape'`.

- [ ] **Step 3: Write the module**

Create `ctyhp-accounting/lib/domain/import-shape.ts`:

```ts
import {
  fieldsFor,
  proposeMapping,
  TARGET_LABEL,
  type FieldSpec,
  type ImportTarget,
} from "./import-mapping";

/**
 * What kind of file is this, and does it belong in the tab that is open?
 *
 * Feedback 428ca4db was a person putting a general ledger detail export into the
 * Chart of accounts tab. They were five fields deep before anything told them
 * the file was the wrong kind — and it never did say so. Everything here exists
 * to answer that before the mapping table appears.
 *
 * Pure, and derived from `fieldsFor` so that guidance and behaviour cannot
 * disagree: the labels shown are the labels the mapper matches.
 */

const TARGETS: readonly ImportTarget[] = [
  "chart_of_accounts",
  "customers",
  "vendors",
  "items",
  "invoices",
];

/** Compare headers the way a person would, as the mapper does. */
function normalise(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function hasColumn(headers: readonly string[], words: readonly string[]): boolean {
  return headers.some((header) => {
    const h = normalise(header);
    return words.some((word) => h === word || h.startsWith(`${word} `) || h.includes(` ${word}`));
  });
}

/** One believable value per kind, so a template can be opened and filled in. */
const EXAMPLE_BY_KIND: Record<FieldSpec["kind"], string> = {
  text: "Example",
  money: "0.00",
  boolean: "No",
  account_type: "Bank",
  number: "1",
  date: "2026-01-31",
};

/**
 * Values for the fields where a generic example would teach nothing. The chart
 * of accounts row is the PC49 account from the report, so the answer to "how do
 * I add this ledger" is a file the person can open.
 */
const EXAMPLE_BY_KEY: Record<string, string> = {
  account_code: "121",
  name: "PC49 BoA CK 3388",
  account_type: "Bank",
  description: "Operating checking account",
  opening_balance_minor: "968798.29",
  email: "billing@example.com",
  contact_name: "Alex Tran",
  phone: "408-555-0134",
  city: "San Jose",
  region: "CA",
  postal_code: "95112",
  country: "United States",
  item_code: "RING-001",
  sales_price_minor: "1250.00",
  purchase_cost_minor: "800.00",
  is_inventory: "Yes",
  invoice_number: "INV-1001",
  customer: "Aurora Fine Jewelry",
  issue_date: "2026-01-15",
  due_date: "2026-02-14",
  quantity: "1",
  unit_price_minor: "1250.00",
  income_account: "4000",
  tax_code: "CA-SJ",
  memo: "Thank you for your business",
};

/** A CSV with exactly the columns this tab reads, and one row showing the shape. */
export function templateCsvFor(target: ImportTarget): string {
  const fields = fieldsFor(target);
  const cell = (value: string) => (value.includes(",") ? `"${value}"` : value);
  const header = fields.map((field) => cell(field.label)).join(",");
  const example = fields
    .map((field) => cell(EXAMPLE_BY_KEY[field.key] ?? EXAMPLE_BY_KIND[field.kind]))
    .join(",");
  return `${header}\n${example}\n`;
}

export interface FileShapeDetection {
  /** Best matching import target, or null when nothing matches well. */
  target: ImportTarget | null;
  /** How many of that target's required fields the headers cover. */
  matchedRequired: number;
  requiredTotal: number;
  /** A date beside a debit or credit: one row per transaction, not per record. */
  looksLikeLedgerDetail: boolean;
  /**
   * Wave's "Account Transactions" report: ledger detail plus an account column
   * and a running balance. That file is grouped into per-account sections, so no
   * column mapping can read it at all — it earns its own sentence.
   */
  looksLikeWaveAccountTransactions: boolean;
}

/** How many of a target's required fields these headers cover. */
function requiredCoverage(headers: readonly string[], target: ImportTarget) {
  const required = fieldsFor(target).filter((field) => field.required);
  const proposal = proposeMapping(headers, target);
  const matched = required.filter((field) => proposal.columns[field.key] !== null).length;
  return { matched, total: required.length };
}

export function detectFileShape(headers: readonly string[]): FileShapeDetection {
  const empty: FileShapeDetection = {
    target: null,
    matchedRequired: 0,
    requiredTotal: 0,
    looksLikeLedgerDetail: false,
    looksLikeWaveAccountTransactions: false,
  };
  if (headers.length === 0) return empty;

  let best: { target: ImportTarget; matched: number; total: number } | null = null;
  for (const target of TARGETS) {
    const { matched, total } = requiredCoverage(headers, target);
    if (!best || matched > best.matched) best = { target, matched, total };
  }

  const hasDate = hasColumn(headers, ["date", "transaction date", "posting date"]);
  const hasDebitOrCredit = hasColumn(headers, ["debit", "credit"]);
  const hasAccount = hasColumn(headers, ["account", "account number", "account name"]);
  const hasRunningBalance = hasColumn(headers, ["balance"]);
  const looksLikeLedgerDetail = hasDate && hasDebitOrCredit;

  return {
    // Claimed only when every required field is covered. A partial match is the
    // state that produced the report; naming a target there would repeat it.
    target: best && best.matched === best.total && best.total > 0 ? best.target : null,
    matchedRequired: best?.matched ?? 0,
    requiredTotal: best?.total ?? 0,
    looksLikeLedgerDetail,
    looksLikeWaveAccountTransactions: looksLikeLedgerDetail && hasAccount && hasRunningBalance,
  };
}

/** The sentence to show above the mapping table, or null when all is well. */
export function describeShapeMismatch(
  selected: ImportTarget,
  detection: FileShapeDetection,
): string | null {
  if (detection.target === selected) return null;

  if (detection.looksLikeWaveAccountTransactions) {
    return (
      "This file is a general ledger detail report: one row per transaction, grouped into " +
      "sections per account, with a running balance. " +
      `${TARGET_LABEL.chart_of_accounts} reads one row per account and imports a balance, ` +
      "so it cannot read this file. Export a chart of accounts to load the accounts, and use " +
      "the template below."
    );
  }

  if (detection.target) {
    return `This file looks like ${TARGET_LABEL[detection.target]}, not ${TARGET_LABEL[selected]}.`;
  }

  if (detection.looksLikeLedgerDetail) {
    return (
      "This file has a date and debit or credit columns, so it holds transactions rather " +
      `than one row per ${TARGET_LABEL[selected].toLowerCase()} record. Check the tab before mapping.`
    );
  }

  return null;
}
```

- [ ] **Step 4: Run the tests and verify GREEN**

Run: `npm test -- tests/unit/import-shape.test.ts tests/unit/import-mapping.test.ts`

Expected: PASS, both files.

- [ ] **Step 5: Commit**

```bash
git add ctyhp-accounting/lib/domain/import-shape.ts ctyhp-accounting/tests/unit/import-shape.test.ts
git commit -m "Work out what an import file actually is before anyone maps it"
```

---

### Task 2: Make room, changing nothing

**Files:**
- Create: `ctyhp-accounting/app/(app)/settings/import/ImportColumnsTable.tsx`
- Modify: `ctyhp-accounting/app/(app)/settings/import/ImportClient.tsx`

**Interfaces:**
- Produces: `ImportColumnsTable` with props `{ fields, headers, mapping, unmapped, onChange }` — the exact set the moved markup already reads.
- No behaviour changes. The guidance panel lands in Task 3; this task only makes the file small enough to accept it.

- [ ] **Step 1: Record the starting line count**

Run: `wc -l 'app/(app)/settings/import/ImportClient.tsx'`

Expected: `413`. Step 5 compares against it.

- [ ] **Step 2: Create the component with the moved markup**

Create `ctyhp-accounting/app/(app)/settings/import/ImportColumnsTable.tsx` as a
`"use client"` component holding, unchanged, the "Columns" heading, its
explanatory paragraph, the `<Table>` of fields with its Field / Column selects,
and the "N column(s) in the file are not used" note. Props:

```tsx
"use client";
import { Select, Space, Table, Typography } from "antd";
import type { FieldSpec } from "@/lib/domain/import-mapping";

export interface ImportColumnsTableProps {
  fields: readonly FieldSpec[];
  headers: string[];
  /** Field key → column index in the file, or null when nothing is chosen. */
  mapping: Record<string, number | null>;
  unmapped: string[];
  onChange: (fieldKey: string, columnIndex: number | null) => void;
}
```

Keep every string, width and `Select` option exactly as it was. This step must
not improve anything.

- [ ] **Step 3: Use it from `ImportClient`**

Delete the moved markup and render:

```tsx
          <ImportColumnsTable
            fields={fields}
            headers={headers}
            mapping={mapping}
            unmapped={unmapped}
            onChange={(fieldKey, columnIndex) =>
              setMapping((current) => ({ ...current, [fieldKey]: columnIndex }))
            }
          />
```

Use the existing state setter and handler names; if the current handler differs,
adapt at the call site rather than renaming it. Drop any imports `ImportClient`
no longer uses — lint will name them.

- [ ] **Step 4: Prove nothing changed**

Run:

```bash
npm run typecheck
npx eslint 'app/(app)/settings/import/*.tsx'
npm test
```

Expected: typecheck clean, eslint silent, every test passing.

- [ ] **Step 5: Check the file shrank below the ceiling**

Run: `wc -l 'app/(app)/settings/import/ImportClient.tsx' 'app/(app)/settings/import/ImportColumnsTable.tsx'`

Expected: `ImportClient.tsx` under 400, `ImportColumnsTable.tsx` under 400.

- [ ] **Step 6: Commit the move on its own**

```bash
git add 'ctyhp-accounting/app/(app)/settings/import/ImportColumnsTable.tsx' 'ctyhp-accounting/app/(app)/settings/import/ImportClient.tsx'
git commit -m "Move the import column table into its own component"
```

---

### Task 3: Saying it on the screen

**Files:**
- Create: `ctyhp-accounting/app/(app)/settings/import/ImportGuidance.tsx`
- Modify: `ctyhp-accounting/app/(app)/settings/import/ImportClient.tsx`
- Test: `ctyhp-accounting/tests/unit/import-guidance-ui-contract.test.ts`

**Interfaces:**
- Consumes: `templateCsvFor`, `detectFileShape`, `describeShapeMismatch`, `fieldsFor`, `TARGET_LABEL`.
- Produces: `ImportGuidance` with props `{ target, detection, onSwitchTarget }`.

- [ ] **Step 1: Write the failing UI contract test**

Create `ctyhp-accounting/tests/unit/import-guidance-ui-contract.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const route = ["app", "(app)", "settings", "import"];
const read = (file: string) => readFileSync(join(process.cwd(), ...route, file), "utf8");

describe("the import guidance panel", () => {
  it("keeps guidance and the column table in their own components", () => {
    const client = read("ImportClient.tsx");
    expect(client).toContain("<ImportGuidance");
    expect(client).toContain("<ImportColumnsTable");
    expect(client).toContain("detectFileShape");
    expect(client).toContain("describeShapeMismatch");
  });

  it("offers the template and answers the batch question", () => {
    const guidance = read("ImportGuidance.tsx");
    expect(guidance).toContain("templateCsvFor");
    expect(guidance).toContain("Download template");
    // The report asked whether ledgers must be imported one at a time.
    expect(guidance).toMatch(/one file/i);
    expect(guidance).toMatch(/every account/i);
    // Where the file comes from in the other product.
    expect(guidance).toMatch(/QuickBooks/);
    expect(guidance).toMatch(/Wave/);
  });

  it("lets a recognised file switch to the tab it belongs in", () => {
    expect(read("ImportGuidance.tsx")).toContain("onSwitchTarget");
  });

  it("keeps every import component under the 400-line ceiling", () => {
    for (const file of ["ImportClient.tsx", "ImportGuidance.tsx", "ImportColumnsTable.tsx"]) {
      expect(read(file).split(/\r?\n/).length, file).toBeLessThanOrEqual(400);
    }
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- tests/unit/import-guidance-ui-contract.test.ts`

Expected: FAIL with `ENOENT` for `ImportGuidance.tsx`.

- [ ] **Step 3: Write the panel**

Create `ctyhp-accounting/app/(app)/settings/import/ImportGuidance.tsx`:

```tsx
"use client";
import { Alert, Button, Card, Space, Tag, Typography } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import { fieldsFor, TARGET_LABEL, type ImportTarget } from "@/lib/domain/import-mapping";
import {
  describeShapeMismatch,
  templateCsvFor,
  type FileShapeDetection,
} from "@/lib/domain/import-shape";

/** Where each kind of file comes from in the product being left behind. */
const SOURCE_HINT: Record<ImportTarget, string> = {
  chart_of_accounts:
    "QuickBooks: Reports → Account List. Wave: Accounting → Chart of Accounts → Export.",
  customers: "QuickBooks: Reports → Customer Contact List. Wave: Sales → Customers → Export.",
  vendors: "QuickBooks: Reports → Vendor Contact List. Wave: Purchases → Vendors → Export.",
  items: "QuickBooks: Reports → Product/Service List. Wave: Sales → Products & Services → Export.",
  invoices: "QuickBooks: Reports → Invoice List with line detail. Wave: Sales → Invoices → Export.",
};

export interface ImportGuidanceProps {
  target: ImportTarget;
  /** Null until a file has been read. */
  detection: FileShapeDetection | null;
  onSwitchTarget: (target: ImportTarget) => void;
}

/**
 * What this tab needs, before anyone maps a column.
 *
 * Feedback 428ca4db asked for instructions and for batch import. The second was
 * a misunderstanding worth correcting here rather than building: one file already
 * carries every account, one row each. The first was fair — the screen showed a
 * mapping table and never said what the file was supposed to look like.
 */
export default function ImportGuidance({ target, detection, onSwitchTarget }: ImportGuidanceProps) {
  const fields = fieldsFor(target);
  const required = fields.filter((field) => field.required);
  const optional = fields.filter((field) => !field.required);
  const mismatch = detection ? describeShapeMismatch(target, detection) : null;

  function downloadTemplate() {
    const blob = new Blob([templateCsvFor(target)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `one-book-${target.replaceAll("_", "-")}-template.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Space direction="vertical" size="small" style={{ width: "100%" }}>
      <Card size="small" title={`What a ${TARGET_LABEL[target]} file needs`}>
        <Space direction="vertical" size={4} style={{ width: "100%" }}>
          <Space wrap size={4}>
            {required.map((field) => (
              <Tag color="blue" key={field.key}>
                {field.label}
              </Tag>
            ))}
            {optional.map((field) => (
              <Tag key={field.key}>{field.label}</Tag>
            ))}
          </Space>
          <Typography.Text type="secondary">
            Blue columns are required. One file, every account — each row is one record, so a
            second file is only needed for a second kind of data.
          </Typography.Text>
          <Typography.Text type="secondary">{SOURCE_HINT[target]}</Typography.Text>
          <Button size="small" icon={<DownloadOutlined />} onClick={downloadTemplate}>
            Download template
          </Button>
        </Space>
      </Card>

      {mismatch ? (
        <Alert
          type="warning"
          showIcon
          message="This file may not belong in this tab"
          description={mismatch}
          action={
            detection?.target ? (
              <Button size="small" onClick={() => onSwitchTarget(detection.target as ImportTarget)}>
                Switch to {TARGET_LABEL[detection.target]}
              </Button>
            ) : null
          }
        />
      ) : null}
    </Space>
  );
}
```

- [ ] **Step 4: Wire it into `ImportClient`**

In `ImportClient.tsx`:

- import the panel and the detector:

```tsx
import ImportGuidance from "./ImportGuidance";
import { detectFileShape, describeShapeMismatch } from "@/lib/domain/import-shape";
```

- derive the detection from the headers already in state, so no new state is
  introduced:

```tsx
  const detection = headers.length > 0 ? detectFileShape(headers) : null;
```

- render the panel directly under the `Segmented` tab row and above the columns
  table, passing a switch handler that changes the tab and re-proposes the
  mapping against the same file rather than clearing it:

```tsx
      <ImportGuidance
        target={target}
        detection={detection}
        onSwitchTarget={(next) => {
          setTarget(next);
          if (headers.length > 0) {
            const proposed = proposeMapping(headers, next);
            setMapping(proposed.columns);
            setUnmapped(proposed.unmapped);
            setPreview(null);
          }
        }}
      />
```

`describeShapeMismatch` is imported so the contract test can see the screen owns
the decision to show a warning; the panel calls it. Leave the three steps, the
dry run and every existing string untouched.

- [ ] **Step 5: Run the tests, typecheck and lint**

Run:

```bash
npm test -- tests/unit/import-guidance-ui-contract.test.ts tests/unit/rsc-antd.test.ts
npm run typecheck
npx eslint 'app/(app)/settings/import/*.tsx'
```

Expected: all pass with zero errors.

- [ ] **Step 6: Commit**

```bash
git add 'ctyhp-accounting/app/(app)/settings/import' ctyhp-accounting/tests/unit/import-guidance-ui-contract.test.ts
git commit -m "Say what the import tab needs, and when the file is something else"
```

---

### Task 4: Prove it on the real file, then ship

**Files:**
- Modify only if a gate exposes a defect in files already in this plan.

- [ ] **Step 1: Check the detector against the real file**

Run, from `ctyhp-accounting`:

```bash
node --experimental-strip-types -e "
import {readFileSync} from 'node:fs';
import {detectFileShape, describeShapeMismatch} from './lib/domain/import-shape.ts';
const line = readFileSync('../Pacific Four Nine (2.0) Account Transactions 2026-08-04-18_20 (1).csv','utf8').split(/\r?\n/)[0];
const headers = line.replace(/^﻿/, '').split(',');
const d = detectFileShape(headers);
console.log(d);
console.log(describeShapeMismatch('chart_of_accounts', d));
" --input-type=module
```

Expected: `looksLikeWaveAccountTransactions: true`, `target: null`, and a sentence
that names the file as a general ledger detail report. If the detector says
anything else, fix `import-shape.ts` and re-run Task 1's tests.

- [ ] **Step 2: Run every project gate**

Run, recording real output:

```bash
npm test
npm run typecheck
npm run lint
npm run security:check-source
npm run build
```

Expected: all tests pass, typecheck and the credential check clean, lint zero
errors with only the pre-existing `scripts/verify-*.mjs` warnings, build exits 0.

- [ ] **Step 3: Smoke the built server**

Start the built server, then run:

```bash
node --env-file=.env.local scripts/smoke-pages.mjs http://127.0.0.1:3000
```

Expected: every page 200, `/settings/import` among them. Stop the server
afterwards; port 3000 must be free for the next run.

- [ ] **Step 4: Review the diff and commit**

Run:

```bash
git diff --check
git status --short
git log --oneline -5
```

Confirm only planned files changed and the user-owned `.claude/settings.json` is
untouched.

- [ ] **Step 5: Report what is still missing**

State plainly in the completion report that the file from the report still has no
home: this slice explains it, slice 2 gives it one. The feedback report
`428ca4db-a090-417a-8ed6-a40ef4f7d81e` stays `reviewing` until slice 2 lands —
do not resolve it from a script.
