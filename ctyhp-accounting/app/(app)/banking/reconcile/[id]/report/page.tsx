import { statusLabel } from "@/lib/domain/status-label";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/db/server";
import { findReconciliationHeader } from "@/lib/services/bankrec";
import { listBankAccounts } from "@/lib/services/banking";
import { reportPageContext } from "@/lib/services/report-context";
import { formatDateInTimeZone, formatMoney } from "@/lib/format";
import { readReconciliationOverrides } from "@/lib/services/override-notices";
import { shortSha } from "@/lib/domain/statement-evidence";
import PageHeader from "@/components/PageHeader";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import ReconciliationReportClient, { type ReportFact } from "./ReconciliationReportClient";

export const dynamic = "force-dynamic";

export default async function ReconciliationReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const sb = await createSupabaseServerClient();
  const header = await findReconciliationHeader(sb, id);
  if (!header) notFound();
  const [ctx, banks] = await Promise.all([reportPageContext(sb), listBankAccounts(sb)]);
  const money = (minor: number) => formatMoney(minor, ctx.currencyCode, ctx.decimals);
  // Statements imported out of balance that this reconciliation settled (2.11).
  // Only a completed reconciliation settles anything, so a draft reads nothing. A failed read must not take the report down.
  const { settles, unavailable: overridesUnavailable } =
    header.status === "completed"
      ? await readReconciliationOverrides(sb, id, header, money)
      : { settles: [], unavailable: false };
  const bank = banks.find((b) => b.id === header.bankAccountId);
  const accountLabel = bank ? `${bank.bank_name || bank.account_name} · ${bank.account_code}` : "Bank account";

  // What the report rests on, said above its figures.
  const facts: ReportFact[] = [
    ...(header.broughtForward ? [{ key: "brought-forward", text: "Brought forward: the account's earlier history was signed off in one step." }] : []),
    ...settles.map((line) => ({ key: `settles-${line.batchId}`, text: line.text })),
    ...(overridesUnavailable
      ? [{ key: "settles-unavailable", text: "Could not check this period for statements imported out of balance." }]
      : []),
    ...(header.fileName
      ? [
          {
            key: "statement",
            text:
              `Statement: ${header.fileName}` +
              (header.openingMinor !== null ? ` · opens at ${money(header.openingMinor)}` : "") +
              (header.closingMinor !== null ? ` · closes at ${money(header.closingMinor)}` : ""),
          },
        ]
      : []),
    // The kept file, named so a printed report can be matched to it (1.83).
    header.statementFile
      ? {
          key: "file",
          text: `Statement file: ${header.statementFile.fileName} · kept ${formatDateInTimeZone(header.statementFile.keptAt, ctx.timeZone)} · SHA-256 ${shortSha(header.statementFile.sha256)}`,
          link: { href: `/banking/statement-files/${header.statementFile.id}`, label: "View" },
        }
      : {
          key: "file",
          text: header.statementFileId
            ? "A statement file is kept with this reconciliation."
            : "No statement file is kept with this reconciliation.",
        },
  ];

  return (
    <div>
      <PageHeader
        meta={<ReportEntityBadge companyName={ctx.companyName} isSample={ctx.isSample} />}
        title="Reconciliation report"
        description={`${accountLabel} · ${statusLabel(header.status)}`}
      />
      <p>
        <Link href={`/banking/reconcile/${id}`}>← Back to the reconciliation</Link>
      </p>
      <ReconciliationReportClient
        reconciliationId={id}
        companyName={ctx.companyName}
        currencyCode={ctx.currencyCode}
        decimals={ctx.decimals}
        today={ctx.today}
        accountLabel={accountLabel}
        statementDate={header.endingDate}
        facts={facts}
      />
    </div>
  );
}
