import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getUserRole, canWrite } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/db/server";
import { listBankAccounts } from "@/lib/services/banking";
import { getBankingContext } from "@/lib/services/banking-surface/facts";
import { listReconciliations } from "@/lib/services/bankrec";
import { listCurrencies } from "@/lib/services/reference";
import type { RunContext } from "@/lib/domain/statement-run";
import PageHeader from "@/components/PageHeader";
import FromFilesClient from "./FromFilesClient";

export const dynamic = "force-dynamic";

export default async function FromFilesPage({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  const { account } = await searchParams;
  if (!account || !z.uuid().safeParse(account).success) notFound();
  const sb = await createSupabaseServerClient();
  const role = await getUserRole();
  const [banks, currencies, reconciliations, { asOf }] = await Promise.all([
    listBankAccounts(sb),
    listCurrencies(sb),
    listReconciliations(sb, account),
    getBankingContext(sb),
  ]);
  const bank = banks.find((b) => b.id === account);
  if (!bank) notFound();
  const base = currencies.find((c) => c.is_base);
  // Newest first, as listReconciliations orders them.
  const completed = reconciliations.filter((r) => r.status === "completed");
  const inProgress = reconciliations.find((r) => r.status === "in_progress");
  const context: RunContext = {
    lastCompleted: completed[0]
      ? { date: completed[0].statement_ending_date, endingMinor: Number(completed[0].statement_ending_balance_minor) }
      : null,
    completedDates: completed.map((r) => r.statement_ending_date),
    inProgress: inProgress ? { id: inProgress.id, date: inProgress.statement_ending_date } : null,
    today: asOf,
  };
  return (
    <div>
      <PageHeader
        title="Reconcile from statement files"
        description="Choose the statement files and every month they cover is checked against the books in one pass, oldest first."
      />
      <p>
        <Link href="/banking/reconcile">← Bank Reconciliation</Link>
      </p>
      <FromFilesClient
        canWrite={canWrite(role)}
        bankAccount={{
          id: bank.id,
          label: `${bank.bank_name} · ${bank.account_number_masked ?? ""}`.trim(),
          maskedNumber: bank.account_number_masked,
          decimals: base?.decimal_places ?? 2,
          currencyCode: bank.currency_code,
        }}
        context={context}
      />
    </div>
  );
}
