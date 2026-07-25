import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { submitForApproval } from "@/lib/services/access";

export type ControlledActionOutcome<T> =
  | { status: "executed"; result: T }
  | { status: "submitted"; requestId: string };

interface ControlledActionOptions<T> {
  sb: SupabaseClient;
  actionKey: string;
  title: string;
  amountMinor: number;
  payload: Record<string, unknown>;
  reason: string;
  execute: () => Promise<T>;
}

/** Matches the authoritative guard messages returned by the controlled RPCs. */
export function isApprovalRequiredError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /requires approval;\s*submit it for approval instead/i.test(error.message)
  );
}

async function policyRequiresApproval(
  sb: SupabaseClient,
  actionKey: string,
  amountMinor: number,
): Promise<boolean> {
  const { data, error } = await sb.rpc("acc_approval_required", {
    p_action_key: actionKey,
    p_amount_minor: amountMinor,
  });
  if (error) throw new Error(error.message);
  return Boolean(data);
}

async function submit<T>(
  options: ControlledActionOptions<T>,
): Promise<ControlledActionOutcome<T>> {
  const requestId = await submitForApproval(options.sb, {
    action_key: options.actionKey,
    title: options.title,
    amount_minor: options.amountMinor,
    payload: options.payload,
    reason: options.reason,
  });
  return { status: "submitted", requestId };
}

/**
 * Execute a controlled action when its policy does not apply; otherwise enqueue
 * the exact call for a second user. The RPC still enforces the same policy, and
 * the catch handles the small race where a policy changes after the pre-check.
 */
export async function executeOrSubmitForApproval<T>(
  options: ControlledActionOptions<T>,
): Promise<ControlledActionOutcome<T>> {
  if (await policyRequiresApproval(options.sb, options.actionKey, options.amountMinor)) {
    return submit(options);
  }

  try {
    return { status: "executed", result: await options.execute() };
  } catch (error) {
    if (isApprovalRequiredError(error)) return submit(options);
    throw error;
  }
}

export interface ControlledActionResponse {
  id: string;
  submittedForApproval: boolean;
}

export function toControlledActionResponse<T>(
  outcome: ControlledActionOutcome<T>,
  executedId: (result: T) => string,
): ControlledActionResponse {
  return outcome.status === "submitted"
    ? { id: outcome.requestId, submittedForApproval: true }
    : { id: executedId(outcome.result), submittedForApproval: false };
}
