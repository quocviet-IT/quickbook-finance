# Accounting Cockpit Phase 3 — Insights and Materiality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Say what changed, why it matters, and where the impact is concentrated — from rules that can be read, tested, and pointed at their evidence, never from a model's opinion.

**Architecture:** A pure rule engine takes facts already gathered for the queue and the controls and returns `AccountingInsight[]`. Every rule carries a versioned `ruleKey`, its evidence, and one action. Company policy — materiality and SLA — becomes real configuration for the first time, so the two ordering tiers Phase 1 recorded as gaps can finally be honoured; until a company sets them, the unconfigured state is shown rather than a number invented on its behalf.

**Tech Stack:** Next.js 16, React 19, antd 6, Supabase (Postgres RLS + RPC), Zod, Vitest.

## What the spec asks for, and what the data can prove today

| Rule the spec names | Provable now from |
|---|---|
| Trial balance out of balance | `controls` — `trial-balance` |
| Period open after its close date | `context.overduePeriods` |
| Controlled action waiting beyond its SLA | `acc_approval_request` age + **new** policy |
| Bank line unreconciled beyond the configured age | unmatched count + oldest date + **new** policy |
| Overdue AR or AP increased against the comparison period | `getArAging` / `getApAging` at two dates |
| A recurring run failed | `listRecurringRuns` |
| A subledger does not reconcile to the GL | `controls` — `ar-to-gl`, `ap-to-gl`, `inventory-to-gl` |

Top contributors come from `AgingReport.rows`, which already carry `entityId`, `entityName` and `balanceMinor`.

## Global Constraints

- **No generative AI anywhere near a control status or an accounting decision** (spec §3.2, Phase 3.6). Rules are code.
- **No insight claims a cause its evidence does not carry.** "Three customers represent 72% of the overdue balance" is allowed; "caused" is not.
- Identical input must produce identical output — no clock reads inside a rule, no ordering by anything unstable.
- Materiality and SLA start **unconfigured**, and the screen says so rather than defaulting to a number nobody chose.
- Policy changes are audited.
- Ship gate: `npm test`, typecheck, lint, build, smoke, `quality:bundle` within 680,783 gzip for `/accounting`, changelog Release.
- Every migration reaches every company, then `verify:company-provisioning`.

## Decisions taken (flag to the user if changing)

1. **One policy row per company, versioned by history.** `acc_work_policy` keeps every version; the current one is the latest. Same shape as company settings, so the audit answer is "which version was in force" rather than "what did it used to be".
2. **Every policy field is nullable, and null means unconfigured** — not zero, not a default. A rule that needs a policy it does not have does not fire, and the panel says which rules are asleep.
3. **The comparison period is the same one the reports use** — `previousPeriodRange`, so "overdue AR increased" means the same thing here as on a Profit & Loss.
4. **Insight acknowledgement reuses Phase 2's state table.** An insight's `ruleKey` is its work key (`insight:<ruleKey>`), so acknowledging one is the same act, in the same audit trail, as acknowledging a queue item. No second lifecycle.
5. **The SLA and materiality tiers switch on in `orderQueue` only when configured**, which is what Phase 1's comparator was written to allow.

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/0119_work_policy.sql` | `acc_work_policy` (versioned), `acc_save_work_policy`, `acc_current_work_policy` |
| `lib/domain/accounting-dashboard/policy.ts` | The policy type, what "unconfigured" means, which rules it unlocks |
| `lib/domain/accounting-dashboard/insight-rules.ts` | The rule engine: pure, versioned, evidence-carrying |
| `lib/domain/accounting-dashboard/contributors.ts` | Top-contributor concentration, with the wording rule |
| `tests/unit/accounting-dashboard/{policy,insight-rules,contributors}.test.ts` | TDD homes |
| `lib/services/accounting-dashboard/insights.ts` | Gathers the facts, runs the rules |
| `lib/services/accounting-dashboard/policy.ts` | Read and write the policy |
| `components/accounting-dashboard/AccountingInsightList.tsx` | "What changed and why" |
| `app/(app)/settings/work-policy/*` | Where a company sets materiality and SLA |
| `scripts/verify-work-policy.mjs` | Proves the guards and the audit |

---

### Task 1: Policy — what a company has configured, and what it has not

- [ ] Domain `policy.ts` + tests: `WorkPolicy` (all fields nullable), `isConfigured(policy, field)`, `unlockedRules(policy)` returning which `ruleKey`s can fire.
- [ ] Migration 0119: versioned table, `acc_save_work_policy` (admin only, audited), `acc_current_work_policy`.
- [ ] Service `policy.ts`.
- [ ] Commit.

### Task 2: The rule engine

- [ ] `insight-rules.ts` + tests. Each rule: positive, negative, boundary, missing-data — the spec names all four.
- [ ] Rules, each with a versioned key (`trial-balance-out.v1`, `period-open-past-end.v1`, `approval-beyond-sla.v1`, `bank-unmatched-beyond-age.v1`, `overdue-ar-increased.v1`, `overdue-ap-increased.v1`, `recurring-run-failed.v1`, `subledger-out.v1`).
- [ ] Every insight carries evidence, `generatedAsOf`, and one action.
- [ ] Commit.

### Task 3: Contributors

- [ ] `contributors.ts` + tests: top N by balance, their share of the total, and the sentence that states concentration without claiming cause.
- [ ] Commit.

### Task 4: Service and screen

- [ ] `insights.ts` gathers facts (controls, periods, aging now and at the comparison date, approvals, recurring) and runs the engine; its own section envelope, failing alone.
- [ ] `AccountingInsightList.tsx` under the queue: severity, summary, evidence chips, action, freshness, and an Acknowledge that writes Phase 2's state.
- [ ] The panel names the rules that are asleep for want of a policy, with a link to set it.
- [ ] `orderQueue` honours SLA and materiality when configured.
- [ ] Commit.

### Task 5: Settings, proof, ship

- [ ] `/settings/work-policy` with its `SETTINGS_HUB` entry (admin only — it changes what the whole company sees).
- [ ] `verify-work-policy.mjs`: a non-admin is refused; a save is audited; the current version is the latest; unconfigured stays unconfigured rather than becoming zero.
- [ ] Full gates + `quality:bundle` + changelog + push + CI.

## Self-Review

1. **Spec coverage:** rule engine with versioned keys ✔ T2; audited policy with the unconfigured state exposed ✔ T1/T4/T5; top contributors ✔ T3; evidence, freshness, drill-down ✔ T2/T4; acknowledgement measurement ✔ T4 (reuses Phase 2's audited state); no AI ✔ by construction.
2. **Acceptance criteria:** determinism ✔ (rules take facts, never a clock); four test kinds per rule ✔ T2; no causal claim ✔ T3's wording rule; timestamp and action on every insight ✔ T2; policy audited and effective after change ✔ T1/T5.
3. **To check during execution:** whether `getArAging` can be asked for a past date cheaply enough to run on every load, or whether the comparison needs its own cached read.
