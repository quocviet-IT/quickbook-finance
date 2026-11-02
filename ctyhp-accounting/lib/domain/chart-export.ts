/**
 * The chart of accounts as a CSV the Chart of accounts import reads (2.98).
 *
 * The prototype offers "copy my chart of accounts" so a second set of books can
 * start from the first; OneBook had a one-row template and nothing that wrote
 * out the chart already in use. The columns are the import's own, by the same
 * labels, so the file goes back in under Settings › Import without mapping.
 *
 * - Active accounts only: one retired here should not come back to life there.
 * - A subaccount is written "Parent: Child", the import's own way of reading
 *   one (`splitAccountName`), so the hierarchy survives the trip.
 * - The type is written as its label when the import reads that label back
 *   to the same type, and as the type's key otherwise, so no type changes.
 * - Opening balance is left empty: this copies the chart, not the money in it.
 */
import { toCsv } from "@/lib/csv";
import type { AccountRow } from "@/lib/db/types";
import { ACCOUNT_TYPE_LABEL, type AccountType } from "./accounts";
import { fieldsFor, translateAccountType } from "./import-mapping";

type ChartAccount = Pick<AccountRow, "id" | "account_code" | "name" | "account_type" | "description" | "parent_account_id" | "status">;

/** How the Type column names a type: its label, when the import reads the label back to the same type. */
export function exportedAccountType(type: AccountType): string {
  const label = ACCOUNT_TYPE_LABEL[type];
  return translateAccountType(label) === type ? label : type;
}

/** "Parent: Child", up the chain of parents; a loop or a missing parent ends the chain. */
function lineage(account: ChartAccount, byId: ReadonlyMap<string, ChartAccount>): string {
  const names = [account.name.trim()];
  const seen = new Set([account.id]);
  let parentId = account.parent_account_id;
  while (parentId && !seen.has(parentId)) {
    const parent = byId.get(parentId);
    if (!parent) break;
    names.unshift(parent.name.trim());
    seen.add(parent.id);
    parentId = parent.parent_account_id;
  }
  return names.join(": ");
}

export function chartOfAccountsCsv(accounts: readonly ChartAccount[]): string {
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const labels = new Map(fieldsFor("chart_of_accounts").map((field) => [field.key, field.label]));
  const rows = accounts
    .filter((account) => account.status === "active")
    .sort((a, b) => a.account_code.localeCompare(b.account_code, "en-US", { numeric: true }))
    .map((account) => ({
      account_code: account.account_code,
      name: lineage(account, byId),
      account_type: exportedAccountType(account.account_type),
      description: account.description?.trim() ?? "",
      opening_balance_minor: "",
    }));
  const columns = (["account_code", "name", "account_type", "description", "opening_balance_minor"] as const).map((key) => ({
    key,
    header: labels.get(key) ?? key,
  }));
  return toCsv(rows, columns);
}

/** The file's name, dated by the company's today. */
export function chartOfAccountsFileName(today: string): string {
  return `chart-of-accounts-${today}.csv`;
}
