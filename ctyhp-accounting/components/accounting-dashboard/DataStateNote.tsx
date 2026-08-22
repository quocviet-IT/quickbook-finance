/**
 * Moved to `components/work-surface/DataStateNote.tsx` in Phase 6.
 *
 * "Computed at", "this is old" and "we could not look" have to mean the same
 * thing on Banking and Inventory as they do here, so they are drawn by one
 * component rather than four that drift. Re-exported so this area's sections
 * keep importing their pieces from one place.
 */
export {
  FreshnessNote,
  HealthyEmpty,
  UnavailableNote,
  freshnessOf,
  timeOnly,
} from "@/components/work-surface/DataStateNote";
