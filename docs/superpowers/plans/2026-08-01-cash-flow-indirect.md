# Indirect Cash Flow Statement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an indirect Statement of Cash Flows with explicit account classification, journal drill-down, a zero-cent Balance Sheet reconciliation, and a month-close control.

**Architecture:** The posted ledger remains the single source of truth. A new migration adds durable cash-flow roles and one detailed SQL classification function; a summary function groups those details and supplies scoped opening/closing cash. TypeScript assembles the display model without reclassifying ledger data, while account and report clients expose policy and evidence.

**Tech Stack:** PostgreSQL/Supabase RPC and RLS, TypeScript, Next.js 16 App Router, React 19, Ant Design 6, Zod 4, Vitest 4.

## Global Constraints

- Store and calculate money only as integer base-currency minor units.
- `acc_journal_entry` and `acc_journal_line` are the source of truth.
- The signed equation is `Beginning cash + CFO + CFI + CFF = Ending cash`.
- Ambiguous classifications produce an explicit unclassified row and a failed reconciliation; they are never silently assigned to Operating.
- Preserve the existing direct-method RPC for backward compatibility.
- Do not claim ASC 230 certification; accounting review remains a release responsibility.
- Every production behavior begins with a failing test and an observed RED result.
- Commit at each independently passing task boundary.

---

## File structure

- Modify `ctyhp-accounting/lib/domain/cashflow.ts`: role defaults and indirect statement assembly.
- Modify `ctyhp-accounting/tests/unit/cashflow.test.ts`: concrete accounting fixtures.
- Create `ctyhp-accounting/supabase/migrations/0081_cash_flow_indirect.sql`: role policy, detail/summary RPCs, close gate, snapshot.
- Create `ctyhp-accounting/tests/e2e/cash-flow-indirect.e2e.ts`: transactional database behavior tests.
- Modify `ctyhp-accounting/lib/db/types.ts`, `lib/domain/schemas.ts`, `lib/services/accounts.ts`: account-role round trip.
- Modify `ctyhp-accounting/app/(app)/accounts/AccountsClient.tsx`: account-role editor and status.
- Modify `ctyhp-accounting/lib/services/cashflow.ts`: indirect RPC mapping.
- Modify `ctyhp-accounting/app/(app)/reports/cash-flow/{page.tsx,actions.ts,CashFlowClient.tsx}`: report and drill-down.
- Modify `ctyhp-accounting/lib/services/dashboard.ts` only where required to consume the new totals.
- Update `ctyhp-accounting/scripts/verify-cashflow.mjs`: regression verification for the new report.

---

### Task 1: Pure domain contract

**Files:**
- Modify: `ctyhp-accounting/tests/unit/cashflow.test.ts`
- Modify: `ctyhp-accounting/lib/domain/cashflow.ts`

**Interfaces:**
- Produces `CASH_FLOW_ROLES`, `CashFlowRole`, `defaultCashFlowRole(accountType)`.
- Produces `CashFlowContribution`, `IndirectCashFlowReport`, and `assembleIndirectCashFlow(contributions, openingMinor, balanceSheetCashMinor)`.
- Keeps `CashFlowCategory`, `cashFlowCategoryOf`, and `assembleCashFlow` for compatibility.

- [ ] **Step 1: Write failing role-default tests**

```ts
expect(defaultCashFlowRole("bank")).toBe("cash");
expect(defaultCashFlowRole("accounts_receivable")).toBe("operating_receivable");
expect(defaultCashFlowRole("accounts_payable")).toBe("operating_payable");
expect(defaultCashFlowRole("fixed_asset")).toBe("investing");
expect(defaultCashFlowRole("equity")).toBe("financing");
expect(defaultCashFlowRole("current_liability")).toBe("unclassified");
```

- [ ] **Step 2: Run `npm test -- tests/unit/cashflow.test.ts` and observe missing-export failures.**

- [ ] **Step 3: Add the role constants/default function, then rerun until GREEN.**

- [ ] **Step 4: Write a failing indirect-assembly test with literal values.**

