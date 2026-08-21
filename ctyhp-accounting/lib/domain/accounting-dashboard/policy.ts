/**
 * What a company has decided about its own work, and what it has not.
 *
 * Phase 1 recorded materiality and SLA as gaps and refused to invent them:
 * a queue ordered by a threshold nobody chose is a queue ordering by the
 * developer's guess. This is where a company finally says, and until it does
 * every field here is null and the rules that need one stay asleep — visibly,
 * with their names on the screen, rather than quietly never firing.
 *
 * Design record: docs/superpowers/specs/2026-08-19-accounting-dashboard-redesign-design.md
 * Phase 3, §7.2.
 */

export interface WorkPolicy {
  /**
   * The amount below which a difference is not worth a person's attention.
   * Minor units. Null until a company sets one.
   */
  materialityMinor: number | null;
  /** Days a controlled action may wait before it is late. */
  approvalSlaDays: number | null;
  /** Days a bank line may stay unmatched before it is late. */
  unmatchedBankAgeDays: number | null;
}

export const EMPTY_WORK_POLICY: WorkPolicy = {
  materialityMinor: null,
  approvalSlaDays: null,
  unmatchedBankAgeDays: null,
};

export const POLICY_FIELD_LABEL: Record<keyof WorkPolicy, string> = {
  materialityMinor: "Materiality threshold",
  approvalSlaDays: "Days an approval may wait",
  unmatchedBankAgeDays: "Days a bank line may stay unmatched",
};

/**
 * Whether a company has actually chosen this number.
 *
 * Zero counts as chosen: "an approval waiting at all is late" is a real
 * policy, and the strictest one a company can hold. Only null means nobody has
 * said. A negative is not a policy at all, and is treated as unset rather than
 * honoured — a rule firing on "less than minus one days" would be nonsense
 * wearing a number.
 */
export function isConfigured(policy: WorkPolicy, field: keyof WorkPolicy): boolean {
  const value = policy[field];
  return value !== null && Number.isFinite(value) && value >= 0;
}

/** Rules that cannot decide anything without a policy behind them. */
const RULE_REQUIREMENT: Record<string, keyof WorkPolicy> = {
  "approval-beyond-sla.v1": "approvalSlaDays",
  "bank-unmatched-beyond-age.v1": "unmatchedBankAgeDays",
};

/** The policy a rule is waiting on, or null when it needs none. */
export function ruleNeeds(ruleKey: string): keyof WorkPolicy | null {
  return RULE_REQUIREMENT[ruleKey] ?? null;
}

/**
 * Every rule that cannot fire yet, so the panel can say which ones are asleep.
 *
 * A rule that silently never fires is worse than no rule: the screen looks
 * complete and is not, and nobody knows to go and set the number.
 */
export function sleepingRules(policy: WorkPolicy): string[] {
  return Object.entries(RULE_REQUIREMENT)
    .filter(([, field]) => !isConfigured(policy, field))
    .map(([ruleKey]) => ruleKey)
    .sort();
}
