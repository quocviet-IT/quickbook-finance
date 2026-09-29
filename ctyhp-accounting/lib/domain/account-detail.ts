/**
 * What an account's detail type says, for the types that have a closed list.
 *
 * A bank account says what kind of bank account it is (migration 0072). A
 * current asset may say it is money on its way to a bank — Undeposited Funds,
 * Transfer Clearing — which is why the chart shows it with the bank accounts
 * while its type stays current_asset, so Banking and reconciliation never
 * treat it as a bank. Any other type's detail type stays free text.
 */
import type { AccountType } from "./accounts";
import { BANK_DETAIL_TYPES, bankDetailLabel } from "./bank-account-detail";

export const CURRENT_ASSET_DETAIL_TYPES = ["undeposited_funds", "transfer_clearing"] as const;
export type CurrentAssetDetailType = (typeof CURRENT_ASSET_DETAIL_TYPES)[number];

const CURRENT_ASSET_LABELS: Record<CurrentAssetDetailType, string> = {
  undeposited_funds: "Undeposited funds",
  transfer_clearing: "Transfer clearing",
};

const isCurrentAssetDetail = (detail: string | null | undefined): detail is CurrentAssetDetailType =>
  (CURRENT_ASSET_DETAIL_TYPES as readonly string[]).includes(detail ?? "");

/** A current asset that belongs with the bank accounts in the chart. */
export function isBankSectionDetail(detail: string | null | undefined): boolean {
  return isCurrentAssetDetail(detail);
}

/** The choices the account form offers for a type; empty when the type has no closed list. */
export function detailTypeOptions(type: AccountType): { value: string; label: string }[] {
  if (type === "bank") return BANK_DETAIL_TYPES.map((d) => ({ value: d, label: bankDetailLabel(d) }));
  if (type === "current_asset") return CURRENT_ASSET_DETAIL_TYPES.map((d) => ({ value: d, label: CURRENT_ASSET_LABELS[d] }));
  return [];
}

/** How an account's detail type reads under its name. */
export function detailLabel(type: AccountType, detail: string | null): string | null {
  if (type === "bank") return bankDetailLabel(detail);
  if (isCurrentAssetDetail(detail)) return CURRENT_ASSET_LABELS[detail];
  return detail;
}
