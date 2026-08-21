import type { AccountingControl, QueueSeverity } from "./types";
import { isConfigured, type WorkPolicy } from "./policy";

/**
 * What changed, why it matters, and where it is concentrated.
 *
 * Every rule here is code somebody can read, argue with, and test. That is the
 * design document's central instruction for this phase: no model decides what
 * the books mean, and nothing on this screen is a claim a reader cannot check
 * against the evidence printed beside it.
 *
 * Three properties hold across the whole file:
 *
 * **Deterministic.** No rule reads a clock. Everything it needs — including
 * today's date and the moment the facts were gathered — arrives in `facts`, so
 * the same input gives the same output forever, which is what makes the tests
 * mean anything.
 *
 * **Versioned.** A `ruleKey` ends in `.v1`. When a rule's judgement changes,
 * the key changes with it, so an acknowledgement recorded against the old
 * reasoning does not silently carry over to new reasoning.
 *
 * **Never causal.** An insight may say three customers *represent* 72% of the
 * overdue balance. It may not say they *caused* anything: the data proves
 * concentration, and concentration is not cause.
 *
 * Design record: docs/superpowers/specs/2026-08-19-accounting-dashboard-redesign-design.md §7.4
 */

export interface InsightEvidence {
  label: string;
  value: string | number;
  href?: string;
}

export interface AccountingInsight {
  id: string;
  ruleKey: string;
  severity: QueueSeverity;
  title: string;
  summary: string;
  amountMinor?: number;
  changePercent?: number;
  ageDays?: number;
  evidence: InsightEvidence[];
  recommendedAction: { label: string; href: string };
  generatedAsOf: string;
}

export interface OverdueParty {
  entityId: string;
  entityName: string;
  balanceMinor: number;
}

export interface InsightFacts {
  asOf: string;
  /** When the facts were gathered. Passed in so no rule reads a clock. */
  generatedAsOf: string;
  policy: WorkPolicy;
  controls: readonly AccountingControl[];
  overduePeriods: readonly { id: string; label: string; periodEnd: string }[];
  approvals: { pendingCount: number; oldestAgeDays: number | null };
  unmatchedBank: { count: number; oldestAgeDays: number | null };
  failedRecurringRuns: readonly { id: string; templateName: string; runDate: string }[];
  overdueAr: { nowMinor: number; priorMinor: number; rows: readonly OverdueParty[] };
  overdueAp: { nowMinor: number; priorMinor: number; rows: readonly OverdueParty[] };
  /** What the prior figures are the prior figures *of*. */
  comparisonLabel: string;
}

