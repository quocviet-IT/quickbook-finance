import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountRow, AccountStatus } from "@/lib/db/types";
import { violatedConstraint } from "@/lib/db/postgrest-errors";
import { CLEARING_TYPE_MESSAGE } from "@/lib/domain/clearing-account-type";
import {
  accountCreateSchema,
  accountUpdateSchema,
  type AccountCreateInput,
  type AccountUpdateInput,
} from "@/lib/domain/schemas";

const TABLE = "acc_account";
const COLUMNS =
  "id,account_code,name,account_type,cash_flow_role,detail_type,is_contra,is_clearing,parent_account_id,description," +
  "default_tax_code_id,currency_code,is_posting_account,status,effective_from," +
  "effective_to,created_by,approved_by,created_at,updated_at";

export class AccountServiceError extends Error {}

// The constraint is read by name: the message itself is the screen's sentence
// by the time it gets here (lib/db/postgrest-errors.ts).
function mapWriteError(error: { code?: string; message: string; details?: string | null }): never {
  const { message } = error;
  const constraint = violatedConstraint(error);
  if (constraint === "acc_account_account_code_key") {
    throw new AccountServiceError("An account with this code already exists");
  }
  if (message.toLowerCase().includes("cycle")) {
    throw new AccountServiceError("This parent would create a circular account hierarchy");
  }
  if (constraint === "acc_account_clearing_type_ck") {
    throw new AccountServiceError(CLEARING_TYPE_MESSAGE);
  }
  if (message.includes("same type as its parent")) {
    throw new AccountServiceError("A sub-account must have the same type as its parent");
  }
  throw new AccountServiceError(message);
}

export async function listAccounts(sb: SupabaseClient): Promise<AccountRow[]> {
  const { data, error } = await sb.from(TABLE).select(COLUMNS).order("account_code");
  if (error) throw new AccountServiceError(error.message);
  return (data ?? []) as unknown as AccountRow[];
}

export async function getAccount(sb: SupabaseClient, id: string): Promise<AccountRow | null> {
  const { data, error } = await sb.from(TABLE).select(COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new AccountServiceError(error.message);
  return (data as unknown as AccountRow) ?? null;
}

export async function createAccount(
  sb: SupabaseClient,
  input: AccountCreateInput,
): Promise<AccountRow> {
  const parsed = accountCreateSchema.parse(input);
  // Saved through acc_save_account (2.60): it checks the role and writes only
  // the columns this form has.
  const { data, error } = await sb.rpc("acc_save_account", { p_id: null, p_values: parsed });
  if (error) mapWriteError(error);
  return data as unknown as AccountRow;
}

export async function updateAccount(
  sb: SupabaseClient,
  id: string,
  input: AccountUpdateInput,
): Promise<AccountRow> {
  const parsed = accountUpdateSchema.parse(input);
  const before = await getAccount(sb, id);
  if (!before) throw new AccountServiceError("Account not found");
  const { data, error } = await sb.rpc("acc_save_account", { p_id: id, p_values: parsed });
  if (error) mapWriteError(error);
  return data as unknown as AccountRow;
}

/**
 * Change account status. Accounts are never hard-deleted (manual §13): to
 * retire an account, set it inactive/archived so historical postings survive.
 */
export async function setAccountStatus(
  sb: SupabaseClient,
  id: string,
  status: AccountStatus,
): Promise<AccountRow> {
  const before = await getAccount(sb, id);
  if (!before) throw new AccountServiceError("Account not found");
  const { data, error } = await sb.rpc("acc_save_account", { p_id: id, p_values: { status } });
  if (error) throw new AccountServiceError(error.message);
  return data as unknown as AccountRow;
}

/** True if the account has any journal lines (blocks hard delete in the UI). */
export async function accountHasPostings(sb: SupabaseClient, id: string): Promise<boolean> {
  const { count, error } = await sb
    .from("acc_journal_line")
    .select("id", { count: "exact", head: true })
    .eq("account_id", id);
  if (error) throw new AccountServiceError(error.message);
  return (count ?? 0) > 0;
}
