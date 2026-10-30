import NeedsAttention from "@/components/dashboard/NeedsAttention";
import { holdsPermission } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/db/server";
import { CHECKS_FAILED, clearLine, dashboardNeeds, unavailableNote, type AttentionChecks } from "@/lib/domain/dashboard-needs";
import { formatMoney } from "@/lib/format";
import { getAttentionChecks } from "@/lib/services/exceptions";

/**
 * Needs attention (2.88), read on the server after the rest of the Dashboard
 * has been sent: the page wraps it in Suspense, so its reads never hold up the
 * figures above it. Drawn by a client component; this one only reads.
 */
export default async function NeedsSection({
  today,
  currencyCode,
  decimals,
}: {
  today: string;
  currencyCode: string;
  decimals: number;
}) {
  // Only the reads are guarded: an error while drawing belongs to an error boundary, not here.
  let checks: AttentionChecks | null = null;
  try {
    const sb = await createSupabaseServerClient();
    // Only someone who may see the backups is told one is late; for anyone else the read finds nothing.
    checks = await getAttentionChecks(sb, today, { backups: await holdsPermission("company.export") });
  } catch {
    checks = null;
  }
  if (!checks) return <NeedsAttention failure={CHECKS_FAILED} />;
  const needs = dashboardNeeds(checks, (minor) => formatMoney(minor, currencyCode, decimals));
  const clear = clearLine(checks);
  if (needs.length === 0 && clear === null) return <NeedsAttention failure={CHECKS_FAILED} />;
  return <NeedsAttention needs={needs} clear={clear} note={unavailableNote(checks.unavailable)} />;
}
