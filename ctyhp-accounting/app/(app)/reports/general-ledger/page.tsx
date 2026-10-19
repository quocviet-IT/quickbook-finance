import { createSupabaseServerClient } from "@/lib/db/server";
import { listAccounts } from "@/lib/services/accounts";
import { reportPageContext } from "@/lib/services/report-context";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import PageHeader from "@/components/PageHeader";
import GeneralLedgerClient from "./GeneralLedgerClient";

export const dynamic = "force-dynamic";

export default async function GeneralLedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; from?: string; to?: string }>;
}) {
  const sb = await createSupabaseServerClient();
  const filters = await searchParams;
  const [ctx, accounts] = await Promise.all([reportPageContext(sb), listAccounts(sb)]);
  const postingAccounts = accounts.filter((a) => a.is_posting_account && a.status === "active");
  return (
    <div>
      <PageHeader
        meta={<ReportEntityBadge companyName={ctx.companyName} isSample={ctx.isSample} />}
        title="General Ledger"
        description="Account activity with opening, per-line running balance, and closing balance."
      />
      <GeneralLedgerClient
        accounts={postingAccounts.map((a) => ({ id: a.id, account_code: a.account_code, name: a.name }))}
        companyName={ctx.companyName}
        presets={ctx.presets}
        baseCurrency={ctx.currencyCode}
        baseDecimals={ctx.decimals}
        initialAccountId={filters.account}
        initialFrom={filters.from}
        initialTo={filters.to}
      />
    </div>
  );
}
