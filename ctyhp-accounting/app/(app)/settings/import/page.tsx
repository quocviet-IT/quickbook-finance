import { createSupabaseServerClient } from "@/lib/db/server";
import { resolveActiveCompany } from "@/lib/db/company";
import { listCurrencies } from "@/lib/services/reference";
import { listAccounts } from "@/lib/services/accounts";
import PageHeader from "@/components/PageHeader";
import ImportClient from "./ImportClient";
import { requireSettingsAccess } from "@/lib/db/settings-access";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  await requireSettingsAccess("/settings/import");
  const sb = await createSupabaseServerClient();
  const [currencies, accounts, { active }] = await Promise.all([
    listCurrencies(sb),
    listAccounts(sb),
    resolveActiveCompany(),
  ]);
  const base = currencies.find((c) => c.is_base);
  // Only somewhere a bank line can actually post: the same filter /banking uses.
  const bankAccounts = accounts.filter(
    (account) =>
      (account.account_type === "bank" || account.account_code === "1210") &&
      account.is_posting_account &&
      account.status === "active",
  );
  return (
    <div>
      <PageHeader
        title="Import from QuickBooks or Wave"
        description="Bring a company's chart of accounts, contacts, products and opening balances across. Nothing is written until you have seen what will happen."
      />
      <ImportClient
        companyName={active?.legalName ?? "this company"}
        isSampleCompany={active?.isSample ?? false}
        baseDecimals={base?.decimal_places ?? 2}
        bankAccounts={bankAccounts}
      />
    </div>
  );
}
