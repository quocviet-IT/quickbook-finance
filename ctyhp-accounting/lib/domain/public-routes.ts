/**
 * Paths that skip the session entirely.
 *
 * Route Handlers are independent security boundaries: the cron endpoints verify
 * CRON_SECRET themselves and have no browser session to refresh.
 *
 * `/status` reports whether the application is up, so it must not depend on the
 * very thing it reports on. Refreshing a session there would make the page fail
 * whenever authentication is the broken part — which is exactly when somebody
 * goes looking for it.
 *
 * Kept out of proxy.ts so a test can reach it without loading next/server and
 * @supabase/ssr for the sake of one pure predicate.
 */
export function skipsSession(pathname: string): boolean {
  // A trailing slash is ordinary in a pasted or typed address, and `/status/`
  // matching nothing would drop it through to the session gate and bounce a
  // signed-out reader to /login — the one outcome this exists to prevent.
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return path.startsWith("/api/") || path === "/status";
}
