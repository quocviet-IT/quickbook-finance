import { createSupabaseServerClient } from "@/lib/db/server";
import { getSalesTaxLiability, listTaxPayments } from "@/lib/services/salestax";
import { listTaxCodes, listCurrencies } from "@/lib/services/reference";
import { listAccounts } from "@/lib/services/accounts";
import { getUserRole, canWrite, isAdmin } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import SalesTaxClient from "./SalesTaxClient";

export const dynamic = "force-dynamic";

function monthStart(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function today(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default async function SalesTaxPage() {
  const sb = await createSupabaseServerClient();
  // Note: default range is computed on the server request; the client can change it.
  const now = new Date();
  const from = monthStart(now);
  const to = today(now);

  const [liability, payments, taxCodes, accounts, currencies, role] = await Promise.all([
    getSalesTaxLiability(sb, from, to),
    listTaxPayments(sb),
    listTaxCodes(sb),
    listAccounts(sb),
    listCurrencies(sb),
    getUserRole(),
  ]);

  // Only the account(s) actually used as the Sales Tax Payable by sales-direction
  // tax codes — the same set acc_sales_tax_payable_balance counts. Paying into any
  // other liability account would not reduce the reported "Net owed".
  const salesTaxAccountIds = new Set(
    taxCodes.filter((t) => t.direction === "sales" && t.tax_account_id).map((t) => t.tax_account_id as string),
  );
  const taxPayableAccounts = accounts.filter(
    (a) => salesTaxAccountIds.has(a.id) && a.is_posting_account && a.status === "active",
  );
  const bankAccounts = accounts.filter(
    (a) => (a.account_type === "bank" || a.account_type === "credit_card") && a.is_posting_account && a.status === "active",
  );
  const postingAccounts = accounts.filter((a) => a.is_posting_account && a.status === "active");

  return (
    <div>
      <PageHeader title="Sales Tax" description="Review sales tax owed, record payments, and manage rates." />
      <SalesTaxClient
        initialFrom={from}
        initialTo={to}
        initialLiability={liability}
        payments={payments}
        taxCodes={taxCodes}
        taxPayableAccounts={taxPayableAccounts}
        bankAccounts={bankAccounts}
        postingAccounts={postingAccounts}
        currencies={currencies}
        canWrite={canWrite(role)}
        isAdmin={isAdmin(role)}
      />
    </div>
  );
}
