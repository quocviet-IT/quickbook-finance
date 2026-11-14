import NeedsAttention from "@/components/dashboard-home/NeedsAttention";
import type { HomeNeedsReport } from "@/lib/domain/dashboard-home/types";
import { CHECKS_FAILED } from "@/lib/domain/dashboard-needs";

/**
 * Needs attention (2.88, rebuilt with the Dashboard in 3.0.38), drawn once its
 * read has come back. The page starts the read and wraps this in Suspense, so
 * the read never holds up the figures above it; the same read gives the tabs
 * their counts, so it is made once.
 *
 * The rows when there are any; the clear line when there are none; and when
 * not even that can be said, because no check could run, the sentence that
 * says so. A note under the rows names any check that could not run.
 */
export default async function NeedsSection({ report }: { report: Promise<HomeNeedsReport> }) {
  // Only the read is guarded: an error while drawing belongs to an error boundary, not here.
  let read: HomeNeedsReport | null = null;
  try {
    read = await report;
  } catch (cause) {
    console.error("Needs attention could not be read:", cause);
    read = null;
  }
  if (!read) return <NeedsAttention failure={CHECKS_FAILED} />;
  if (read.needs.length === 0 && read.clear === null) return <NeedsAttention failure={CHECKS_FAILED} />;
  return <NeedsAttention needs={read.needs} clear={read.clear} note={read.note} />;
}