```ts
const report = assembleIndirectCashFlow([
  { section: "operating", lineCode: "net_income", label: "Net income", amountMinor: 500_00, detailCount: 2 },
  { section: "operating", lineCode: "depreciation", label: "Depreciation", amountMinor: 50_00, detailCount: 1 },
  { section: "operating", lineCode: "change_accounts_receivable", label: "Change in accounts receivable", amountMinor: -100_00, detailCount: 1 },
  { section: "investing", lineCode: "capital_purchases", label: "Capital purchases", amountMinor: -200_00, detailCount: 1 },
  { section: "financing", lineCode: "loan_proceeds", label: "Loan proceeds", amountMinor: 300_00, detailCount: 1 },
], 1_000_00, 1_550_00);
expect(report.operating).toBe(450_00);
expect(report.investing).toBe(-200_00);
expect(report.financing).toBe(300_00);
expect(report.endingCashStatementMinor).toBe(1_550_00);
expect(report.differenceMinor).toBe(0);
expect(report.tiesOut).toBe(true);
```

- [ ] **Step 5: Observe RED, implement the minimal assembler, and rerun GREEN.**

- [ ] **Step 6: Add a failing test proving any unclassified contribution makes `classificationComplete=false` and `tiesOut=false`, implement, and rerun all unit tests.**

- [ ] **Step 7: Commit with `feat: define indirect cash flow domain model`.**

---

### Task 2: Ledger classification and close control

**Files:**
- Create: `ctyhp-accounting/tests/e2e/cash-flow-indirect.e2e.ts`
- Create: `ctyhp-accounting/supabase/migrations/0081_cash_flow_indirect.sql`

**Interfaces:**
- Adds `acc_account.cash_flow_role text not null` with a constrained value set.
- Adds `acc_cash_flow_indirect_detail(date,date)` returning `section`, `line_code`, `label`, journal identity, signed `amount_minor`, and classification evidence.
- Adds `acc_cash_flow_indirect(date,date)` returning ordered grouped rows plus opening and closing scoped cash.
- Adds `acc_cash_flow_close_snapshot` and extends the existing three-argument period-close gate.

- [ ] **Step 1: Write a transactional E2E test that reads and applies migration 0081 inside `BEGIN`, inserts isolated 2099 ledger fixtures, and always executes `ROLLBACK`.**

The completely classified fixture must assert these literal outputs:

```text
net_income                         40000
depreciation                      10000
asset_disposal_gain_loss         -10000
change_accounts_receivable            0
change_inventory                 -20000
change_accounts_payable               0
net operating activities          20000
capital_purchases                -10000
asset_sale_proceeds               50000
net investing activities          40000
loan_proceeds                     40000
owner_distributions               -5000
net financing activities          35000
net cash change                    95000
reconciliation difference             0
unclassified count                    0
```

The fixture consists of a credit sale and collection, depreciation, inventory purchase/payment, cash capital purchase, fixed-asset disposal with gain, loan proceeds, owner distribution, and a bank transfer.

- [ ] **Step 2: Run the isolated E2E test with the existing `.env.local`; observe failure because migration 0081 does not exist.**

- [ ] **Step 3: Add the role column/check, conservative backfill, deterministic new-account default trigger, RLS-safe snapshot table, and indexes.**

- [ ] **Step 4: Add the detail RPC. Implement indirect operating rows from P&L and balance-sheet movements, full cash proceeds for `asset_disposal`, signed investing/financing cash rows from explicit account roles, exclusion of cash transfers, and explicit unclassified rows.**

- [ ] **Step 5: Add the summary RPC as a grouping wrapper around the detail RPC; do not repeat classification CASE expressions in the summary.**

- [ ] **Step 6: Extend `acc_period_close_blockers(uuid)` to append cash-flow difference/unclassified blockers and extend `acc_close_period(uuid,text,text)` to upsert one immutable-period snapshot. Preserve the written variance override.**

- [ ] **Step 7: Rerun the classified fixture GREEN. Add a second RED fixture for an unclassified current liability, implement the expected unclassified amount/count and blocker text, then rerun GREEN.**

- [ ] **Step 8: Run the existing ledger-integrity E2E suite and commit with `feat: add ledger-derived indirect cash flow`.**

---

### Task 3: Account classification round trip

**Files:**
- Modify: `ctyhp-accounting/lib/db/types.ts`
- Modify: `ctyhp-accounting/lib/domain/schemas.ts`
- Modify: `ctyhp-accounting/lib/services/accounts.ts`
- Modify: `ctyhp-accounting/app/(app)/accounts/AccountsClient.tsx`
- Test: `ctyhp-accounting/tests/unit/schemas.test.ts`

