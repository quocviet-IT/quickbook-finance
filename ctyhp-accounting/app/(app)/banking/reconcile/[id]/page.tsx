import { notFound } from "next/navigation";
import { z } from "zod";
import { getUserRole, canWrite, isAdmin } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/db/server";
import { listAccounts } from "@/lib/services/accounts";
import { listBankAccounts } from "@/lib/services/banking";
import { findReconciliationHeader } from "@/lib/services/bankrec";
import { listCurrencies } from "@/lib/services/reference";
import { readReconciliationOverrides } from "@/lib/services/override-notices";
import { formatMoney } from "@/lib/format";
import { statementFileAccount } from "@/lib/domain/statement-evidence";
import { balanceSideOf } from "@/lib/domain/card-account";
import PageHeader from "@/components/PageHeader";
import ReconcileWorkspaceClient from "./ReconcileWorkspaceClient";

export const dynamic = "force-dynamic";

export default async function ReconcileWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // An id that is not a uuid, or that names no reconciliation, is a page that
  // does not exist. Any other failure is an error, and shows as one.
  if (!z.uuid().safeParse(id).success) notFound();
  const sb = await createSupabaseServerClient();
  const role = await getUserRole();
  const header = await findReconciliationHeader(sb, id);
  if (!header) notFound();
  const currenciesRead = listCurrencies(sb);
  const [accounts, currencies, banks, overrides] = await Promise.all([
    listAccounts(sb),
    currenciesRead,
    listBankAccounts(sb),
    // The statements imported out of balance (2.11). A failed read must not take the page down.
    currenciesRead.then((list) => {
      const b = list.find((c) => c.is_base);
      return readReconciliationOverrides(sb, id, header, (minor) =>
        formatMoney(minor, b?.code ?? "USD", b?.decimal_places ?? 2),
      );
    }),
  ]);
  const base = currencies.find((c) => c.is_base);
  const { notices, unavailable: overridesUnavailable } = overrides;
  const bank = banks.find((b) => b.id === header.bankAccountId);
  const offsets = accounts.filter(
    (a) =>
      ["income", "other_income", "expense", "cost_of_goods_sold", "other_expense"].includes(a.account_type) &&
      a.is_posting_account &&
      a.status === "active",
  );
  return (
    <div>
      <PageHeader title="Reconciliation" description="Clear items until the difference is zero, then complete." />
      <ReconcileWorkspaceClient
        reconciliationId={id}
        canWrite={canWrite(role)}
        canReopen={isAdmin(role)}
        canOverride={isAdmin(role)}
        overrideNotices={notices}
        overridesUnavailable={overridesUnavailable}
        offsetAccounts={offsets.map((a) => ({ id: a.id, label: `${a.account_code} ${a.name}` }))}
        baseCurrency={base?.code ?? "USD"}
        baseDecimals={base?.decimal_places ?? 2}
        bankAccount={{
          id: header.bankAccountId,
          label: bank ? `${bank.bank_name || bank.account_name} · ${bank.account_code}` : "this bank account",
          maskedNumber: bank?.account_number_masked ?? null,
          decimals: base?.decimal_places ?? 2,
          currencyCode: bank?.currency_code ?? base?.code ?? "USD",
          // A credit card (2.45) is shown as its statement prints it.
          side: balanceSideOf(bank?.account_type),
        }}
        fileAccount={bank ? statementFileAccount(bank.bank_name || bank.account_name, bank.account_number_masked) : "Bank account"}
      />
    </div>
  );
}
