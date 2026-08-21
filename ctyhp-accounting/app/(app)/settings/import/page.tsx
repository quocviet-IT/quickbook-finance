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
  const [currencies, accounts, { active }, customer, taxCode] = await Promise.all([
    listCurrencies(sb),
    listAccounts(sb),
    resolveActiveCompany(),
    // One real name each, so the template a reader downloads is a file that
    // imports rather than one that only shows the shape. The invoice importer
    // refuses an unknown customer and an unknown tax code, and a template
    // carrying invented ones imported nothing at all.
    sb.from("acc_customer").select("name").order("created_at").limit(1).maybeSingle(),
    sb.from("acc_tax_code").select("code").order("code").limit(1).maybeSingle(),
  ]);
  const base = currencies.find((c) => c.is_base);
  // Only somewhere a bank line can actually post: the same filter /banking uses.
  // The same filter acc_import_invoices searches, so the example account is one
  // an invoice line may actually credit.
  const incomeAccount = accounts.find(
    (account) =>
      account.account_type === "income" &&
      account.is_posting_account &&
      account.status === "active",
  );
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
        accounts={accounts}
        templateExamples={{
          // Absent rather than invented: with no customer on file there is no
          // name that would import, and the guidance already says to bring
          // customers across first.
          ...(customer.data?.name ? { customer: String(customer.data.name) } : {}),
          ...(incomeAccount ? { income_account: incomeAccount.account_code } : {}),
          // Null writes an empty cell. Sales tax is optional on a line, and a
          // code that does not exist blocks the whole invoice.
          tax_code: taxCode.data?.code ? String(taxCode.data.code) : null,
        }}
      />
    </div>
  );
}