**Interfaces:**
- `AccountRow.cash_flow_role: CashFlowRole`.
- Account create/update schemas accept `cash_flow_role`; omitted create values use `defaultCashFlowRole(account_type)`.

- [ ] **Step 1: Add failing schema tests accepting every supported role and rejecting an unknown role. Run and observe RED.**

- [ ] **Step 2: Extend schemas/types/service column selection and write payloads; rerun GREEN.**

- [ ] **Step 3: Add a Cash Flow Role table column and account-form selector. Ambiguous roles display an orange `Unclassified` tag.**

- [ ] **Step 4: Run focused account/schema tests, typecheck, and lint; fix only failures introduced by this task.**

- [ ] **Step 5: Commit with `feat: expose account cash flow classification`.**

---

### Task 4: Indirect report service and UI

**Files:**
- Modify: `ctyhp-accounting/lib/services/cashflow.ts`
- Modify: `ctyhp-accounting/app/(app)/reports/cash-flow/actions.ts`
- Modify: `ctyhp-accounting/app/(app)/reports/cash-flow/page.tsx`
- Modify: `ctyhp-accounting/app/(app)/reports/cash-flow/CashFlowClient.tsx`
- Modify: `ctyhp-accounting/lib/services/dashboard.ts` if its adapter requires the new shape.
- Test: `ctyhp-accounting/tests/unit/cashflow-service.test.ts`

**Interfaces:**
- `getCashFlow(sb, from, to)` calls `acc_cash_flow_indirect` and returns `IndirectCashFlowReport`.
- `getCashFlowDetails(sb, from, to, lineCode)` calls the detail RPC and returns journal evidence.
- `cashFlowDetailAction` validates date range and a known line code before calling the service.

- [ ] **Step 1: Write a failing service-mapping test using a complete Supabase RPC response and literal expected report totals. Observe RED.**

- [ ] **Step 2: Implement summary/detail mapping with explicit error checks; rerun GREEN.**

- [ ] **Step 3: Change report copy to `Indirect method`. Render ordered component rows, section totals, the opening/CFO/CFI/CFF/ending equation, Balance Sheet cash, and difference.**

- [ ] **Step 4: Add expandable evidence rows showing journal number/date/description/source and signed amount. Add a success alert only when difference is zero and classification is complete; otherwise show a warning.**

- [ ] **Step 5: Keep the dashboard bridge consuming the flattened `operating`, `investing`, and `financing` totals and link it to the detailed report.**

- [ ] **Step 6: Run focused unit tests, typecheck, lint, and `npm run build`.**

- [ ] **Step 7: Commit with `feat: present indirect cash flow reconciliation`.**

---

### Task 5: Regression verification and completion

**Files:**
- Modify: `ctyhp-accounting/scripts/verify-cashflow.mjs`
- Modify: `ctyhp-accounting/CLAUDE.md` only if a recurring cash-flow classification mistake is discovered during implementation.

- [ ] **Step 1: Change the verifier's expected contract from three direct totals to the indirect component rows, zero-cent reconciliation, full disposal proceeds, and zero unclassified entries. Observe failure against the old RPC contract.**

- [ ] **Step 2: Make the verifier transactional/self-cleaning and run it against migration 0081 in a rollback transaction; observe GREEN without deploying the migration.**

- [ ] **Step 3: Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build` with zero errors.**

- [ ] **Step 4: Start the built server and run the full `scripts/smoke-pages.mjs` sweep. Stop the server after the sweep.**

- [ ] **Step 5: Run the read-only GL posting/control reconciliation E2E suite.**

- [ ] **Step 6: Inspect `git diff --check`, the final diff, and branch status. Commit with `test: verify indirect cash flow reconciliation`.**

## Self-review

- Spec coverage: account policy, indirect components, classification completeness, drill-down, dashboard compatibility, close blocker/snapshot, and required verification each map to a task.
- Placeholder scan: the plan contains no deferred implementation placeholders; scope limits are explicit in the design spec.
- Type consistency: summary and detail services consume the two named RPCs; UI consumes only the `IndirectCashFlowReport` produced by the domain assembler.
