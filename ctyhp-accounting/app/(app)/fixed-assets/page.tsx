import PageHeader from "@/components/PageHeader";
import { createSupabaseServerClient } from "@/lib/db/server";
import { listAccounts } from "@/lib/services/accounts";
import { listFixedAssets } from "@/lib/services/fixed-assets";
import { listBills, listVendors } from "@/lib/services/payables";
import { listCurrencies } from "@/lib/services/reference";
import FixedAssetsClient from "./FixedAssetsClient";

export const dynamic = "force-dynamic";

export default async function FixedAssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ bill?: string | string[] }>;
}) {
  const params = await searchParams;
  const requestedBillId = Array.isArray(params.bill) ? params.bill[0] : params.bill;
  const sb = await createSupabaseServerClient();
  const [
    assets,
    accounts,
    vendors,
    bills,
    currencies,
    managePermission,
    postPermission,
    importPermission,
    disposePermission,
  ] = await Promise.all([
    listFixedAssets(sb),
    listAccounts(sb),
    listVendors(sb),
    listBills(sb),
    listCurrencies(sb),
    sb.rpc("acc_has_permission", { p_key: "fixed_assets.manage" }),
    sb.rpc("acc_has_permission", { p_key: "fixed_assets.post" }),
    sb.rpc("acc_has_permission", { p_key: "fixed_assets.import" }),
    sb.rpc("acc_has_permission", { p_key: "fixed_assets.dispose" }),
  ]);
  const baseCurrency = currencies.find((currency) => currency.is_base) ?? currencies[0];
  const postedBills = bills.filter((bill) => bill.status !== "draft" && bill.status !== "void" && bill.journal_entry_id);
  const canManage = !managePermission.error && managePermission.data === true;

  return (
    <div>
      <PageHeader
        title="Fixed Assets"
        description="Maintain the asset register, depreciation schedules, and General Ledger postings."
      />
      <FixedAssetsClient
        assets={assets}
        assetAccounts={accounts.filter(
          (account) => account.account_type === "fixed_asset" && account.status === "active" && account.is_posting_account,
        )}
        expenseAccounts={accounts.filter(
          (account) =>
            (account.account_type === "expense" || account.account_type === "other_expense") &&
            account.status === "active" &&
            account.is_posting_account,
        )}
        vendors={vendors.filter((vendor) => vendor.is_active)}
        bills={postedBills}
        currency={baseCurrency}
        canManage={canManage}
        canPost={!postPermission.error && postPermission.data === true}
        canImport={!importPermission.error && importPermission.data === true}
        canDispose={!disposePermission.error && disposePermission.data === true}
        proceedsAccounts={accounts.filter(
          (account) =>
            (account.account_type === "bank" ||
              account.account_type === "current_asset" ||
              account.account_type === "accounts_receivable") &&
            account.status === "active" &&
            account.is_posting_account,
        )}
        gainAccounts={accounts.filter(
          (account) =>
            (account.account_type === "income" || account.account_type === "other_income") &&
            account.status === "active" &&
            account.is_posting_account,
        )}
        lossAccounts={accounts.filter(
          (account) =>
            (account.account_type === "expense" || account.account_type === "other_expense") &&
            account.status === "active" &&
            account.is_posting_account,
        )}
        initialBillId={
          canManage && postedBills.some((bill) => bill.id === requestedBillId)
            ? requestedBillId
            : undefined
        }
      />
    </div>
  );
}
