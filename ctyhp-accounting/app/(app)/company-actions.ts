"use server";
import { cookies } from "next/headers";
import { COMPANY_COOKIE, resolveActiveCompany } from "@/lib/db/company";

export interface SwitchResult {
  ok: boolean;
  error?: string;
}

/**
 * Open a different company.
 *
 * The slug is checked against the caller's own membership before it is written
 * anywhere. Setting a cookie is not authorisation, and a slug arriving from a
 * browser is not a permission — so a company this user does not belong to is
 * refused here, and would resolve to nothing even if it were not.
 */
export async function switchCompanyAction(slug: string): Promise<SwitchResult> {
  const { options } = await resolveActiveCompany();
  const chosen = options.find((company) => company.slug === slug);
  if (!chosen) return { ok: false, error: "You do not have access to that company" };

  const store = await cookies();
  store.set(COMPANY_COOKIE, chosen.slug, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return { ok: true };
}
