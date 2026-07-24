import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getReconciliationDetail, getReconciliationLines } from "@/lib/services/bankrec";
import { listCurrencies } from "@/lib/services/reference";
import { fromMinor } from "@/lib/domain/money";
import PageHeader from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function ReconciliationReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await createSupabaseServerClient();
  const [detail, lines, currencies] = await Promise.all([
    getReconciliationDetail(sb, id), getReconciliationLines(sb, id), listCurrencies(sb),
  ]);
  const base = currencies.find((c) => c.is_base);
  const dec = base?.decimal_places ?? 2;
  const fmt = (m: number) => fromMinor(m, dec).toLocaleString(undefined, { minimumFractionDigits: dec });
  const cleared = lines.filter((l) => l.cleared);
  return (
    <div>
      <PageHeader title="Reconciliation report" description={`Base currency ${base?.code ?? "USD"} · Status ${detail.status}`} />
      <p><Link href={`/banking/reconcile/${id}`}>← Back to session</Link></p>
      <table>
        <tbody>
          <tr><td>Beginning balance</td><td style={{ textAlign: "right" }}>{fmt(detail.beginningMinor)}</td></tr>
          <tr><td>Cleared total</td><td style={{ textAlign: "right" }}>{fmt(detail.clearedTotalMinor)}</td></tr>
          <tr><td>Reconciled balance</td><td style={{ textAlign: "right" }}>{fmt(detail.reconciledBalanceMinor)}</td></tr>
          <tr><td>Statement ending</td><td style={{ textAlign: "right" }}>{fmt(detail.statementEndingMinor)}</td></tr>
          <tr><td>Difference</td><td style={{ textAlign: "right" }}>{fmt(detail.differenceMinor)}</td></tr>
        </tbody>
      </table>
      <h3>Cleared items ({cleared.length})</h3>
      <ul>
        {cleared.map((l) => (
          <li key={l.journalLineId}>{l.entryDate} · {l.entryNumber} · {l.sourceType} · {fmt(l.signedMinor)}</li>
        ))}
      </ul>
    </div>
  );
}
