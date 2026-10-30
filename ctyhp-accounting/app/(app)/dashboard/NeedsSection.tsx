import NeedsAttention from "@/components/dashboard/NeedsAttention";
import { createSupabaseServerClient } from "@/lib/db/server";
import { CHECKS_FAILED, clearLine, dashboardNeeds, unavailableNote } from "@/lib/domain/dashboard-needs";
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
  try {
    const sb = await createSupabaseServerClient();
    const checks = await getAttentionChecks(sb, today);
    const needs = dashboardNeeds(checks, (minor) => formatMoney(minor, currencyCode, decimals));
    const clear = clearLine(checks.unavailable);
    if (needs.length === 0 && clear === null) return <NeedsAttention failure={CHECKS_FAILED} />;
    return <NeedsAttention needs={needs} clear={clear} note={unavailableNote(checks.unavailable)} />;
  } catch {
    return <NeedsAttention failure={CHECKS_FAILED} />;
  }
}
