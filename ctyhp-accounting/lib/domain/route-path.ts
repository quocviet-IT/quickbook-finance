/**
 * A browser path reduced to the screen it shows.
 *
 * Its own module (3.0.17) so that anything on every page — the Help link in
 * the page header — can use it without importing the guide's workflows, which
 * is where it used to live (lib/domain/screen-context.ts re-exports it).
 */

/** Strip query strings, fragments, trailing slashes and record ids down to the route. */
export function normaliseRoute(raw: string): string {
  const path = (raw ?? "").split("?")[0].split("#")[0];
  const trimmed = path.replace(/\/+$/, "");
  if (trimmed === "") return "/";
  // `/invoices/8f3c…` is still the invoices screen as far as the guide knows.
  return trimmed.replace(
    /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}.*$/i,
    "",
  );
}
