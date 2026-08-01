import "server-only";
import { cookies } from "next/headers";
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
 */
export async function resolveActiveCompany(): Promise<ActiveCompany> {
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
}

/**
 * The schema holding the books this request should read.
 *
 * Falls back to `public` only when the register cannot be consulted at all —
 * during sign-in, for instance, before there is a user to have memberships.
 * It is never used to paper over a slug the user is not entitled to; that case
 * has already resolved to one of their own companies above.
 */
export async function activeSchema(): Promise<string> {
  const { active } = await resolveActiveCompany();
  return active?.schemaName ?? "public";
}
