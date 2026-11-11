/**
 * The name a person knows a screen by (3.0.17).
 *
 * The guide used to say "starts at /settings/import" and "You are on /banking".
 * A path is how the code finds a screen; a person finds it by the words on the
 * menu. Those words already exist — the sidebar, the settings hub and the
 * report centre each name their screens — so they are read from there, never
 * typed a second time where they could drift.
 *
 * Pure, and deliberately free of the guide's own data, so anything may ask for
 * a screen's name without carrying every workflow with it.
 */

import { NAV, SETTINGS_HUB, isNavGroup } from "./navigation";
import { REPORT_CATALOG } from "./report-catalog";
import { normaliseRoute as screenRoute } from "./route-path";

/**
 * Screens no menu names, but the guide or a release note sends people to. Kept
 * to what is not reachable from the three catalogues above; a test proves every
 * route the guide uses is named by one or the other.
 */
const OTHER_SCREENS: Readonly<Record<string, string>> = {
  "/guide": "Guide",
  "/approvals": "Approvals",
  "/banking/reconcile/history": "Reconcile history",
  "/purchase-orders/received-not-billed": "Received Not Billed",
  "/account/two-step": "Two-step sign-in",
};

const NAMES: ReadonlyMap<string, string> = (() => {
  const names = new Map<string, string>();
  const add = (href: string, name: string) => {
    const route = screenRoute(href);
    if (!names.has(route)) names.set(route, name);
  };
  for (const item of NAV) {
    if (!isNavGroup(item)) {
      add(item.key, item.label);
      continue;
    }
    // Five groups each have an "Overview"; on its own the word names none of them.
    for (const child of item.children) add(child.key, child.label === "Overview" ? `${item.label} overview` : child.label);
  }
  for (const group of SETTINGS_HUB) for (const entry of group.items) add(entry.href, entry.title);
  for (const report of REPORT_CATALOG) add(report.href, report.title);
  for (const [route, name] of Object.entries(OTHER_SCREENS)) add(route, name);
  return names;
})();

/** The screen's name from the menus, or null when no menu names it. */
export function knownScreenName(route: string): string | null {
  return NAMES.get(screenRoute(route)) ?? null;
}

/**
 * The screen's name, always words: for a screen no menu names yet, its last
 * path segment made readable ("/some/new-screen" reads "New screen").
 */
export function screenName(route: string): string {
  const known = knownScreenName(route);
  if (known) return known;
  const last = screenRoute(route).split("/").filter(Boolean).pop() ?? "";
  const words = last.replace(/[-_]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "OneBook";
}
