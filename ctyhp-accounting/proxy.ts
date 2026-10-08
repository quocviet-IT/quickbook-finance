import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { skipsSession } from "@/lib/domain/public-routes";

/**
 * Runs before every matched request: refreshes the Supabase auth session
 * (keeping cookies fresh) and gates access — unauthenticated users are sent to
 * /login, authenticated users are kept out of /login.
 * (Next.js 16 renamed the middleware convention to `proxy`.)
 */
export async function proxy(request: NextRequest) {
  if (skipsSession(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

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
          response = NextResponse.next({ request });
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
  const signedIn = Boolean(data?.claims?.sub);

  const path = request.nextUrl.pathname;
  const isAuthRoute = path === "/login";

  if (!signedIn && !isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (signedIn && isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Run on everything except Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