const SEVERITY_RANK: Record<QueueSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function money(minor: number): string {
  return (Math.abs(minor) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(later: string, earlier: string): number {
  return Math.round(
    (Date.parse(`${later}T00:00:00.000Z`) - Date.parse(`${earlier}T00:00:00.000Z`)) / DAY_MS,
  );
}

/**
 * The share the largest few hold, stated as concentration and nothing more.
 *
 * Returns null when there is nothing to concentrate, so a caller cannot end up
 * printing "0 customers represent NaN%" — the shape of sentence that destroys
 * a reader's trust in every other number on the page.
 */
export function concentration(
  rows: readonly OverdueParty[],
  totalMinor: number,
  top = 3,
): { names: string[]; sharePercent: number; amountMinor: number } | null {
  if (rows.length === 0 || totalMinor <= 0) return null;
  const sorted = [...rows]
    .filter((row) => row.balanceMinor > 0)
    // By amount, then by name: two parties owing the same must not swap places
    // between two renderings of the same facts.
    .sort((a, b) => b.balanceMinor - a.balanceMinor || a.entityName.localeCompare(b.entityName));
  if (sorted.length === 0) return null;
  const head = sorted.slice(0, top);
  const amountMinor = head.reduce((sum, row) => sum + row.balanceMinor, 0);
  return {
    names: head.map((row) => row.entityName),
    sharePercent: Math.round((amountMinor / totalMinor) * 100),
    amountMinor,
  };
}

export function buildInsights(facts: InsightFacts): AccountingInsight[] {
  const insights: AccountingInsight[] = [];
  const at = facts.generatedAsOf;

  // --- The ledger does not balance --------------------------------------
  const tb = facts.controls.find((c) => c.key === "trial-balance");
  if (tb && tb.status === "blocked") {
    insights.push({
      id: "trial-balance-out",
      ruleKey: "trial-balance-out.v1",
      severity: "critical",
      title: "The trial balance is out",
      summary:
        `Posted debits and credits differ by ${money(tb.differenceMinor ?? 0)}. ` +
        "No period can be closed and no statement can be relied on until they agree.",
      amountMinor: Math.abs(tb.differenceMinor ?? 0),
      evidence: [
        { label: "Difference", value: money(tb.differenceMinor ?? 0) },
        { label: "Checked", value: tb.evaluatedAt.slice(0, 16).replace("T", " ") },
      ],
      recommendedAction: { label: "Open the trial balance", href: "/reports?report=trial" },
      generatedAsOf: at,
    });
  }

  // --- A subledger has stopped agreeing with its control account ---------
  const outSubledgers = facts.controls.filter(
    (c) => c.status === "attention" && c.key.endsWith("-to-gl"),
  );
  for (const control of outSubledgers) {
    insights.push({
      id: `subledger-out:${control.key}`,
      ruleKey: "subledger-out.v1",
      severity: "high",
      title: `${control.title} no longer agrees`,
      summary:
        `${control.detail} A control account and the documents behind it are ` +
        "the same money counted twice; while they differ, one of the two is wrong.",
      amountMinor: control.differenceMinor,
      evidence: [
        { label: "Out by", value: money(control.differenceMinor ?? 0) },
        { label: "Checked", value: control.evaluatedAt.slice(0, 16).replace("T", " ") },
      ],
      recommendedAction: { label: "Open the posting report", href: control.href },
      generatedAsOf: at,
    });
  }

  // --- A period is still open past the last day it covers ----------------
  if (facts.overduePeriods.length > 0) {
    const oldest = [...facts.overduePeriods].sort((a, b) =>
      a.periodEnd.localeCompare(b.periodEnd),
    )[0];
    const ageDays = Math.max(0, daysBetween(facts.asOf, oldest.periodEnd));
    insights.push({
      id: "period-open-past-end",
      ruleKey: "period-open-past-end.v1",
      severity: "high",
      title: "Periods are still open",
      summary:
        `${plural(facts.overduePeriods.length, "period")} remain open after the last day ` +
        `each covers. The oldest is ${oldest.label}, open ${plural(ageDays, "day")} past it.`,
      ageDays,
      evidence: [
        { label: "Oldest", value: oldest.label, href: "/settings/periods" },
        { label: "Still open", value: facts.overduePeriods.length },
      ],
      recommendedAction: { label: "Review the periods", href: "/settings/periods" },
      generatedAsOf: at,
    });
  }

  // --- An approval has waited longer than the company allows -------------
  // Asleep until somebody sets the SLA: with no policy there is no such thing
  // as late, and firing anyway would be inventing the company's deadline.
  if (
    isConfigured(facts.policy, "approvalSlaDays") &&
    facts.approvals.pendingCount > 0 &&
    facts.approvals.oldestAgeDays !== null &&
    facts.approvals.oldestAgeDays > (facts.policy.approvalSlaDays ?? 0)
  ) {
    insights.push({
      id: "approval-beyond-sla",
      ruleKey: "approval-beyond-sla.v1",
      severity: "high",
      title: "An approval has waited too long",
      summary:
        `${plural(facts.approvals.pendingCount, "controlled action")} are waiting, and the ` +
        `oldest has waited ${plural(facts.approvals.oldestAgeDays, "day")} against a policy of ` +
        `${plural(facts.policy.approvalSlaDays ?? 0, "day")}.`,
      ageDays: facts.approvals.oldestAgeDays,
      evidence: [
        { label: "Waiting", value: facts.approvals.pendingCount, href: "/approvals" },
        { label: "Oldest", value: `${facts.approvals.oldestAgeDays} days` },
        { label: "Policy", value: `${facts.policy.approvalSlaDays} days` },
      ],
      recommendedAction: { label: "Open approvals", href: "/approvals" },
      generatedAsOf: at,
    });
  }

  // --- A bank line has stayed unmatched longer than the company allows ----
  if (
    isConfigured(facts.policy, "unmatchedBankAgeDays") &&
    facts.unmatchedBank.count > 0 &&
    facts.unmatchedBank.oldestAgeDays !== null &&
    facts.unmatchedBank.oldestAgeDays > (facts.policy.unmatchedBankAgeDays ?? 0)
  ) {
    insights.push({
      id: "bank-unmatched-beyond-age",
      ruleKey: "bank-unmatched-beyond-age.v1",
      severity: "high",
      title: "Bank activity has gone unmatched",
      summary:
        `${plural(facts.unmatchedBank.count, "bank line")} are unmatched, the oldest for ` +
        `${plural(facts.unmatchedBank.oldestAgeDays, "day")} against a policy of ` +
        `${plural(facts.policy.unmatchedBankAgeDays ?? 0, "day")}.`,
      ageDays: facts.unmatchedBank.oldestAgeDays,
      evidence: [
        { label: "Unmatched", value: facts.unmatchedBank.count, href: "/banking" },
        { label: "Oldest", value: `${facts.unmatchedBank.oldestAgeDays} days` },
        { label: "Policy", value: `${facts.policy.unmatchedBankAgeDays} days` },
      ],
      recommendedAction: { label: "Match the bank lines", href: "/banking" },
      generatedAsOf: at,
    });
  }

  // --- Overdue receivables and payables grew -----------------------------
  insights.push(
    ...overdueGrowth(facts, "ar", "Overdue receivables grew", "/reports/ar-aging"),
    ...overdueGrowth(facts, "ap", "Overdue payables grew", "/reports/ap-aging"),
  );

  // --- A scheduled run posted nothing ------------------------------------
  if (facts.failedRecurringRuns.length > 0) {
    const names = facts.failedRecurringRuns.map((run) => run.templateName);
    insights.push({
      id: "recurring-run-failed",
      ruleKey: "recurring-run-failed.v1",
      severity: "high",
      title: "A scheduled run posted nothing",
      summary:
        `${plural(facts.failedRecurringRuns.length, "scheduled run")} failed: ` +
        `${names.slice(0, 3).join(", ")}. Whatever they were to post is not in the books.`,
      evidence: [
        { label: "Failed", value: facts.failedRecurringRuns.length, href: "/recurring" },
        { label: "Most recent", value: facts.failedRecurringRuns[0].runDate },
      ],
      recommendedAction: { label: "Open recurring transactions", href: "/recurring" },
      generatedAsOf: at,
    });
  }

  // Worst first, and stable within a severity so two renderings of the same
  // facts never disagree about the order.
  return insights.sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.id.localeCompare(b.id),
  );
}

/**
 * The one rule that compares two moments rather than reading one.
 *
 * Materiality decides whether a rise is worth saying out loud. Where nobody
 * has set one, every rise is reported: "unconfigured" must not quietly become
 * "ignore anything small", because that is a threshold too — just an invisible
 * one nobody chose.
 */
function overdueGrowth(
  facts: InsightFacts,
  side: "ar" | "ap",
  title: string,
  href: string,
): AccountingInsight[] {
  const source = side === "ar" ? facts.overdueAr : facts.overdueAp;
  const increase = source.nowMinor - source.priorMinor;
  if (increase <= 0) return [];
  if (isConfigured(facts.policy, "materialityMinor") && increase < (facts.policy.materialityMinor ?? 0)) {
    return [];
  }

  const who = concentration(source.rows, source.nowMinor);
  const party = side === "ar" ? "customers" : "vendors";
  const concentrationSentence = who
    ? ` ${plural(who.names.length, party.slice(0, -1))} — ${who.names.join(", ")} — represent ` +
      `${who.sharePercent}% of what is outstanding.`
    : "";

  return [
    {
      id: `overdue-${side}-increased`,
      ruleKey: `overdue-${side}-increased.v1`,
      severity: "medium",
      title,
      summary:
        `Overdue ${side === "ar" ? "receivables" : "payables"} are ${money(source.nowMinor)}, ` +
        `up ${money(increase)} on ${facts.comparisonLabel}.${concentrationSentence}`,
      amountMinor: increase,
      changePercent:
        source.priorMinor === 0 ? undefined : Math.round((increase / source.priorMinor) * 100),
      evidence: [
        { label: "Now", value: money(source.nowMinor), href },
        { label: facts.comparisonLabel, value: money(source.priorMinor) },
        ...(who
          ? [{ label: `Largest ${who.names.length}`, value: who.names.join(", ") }]
          : []),
      ],
      recommendedAction: { label: "Open the ageing report", href },
      generatedAsOf: facts.generatedAsOf,
    },
  ];
}
