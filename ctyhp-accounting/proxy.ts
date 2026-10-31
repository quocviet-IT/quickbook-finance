import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { contentSecurityPolicy, newNonce, NONCE_HEADER } from "@/lib/domain/content-security-policy";
import { skipsSession } from "@/lib/domain/public-routes";
import { sessionRedirect } from "@/lib/domain/two-step";

/**
 * Runs before every matched request: refreshes the Supabase auth session
 * (keeping cookies fresh) and gates access — unauthenticated users are sent to
 * /login, authenticated users are kept out of /login — and gives the response
 * its Content-Security-Policy with a fresh nonce (2.95).
 * (Next.js 16 renamed the middleware convention to `proxy`.)
 */
export async function proxy(request: NextRequest) {
  const nonce = newNonce();
  const policy = contentSecurityPolicy({
    nonce,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    development: process.env.NODE_ENV === "development",
  });
  // Next reads the nonce from the request's own policy header and stamps its
  // scripts with it; the root layout reads NONCE_HEADER for the theme script.
  // Built from the request each time: the session refresh below rewrites its
  // cookies, and the page must see those too.
  const next = () => {
    const headers = new Headers(request.headers);
    headers.set(NONCE_HEADER, nonce);
    headers.set("content-security-policy", policy);
    return NextResponse.next({ request: { headers } });
  };
  const withPolicy = <T extends NextResponse>(response: T): T => {
    response.headers.set("Content-Security-Policy", policy);
    return response;
  };

  if (skipsSession(request.nextUrl.pathname)) {
    return withPolicy(next());
  }

  let response = next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = next();
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          // The library sends no-store headers with refreshed auth cookies: a
          // cached response carrying one person's session cookie could be
          // served to somebody else.
          for (const [name, value] of Object.entries(headers ?? {})) {
            response.headers.set(name, value);
          }
        },
      },
    },
  );

  // Verified locally, not asked of the auth server. Tokens here are signed
  // with ES256, so getClaims checks the signature against the published key
  // set (cached for ten minutes) after refreshing an expired session — the
  // same refresh getUser did — without a network call on the path of every
  // page, navigation, prefetch and server action. This only routes: the
  // layout still confirms the user with the auth server once per render, and
  // RLS reads the same token for every query.
  const { data } = await supabase.auth.getClaims();
  let signedIn = Boolean(data?.claims?.sub);

  // On /login alone, ask the auth server as well. A session revoked elsewhere
  // (a sign-out of every device, say) still verifies locally until its token
  // expires; bounced from here to the dashboard, whose layout does ask the
  // server and sends it back here, it looped until the browser gave up
  // (ERR_TOO_MANY_REDIRECTS, 27 October 2026). Its cookies are cleared
  // instead and the sign-in form shows. /login is rare enough to pay for one
  // round trip.
  if (signedIn && request.nextUrl.pathname === "/login") {
    const { data: confirmed } = await supabase.auth.getUser();
    if (!confirmed.user) {
      await supabase.auth.signOut({ scope: "local" });
      signedIn = false;
    }
  }

  // Whether the session still owes its second sign-in step is not decided
  // here: that needs the person's factors, which the token does not carry. The
  // app layout asks the auth server for them anyway, and sends such a session
  // to /login?step=code, which this lets through (2.65).
  const target = sessionRedirect(
    request.nextUrl.pathname,
    request.nextUrl.searchParams.get("step"),
    signedIn,
  );
  if (target) {
    const url = request.nextUrl.clone();
    url.pathname = target;
    url.search = "";
    return withPolicy(NextResponse.redirect(url));
  }

  return withPolicy(response);
}

export const config = {
  // Run on everything except Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
