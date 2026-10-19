/**
 * Approval Policies as a form: what is on screen for each policy, and which
 * policies differ from what is saved.
 *
 * The page used to save one row at a time, with a floppy-disk icon at the end
 * of each. It now has one Save changes button under the table, which saves
 * every row that changed, so it has to know which rows those are.
 *
 * Pure: policies and drafts in, the changed ones out.
 */

export interface ApprovalPolicyDraft {
  enabled: boolean;
  /** In major units, as the reader types it. */
  thresholdMajor: number;
  requireSegregation: boolean;
}

export interface SavedApprovalPolicy {
  action_key: string;
  enabled: boolean;
  threshold_minor: number;
  require_segregation: boolean;
}

export function approvalPolicyDraft(policy: SavedApprovalPolicy, decimals: number): ApprovalPolicyDraft {
  return {
    enabled: policy.enabled,
    thresholdMajor: policy.threshold_minor / 10 ** decimals,
    requireSegregation: policy.require_segregation,
  };
}

/** A typed amount in minor units, which is how it is saved and compared. */
export function thresholdMinor(draft: ApprovalPolicyDraft, decimals: number): number {
  return Math.round((draft.thresholdMajor ?? 0) * 10 ** decimals);
}

/**
 * The policies whose draft differs from what is saved. A threshold is compared
 * in minor units, so 100 and 100.00 are the same, and a threshold on an action
 * that has no amount is not compared at all.
 */
export function changedApprovalPolicies<P extends SavedApprovalPolicy>(
  policies: readonly P[],
  drafts: Readonly<Record<string, ApprovalPolicyDraft | undefined>>,
  decimals: number,
  usesThreshold: (actionKey: string) => boolean,
): P[] {
  return policies.filter((policy) => {
    const draft = drafts[policy.action_key];
    if (!draft) return false;
    if (draft.enabled !== policy.enabled) return true;
    if (draft.requireSegregation !== policy.require_segregation) return true;
    return usesThreshold(policy.action_key) && thresholdMinor(draft, decimals) !== policy.threshold_minor;
  });
}
