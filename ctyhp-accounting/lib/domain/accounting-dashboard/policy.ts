import {
  ruleNeeds as surfaceRuleNeeds,
  sleepingRules as surfaceSleepingRules,
  type RuleRequirements,
  type WorkPolicy,
} from "@/lib/domain/work-policy";

/**
 * Which accounting rules cannot decide anything without a policy behind them.
 *
 * The policy itself moved to `lib/domain/work-policy.ts` in Phase 6 — it is a
 * company settings object several areas read, not something accounting owns.
 * **The mapping below is the accounting-specific half**: it names this area's
 * rule keys, which would be meaningless to Banking.
 */
export {
  EMPTY_WORK_POLICY,
  POLICY_FIELD_LABEL,
  isConfigured,
  type WorkPolicy,
} from "@/lib/domain/work-policy";

const RULE_REQUIREMENT: RuleRequirements = {
  "approval-beyond-sla.v1": "approvalSlaDays",
  "bank-unmatched-beyond-age.v1": "unmatchedBankAgeDays",
};

/** The policy a rule is waiting on, or null when it needs none. */
export function ruleNeeds(ruleKey: string): keyof WorkPolicy | null {
  return surfaceRuleNeeds(RULE_REQUIREMENT, ruleKey);
}

/**
 * Every accounting rule that cannot fire yet, so the panel can say which ones
 * are asleep. A rule that silently never fires is worse than no rule: the screen
 * looks complete and is not, and nobody knows to go and set the number.
 */
export function sleepingRules(policy: WorkPolicy): string[] {
  return surfaceSleepingRules(policy, RULE_REQUIREMENT);
}
