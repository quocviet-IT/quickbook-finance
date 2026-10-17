import { statusLabel } from "@/lib/domain/status-label";
import { sourceLabel } from "@/lib/domain/entry-detail";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/db/server";
import { findReconciliationHeader, getReconciliationDetail, getReconciliationLines } from "@/lib/services/bankrec";
import { listCurrencies } from "@/lib/services/reference";
import { companyClock } from "@/lib/services/report-context";
import { formatDate, formatDateInTimeZone, formatMoney } from "@/lib/format";
import { readReconciliationOverrides } from "@/lib/services/override-notices";
import { shortSha } from "@/lib/domain/statement-evidence";
import PageHeader from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function ReconciliationReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const sb = await createSupabaseServerClient();
  const header = await findReconciliationHeader(sb, id);
  if (!header) notFound();
  const [detail, lines, currencies, { timeZone }] = await Promise.all([
    getReconciliationDetail(sb, id), getReconciliationLines(sb, id), listCurrencies(sb), companyClock(sb),
  ]);
  const base = currencies.find((c) => c.is_base);
  const dec = base?.decimal_places ?? 2;
  const money = (m: number) => formatMoney(m, base?.code ?? "USD", dec);
  const cleared = lines.filter((l) => l.cleared);
  // Statements imported out of balance that this reconciliation settled (2.11).
  // Only a completed reconciliation settles anything, so a draft reads nothing. A failed read must not take the report down.
  const { settles, unavailable: overridesUnavailable } =
    header.status === "completed"
      ? await readReconciliationOverrides(sb, id, header, money)
      : { settles: [], unavailable: false };
  return (
    <div>
      <PageHeader title="Reconciliation report" description={`Base currency ${base?.code ?? "USD"} · Status ${statusLabel(detail.status)}`} />
      <p><Link href={`/banking/reconcile/${id}`}>← Back to session</Link></p>
      {header.broughtForward ? <p><strong>{header.note ?? "Brought forward"}</strong></p> : null}
      {settles.map((line) => <p key={line.batchId}>{line.text}</p>)}
      {overridesUnavailable ? (
        <p role="alert"><strong>Could not check this period for statements imported out of balance.</strong></p>
      ) : null}
      {header.fileName ? (
        <p>
          Statement: {header.fileName}
          {header.openingMinor !== null ? ` · opens at ${money(header.openingMinor)}` : ""}
          {header.closingMinor !== null ? ` · closes at ${money(header.closingMinor)}` : ""}
        </p>
      ) : null}
      {/* The kept file, named so a printed report can be matched to it (1.83). */}
      {header.statementFile ? (
        <p>
          Statement file: {header.statementFile.fileName} · kept {formatDateInTimeZone(header.statementFile.keptAt, timeZone)} · SHA-256{" "}
          {shortSha(header.statementFile.sha256)} · <Link href={`/banking/statement-files/${header.statementFile.id}`}>View</Link>
        </p>
      ) : header.statementFileId ? (
        <p>A statement file is kept with this reconciliation.</p>
      ) : (
        <p>No statement file is kept with this reconciliation.</p>
      )}
      <table>
        <tbody>
          <tr><td>Beginning balance</td><td style={{ textAlign: "right" }}>{money(detail.beginningMinor)}</td></tr>
          <tr><td>Cleared total</td><td style={{ textAlign: "right" }}>{money(detail.clearedTotalMinor)}</td></tr>
          <tr><td>Reconciled balance</td><td style={{ textAlign: "right" }}>{money(detail.reconciledBalanceMinor)}</td></tr>
          <tr><td>Statement ending</td><td style={{ textAlign: "right" }}>{money(detail.statementEndingMinor)}</td></tr>
          <tr><td>Difference</td><td style={{ textAlign: "right" }}>{money(detail.differenceMinor)}</td></tr>
        </tbody>
      </table>
      <h3>Cleared items ({cleared.length})</h3>
      <ul>
        {cleared.map((l) => (
          <li key={l.journalLineId}>{formatDate(l.entryDate)} · {l.entryNumber} · {sourceLabel(l.sourceType)} · {money(l.signedMinor)}</li>
        ))}
      </ul>
    </div>
  );
}
