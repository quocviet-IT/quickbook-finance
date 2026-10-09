import { createSupabaseServerClient } from "@/lib/db/server";
import { canWrite, getUserRole } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import { resolveTaxAccounts } from "@/lib/domain/sales-tax-liability";
import { listAccounts } from "@/lib/services/accounts";
import { listTaxCodes } from "@/lib/services/reference";
import { reportPageContext } from "@/lib/services/report-context";
import SalesTaxLiabilityClient from "./SalesTaxLiabilityClient";
import { salesTaxLiabilityAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function SalesTaxLiabilityPage() {
  const sb = await createSupabaseServerClient();
  const [ctx, role] = await Promise.all([reportPageContext(sb), getUserRole()]);
  const writer = canWrite(role);

  // Only a writer can record a payment, so only a writer needs the accounts to pay from and to.
  let taxPayableAccounts: { id: string; account_code: string; name: string }[] = [];
  let bankAccounts: { id: string; account_code: string; name: string }[] = [];
  if (writer) {
    const [accounts, codes] = await Promise.all([listAccounts(sb), listTaxCodes(sb)]);
    const taxIds = new Set(
      resolveTaxAccounts(
        accounts.map((a) => ({ id: a.id, name: a.name, accountType: a.account_type })),
        codes.map((c) => ({ direction: c.direction, taxAccountId: c.tax_account_id })),
      ).accountIds,
    );
    const open = accounts.filter((a) => a.is_posting_account && a.status === "active");
    const option = (a: { id: string; account_code: string; name: string }) => ({ id: a.id, account_code: a.account_code, name: a.name });
    taxPayableAccounts = open.filter((a) => taxIds.has(a.id)).map(option);
    bankAccounts = open.filter((a) => a.account_type === "bank" || a.account_type === "credit_card").map(option);
  }

  return (
    <div>
      <PageHeader
        meta={<ReportEntityBadge companyName={ctx.companyName} isSample={ctx.isSample} />}
        title="Sales Tax Liability"
        description="Sales tax charged and paid, period by period."
      />
      <SalesTaxLiabilityClient
        companyName={ctx.companyName}
        currencyCode={ctx.currencyCode}
        decimals={ctx.decimals}
        presets={ctx.presets}
        load={salesTaxLiabilityAction}
        canWrite={writer}
        taxPayableAccounts={taxPayableAccounts}
        bankAccounts={bankAccounts}
      />
    </div>
  );
}
