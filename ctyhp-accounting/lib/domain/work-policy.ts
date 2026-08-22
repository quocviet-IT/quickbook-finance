/**
 * What a company has decided about its own work, and what it has not.
 *
 * A queue ordered by a threshold nobody chose is a queue ordered by the
 * developer's guess, and a screen that says "late" on a deadline the company
 * never set is making one up. This is where a company says — and until it does,
 * every field here is null and the rules that need one stay asleep, visibly,
 * with their names on the screen, rather than quietly never firing.
 *
 * **Deliberately not a work-surface primitive**, and the boundary test is what
 * settled that. Two of these four fields are named for one area's work — the
 * age of an unmatched bank line, the window before a period ends — and the
 * shared surface is not allowed to know either thing exists. This is a company
 * settings object instead: one stored row, read by whichever areas care, and
 * free to keep field names that say what they actually mean rather than
 * general-sounding ones that say less.
 *
 * Which rules depend on which field stays with the rules, which is why the
 * mapping is passed into `sleepingRules` rather than listed here.
 *
 * Design record: docs/superpowers/specs/2026-08-19-accounting-dashboard-redesign-design.md §7.2
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
  /**
   * How many days before a period ends that closing it becomes worth starting.
   * Null until a company decides; an overdue period needs no policy at all.
   */
  closeWindowDays: number | null;
}

export const EMPTY_WORK_POLICY: WorkPolicy = {
  materialityMinor: null,
  approvalSlaDays: null,
  unmatchedBankAgeDays: null,
  closeWindowDays: null,
};

export const POLICY_FIELD_LABEL: Record<keyof WorkPolicy, string> = {
  materialityMinor: "Materiality threshold",
  approvalSlaDays: "Days an approval may wait",
  unmatchedBankAgeDays: "Days a bank line may stay unmatched",
  closeWindowDays: "Days before a period ends to start closing it",
};

/**
 * Whether a company has actually chosen this number.
 *
 * Zero counts as chosen: "an approval waiting at all is late" is a real policy,
 * and the strictest one a company can hold. Only null means nobody has said. A
 * negative is not a policy at all, and is treated as unset rather than honoured
 * — a rule firing on "less than minus one days" would be nonsense wearing a
 * number.
 */
export function isConfigured(policy: WorkPolicy, field: keyof WorkPolicy): boolean {
  const value = policy[field];
  return value !== null && Number.isFinite(value) && value >= 0;
}

/** Which policy field a rule cannot decide anything without. */
export type RuleRequirements = Readonly<Record<string, keyof WorkPolicy>>;

/** The policy a rule is waiting on, or null when it needs none. */
export function ruleNeeds(
  requirements: RuleRequirements,
  ruleKey: string,
): keyof WorkPolicy | null {
  return requirements[ruleKey] ?? null;
}

/**
 * Every rule that cannot fire yet, so a panel can say which ones are asleep.
 *
 * A rule that silently never fires is worse than no rule: the screen looks
 * complete and is not, and nobody knows to go and set the number.
 */
export function sleepingRules(policy: WorkPolicy, requirements: RuleRequirements): string[] {
  return Object.entries(requirements)
    .filter(([, field]) => !isConfigured(policy, field))
    .map(([ruleKey]) => ruleKey)
    .sort();
}
