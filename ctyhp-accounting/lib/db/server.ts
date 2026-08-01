import "server-only";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { activeSchema } from "./company";

/**
 * A Supabase client bound to one schema.
 *
 * Every company's books live in their own schema, so which schema a client
 * talks to *is* which company it can see. There is no company filter to get
 * wrong: a query issued against one company's schema cannot return another's
 * rows, because they are not in it.
 *
 * Used directly only where the schema is known without asking — the control
 * plane, and the sign-in path. Everything else goes through
 * `createSupabaseServerClient`, which works it out.
 */
// The return type is the schema-agnostic client on purpose. Which schema a
// client is bound to is a runtime fact, not a compile-time one — the services
// take the same client whichever company they are reading.
export async function createSupabaseServerClientForSchema(
  schema: string,
): Promise<SupabaseClient> {
  const cookieStore = await cookies();

  // `createServerClient` types the schema into the client. Every service takes
  // the schema-agnostic client, so the generic is widened once, here, rather
  // than threaded through 70 call sites that do not care.
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      db: { schema },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // `setAll` was called from a Server Component where cookies are
            // read-only. Session refresh happens in proxy.ts, so this is safe
            // to ignore.
          }
        },
      },
    },
  ) as unknown as SupabaseClient;
}

/**
 * Supabase client for Server Components, Route Handlers, and Server Actions,
 * bound to the company this request is working in.
 *
 * In Next.js 16 `cookies()` is async, so this factory is async too. Acts as the
 * authenticated user — Row Level Security applies within the company, and the
 * schema decides which company that is.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  return createSupabaseServerClientForSchema(await activeSchema());
}
