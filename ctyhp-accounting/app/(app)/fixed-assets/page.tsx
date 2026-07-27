import PageHeader from "@/components/PageHeader";
import { createSupabaseServerClient } from "@/lib/db/server";
import { listAccounts } from "@/lib/services/accounts";
import { listFixedAssets } from "@/lib/services/fixed-assets";
import { listBills, listVendors } from "@/lib/services/payables";
import { listCurrencies } from "@/lib/services/reference";
import FixedAssetsClient from "./FixedAssetsClient";

export const dynamic = "force-dynamic";

export default async function FixedAssetsPage() {
  const sb = await createSupabaseServerClient();
  const [assets, accounts, vendors, bills, currencies, managePermission, postPermission] = await Promise.all([
    listFixedAssets(sb),
    listAccounts(sb),
    listVendors(sb),
    listBills(sb),
    listCurrencies(sb),
    sb.rpc("acc_has_permission", { p_key: "fixed_assets.manage" }),
    sb.rpc("acc_has_permission", { p_key: "fixed_assets.post" }),
  ]);
  const baseCurrency = currencies.find((currency) => currency.is_base) ?? currencies[0];

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
        bills={bills.filter((bill) => bill.status !== "void")}
        currency={baseCurrency}
        canManage={!managePermission.error && managePermission.data === true}
        canPost={!postPermission.error && postPermission.data === true}
      />
    </div>
  );
}
