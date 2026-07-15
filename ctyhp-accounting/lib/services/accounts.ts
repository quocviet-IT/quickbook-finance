import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountRow, AccountStatus } from "@/lib/db/types";
import {
  accountCreateSchema,
  accountUpdateSchema,
  type AccountCreateInput,
  type AccountUpdateInput,
} from "@/lib/domain/schemas";
import { writeAudit } from "./audit";

const TABLE = "acc_account";
const COLUMNS =
  "id,account_code,name,account_type,detail_type,parent_account_id,description," +
  "default_tax_code_id,currency_code,is_posting_account,status,effective_from," +
  "effective_to,created_by,approved_by,created_at,updated_at";

export class AccountServiceError extends Error {}

function mapWriteError(message: string): never {
  if (message.includes("acc_account_account_code_key") || message.includes("duplicate key")) {
    throw new AccountServiceError("An account with this code already exists");
  }
  if (message.toLowerCase().includes("cycle")) {
    throw new AccountServiceError("This parent would create a circular account hierarchy");
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
  const { data, error } = await sb.from(TABLE).insert(parsed).select(COLUMNS).single();
  if (error) mapWriteError(error.message);
  const row = data as unknown as AccountRow;
  await writeAudit(sb, { table_name: TABLE, record_id: row.id, action: "insert", after: row });
  return row;
}

export async function updateAccount(
  sb: SupabaseClient,
  id: string,
  input: AccountUpdateInput,
): Promise<AccountRow> {
  const parsed = accountUpdateSchema.parse(input);
  const before = await getAccount(sb, id);
  if (!before) throw new AccountServiceError("Account not found");
  const { data, error } = await sb
    .from(TABLE)
    .update({ ...parsed, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select(COLUMNS)
    .single();
  if (error) mapWriteError(error.message);
  const row = data as unknown as AccountRow;
  await writeAudit(sb, { table_name: TABLE, record_id: id, action: "update", before, after: row });
  return row;
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
  const { data, error } = await sb
    .from(TABLE)
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select(COLUMNS)
    .single();
  if (error) throw new AccountServiceError(error.message);
  const row = data as unknown as AccountRow;
  await writeAudit(sb, {
    table_name: TABLE,
    record_id: id,
    action: "update",
    before: { status: before.status },
    after: { status: row.status },
  });
  return row;
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
