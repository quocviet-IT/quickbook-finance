import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import type { User } from "@supabase/supabase-js";
import { createSupabaseServerClientForSchema } from "./server";

/**
 * Which company this request is working in.
 *
 * Every company's books live in their own schema, so before anything can be
 * read the request has to know which schema that is. Getting this wrong is the
 * one failure the whole design exists to prevent, so the rule is narrow:
 *
 *   the schema is only ever taken from the list of companies this user is a
 *   member of.
 *
 * The cookie names a preference, not a destination. A slug that is unknown,
 * archived, or simply not theirs does not resolve to somebody else's ledger —
 * it resolves to the first company they *are* entitled to, and if they are
 * entitled to none, to nothing at all.
 */

export const COMPANY_COOKIE = "onebook-company";

export interface CompanyOption {
  id: string;
  slug: string;
  schemaName: string;
  legalName: string;
  dbaName: string | null;
  isSample: boolean;
}

export interface ActiveCompany {
  /** Null when the user belongs to no company — the app must say so, not guess. */
  active: CompanyOption | null;
  /** Everything this user may switch to, in display order. */
  options: CompanyOption[];
}

/**
 * The companies this session may open, and which one is current.
 *
 * One round trip: the list is what the switcher shows *and* what the cookie is
 * validated against, so a forbidden slug cannot resolve by construction.
 *
 * Asked once per request. Every company-bound client asks it (through
 * `activeSchema`), and the answer cannot change within one render. A Server
 * Action is not a render, so `switchCompanyAction` still reads fresh, and the
 * render after it is a new request that reads the new cookie.
 */
export const resolveActiveCompany = cache(async (): Promise<ActiveCompany> => {
  const control = await createSupabaseServerClientForSchema("onebook");
  const { data, error } = await control.rpc("my_companies");
  if (error) {
    // A user who is not signed in, or a database that predates the register,
    // has no companies. Report nothing rather than inventing one.
    return { active: null, options: [] };
  }

  const options: CompanyOption[] = ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: row.id as string,
    slug: row.slug as string,
    schemaName: row.schema_name as string,
    legalName: row.legal_name as string,
    dbaName: (row.dba_name as string | null) ?? null,
    isSample: Boolean(row.is_sample),
  }));

  if (options.length === 0) return { active: null, options };

  const store = await cookies();
  const wanted = store.get(COMPANY_COOKIE)?.value;
  const active = options.find((c) => c.slug === wanted) ?? options[0];
  return { active, options };
});

/**
 * Who is signed in, asked once per request.
 *
 * Signing in is not a company question, so this reads through the register's
 * client rather than one bound to books this account may not have. The layout,
 * `currentAccess` and `getSessionUser` all ask it; before it was shared each of
 * them made its own call to the auth server.
 */
export const currentUser = cache(async (): Promise<User | null> => {
  const control = await createSupabaseServerClientForSchema("onebook");
  const {
    data: { user },
  } = await control.auth.getUser();
  return user;
});

/**
 * Raised when a request needs books to read and this account is entitled to
 * none. Caught by the app layout, which says so rather than showing an empty
 * shell over somebody else's ledger.
 */
export class NoActiveCompanyError extends Error {
  constructor() {
    super("This account does not belong to any company.");
    this.name = "NoActiveCompanyError";
  }
}

/**
 * The schema holding the books this request should read.
 *
 * **Fails closed.** This used to end `?? "public"`, described as a fallback for
 * sign-in — but it fired for any account the register returned nothing for, and
 * `public` is not an empty schema, it is the first company's real ledger. An
 * account holding a role in `public` and no entitlement therefore read that
 * company's books while its own switcher showed no company at all. Reproduced
 * on live data before the fix: `my_companies()` returned nothing,
 * `acc_current_role()` returned `accountant`, and 14 invoices were readable.
 *
 * Nothing on the sign-in path needs this: `proxy.ts` builds its own client, the
 * login screen uses the browser client, and the layout resolves the company
 * itself before asking for one bound to it. So there is no case left where
 * guessing a schema is better than refusing.
 */
export async function activeSchema(): Promise<string> {
  const { active } = await resolveActiveCompany();
  if (!active) throw new NoActiveCompanyError();
  return active.schemaName;
}

/**
 * May this session create a company?
 *
 * Kept apart from `resolveActiveCompany` because it answers a different
 * question: not "whose books may I open" but "may I make new ones". A refusal
 * here only hides a button; `onebook.request_company` refuses again regardless.
 */
export const isPlatformAdmin = cache(async (): Promise<boolean> => {
  const control = await createSupabaseServerClientForSchema("onebook");
  const { data, error } = await control.rpc("is_platform_admin");
  if (error) return false;
  return Boolean(data);
});
