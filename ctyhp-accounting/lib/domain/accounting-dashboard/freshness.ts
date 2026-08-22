/**
 * Moved to `lib/domain/work-surface/freshness.ts` in Phase 6: how old a figure
 * has to be before a reader should stop trusting it is not an accounting
 * question, and Banking asks it too.
 *
 * Re-exported so this area's components keep importing from one place.
 */
export { STALE_AFTER_MS, freshnessOf } from "@/lib/domain/work-surface/freshness";
