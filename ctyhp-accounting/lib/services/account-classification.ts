import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountType } from "@/lib/domain/accounts";
import { defaultCashFlowRole } from "@/lib/domain/cashflow";
import { detailTypeFromName } from "@/lib/domain/bank-account-detail";

/**
 * Give imported accounts the classification every other account already gets.
 *
 * An account created by hand goes through `accountCreateSchema`, which fills
 * `cash_flow_role` from its type. An imported one does not: `acc_import_accounts`
 * writes seven columns and the role falls to its column default. So a chart
 * brought across from Wave arrived with 54 of 95 accounts "unclassified" — and
 * an unclassified account holds the Cash Flow Statement in review, which is how
 * a reporting gap turns up months later as a report nobody can sign off.
 *
 * Fifty of those fifty-four were expenses, income, equity and cost of sales:
 * types the application already has a settled answer for. This applies that
 * same answer. It does not invent one — `current_asset` and `current_liability`
 * stay unclassified on purpose, because whether a loan is operating or
 * financing is a policy an accountant sets, not a default.
 *
 * Never overwrites. Only an account still carrying `unclassified`, or a bank
 * account with no detail type, is touched: a classification somebody chose is
 * an answer, and re-answering it is not a repair.
 */

export class AccountClassificationError extends Error {}

export interface AccountToClassify {
  id: string;
  account_code: string;
  name: string;
  account_type: AccountType;
  cash_flow_role: string;
  detail_type: string | null;
}

export interface ClassificationOutcome {
  /** Accounts given a cash-flow role from their type. */
  rolesSet: number;
  /** Bank accounts given a detail type from their name. */
  detailsSet: number;
  /**
   * What is still unclassified afterwards, and needs a person.
   *
   * Named rather than counted: "4 accounts need a policy" sends somebody
   * hunting through a chart of ninety-five.
   */
  stillUnclassified: { account_code: string; name: string; account_type: string }[];
}

/** What a repair would change, without changing it. */
export async function planAccountClassification(
  sb: SupabaseClient,
): Promise<{ roles: AccountToClassify[]; details: AccountToClassify[]; unanswerable: AccountToClassify[] }> {
  const { data, error } = await sb
    .from("acc_account")
    .select("id,account_code,name,account_type,cash_flow_role,detail_type")
    .neq("status", "archived")
    .order("account_code");
  if (error) throw new AccountClassificationError(error.message);

  const accounts = (data ?? []) as unknown as AccountToClassify[];
  const roles: AccountToClassify[] = [];
  const unanswerable: AccountToClassify[] = [];
  const details: AccountToClassify[] = [];

  for (const account of accounts) {
    if (account.cash_flow_role === "unclassified") {
      const proposed = defaultCashFlowRole(account.account_type);
      if (proposed === "unclassified") unanswerable.push(account);
      else roles.push(account);
    }
    if (account.account_type === "bank" && !account.detail_type) {
      if (detailTypeFromName(account.name)) details.push(account);
    }
  }
  return { roles, details, unanswerable };
}

/**
 * Apply it.
 *
 * Grouped by the value being written, so ninety-five accounts cost one request
 * per distinct answer rather than one per account.
 */
export async function classifyAccounts(sb: SupabaseClient): Promise<ClassificationOutcome> {
  const { roles, details, unanswerable } = await planAccountClassification(sb);

  const byRole = new Map<string, string[]>();
  for (const account of roles) {
    const role = defaultCashFlowRole(account.account_type);
    byRole.set(role, [...(byRole.get(role) ?? []), account.id]);
  }
  for (const [role, ids] of byRole) {
    const { error } = await sb
      .from("acc_account")
      .update({ cash_flow_role: role })
      .in("id", ids)
      .eq("cash_flow_role", "unclassified");
    if (error) throw new AccountClassificationError(error.message);
  }

  const byDetail = new Map<string, string[]>();
  for (const account of details) {
    const detail = detailTypeFromName(account.name);
    if (!detail) continue;
    byDetail.set(detail, [...(byDetail.get(detail) ?? []), account.id]);
  }
  for (const [detail, ids] of byDetail) {
    const { error } = await sb
      .from("acc_account")
      .update({ detail_type: detail })
      .in("id", ids)
      .is("detail_type", null);
    if (error) throw new AccountClassificationError(error.message);
  }

  return {
    rolesSet: roles.length,
    detailsSet: details.length,
    stillUnclassified: unanswerable.map((account) => ({
      account_code: account.account_code,
      name: account.name,
      account_type: account.account_type,
    })),
  };
}
