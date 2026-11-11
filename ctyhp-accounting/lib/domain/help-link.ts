/**
 * The Help link every page header carries (3.0.17).
 *
 * Kept apart from the guide's data on purpose: the page header is on every
 * screen, and the workflows are some 1,600 lines that only the guide's own
 * pages should download. The link carries the screen's path; the guide reads
 * it back and opens on what covers that screen (lib/domain/guide-help.ts).
 */

import { normaliseRoute } from "./route-path";

/** The guide's own address; the Help link is not offered there. */
export const GUIDE_ROUTE = "/guide";

/** Where a screen's Help link goes, or null on the guide itself. */
export function helpHref(pathname: string): string | null {
  const route = normaliseRoute(pathname);
  if (route === GUIDE_ROUTE || route.startsWith(`${GUIDE_ROUTE}/`)) return null;
  return `${GUIDE_ROUTE}?from=${encodeURIComponent(route)}`;
}
