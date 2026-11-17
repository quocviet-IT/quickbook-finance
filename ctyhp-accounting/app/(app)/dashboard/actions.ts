"use server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveActiveCompany } from "@/lib/db/company";
import { createSupabaseServerClient, createSupabaseServerClientForSchema } from "@/lib/db/server";
import { normalizeCardChoices } from "@/lib/domain/dashboard-home/card-choices";
import { isStandard, normalizeOverview } from "@/lib/domain/dashboard-home/layout";
import { WATCHLIST_MAX } from "@/lib/domain/dashboard-home/watchlist";
import { saveDashboardCards, saveDashboardPreference } from "@/lib/services/dashboard-preferences";

/**
 * Each person's own Dashboard (3.0.39): the Overview's layout, the account
 * watchlist and Privacy; and each card's choice (3.0.41).
 *
 * Thin wrappers: each resolves the signed-in person and the open company on the
 * server, never from the browser, checks what it was given, then calls the
 * preference service. None throws to the client; a failure comes back as
 * `{ ok: false, error }`.
 */

export type DashboardActionResult = { ok: true } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIGNED_OUT = "Sign in to change your dashboard.";
const NO_COMPANY = "Open a company to change your dashboard.";
const FAILED = "Your dashboard could not be saved. Try again in a moment.";

async function withPreference(
  run: (sb: SupabaseClient, companyId: string) => Promise<DashboardActionResult>,
): Promise<DashboardActionResult> {
  try {
    const sb = await createSupabaseServerClientForSchema("onebook");
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) return { ok: false, error: SIGNED_OUT };
    const { active } = await resolveActiveCompany();
    if (!active) return { ok: false, error: NO_COMPANY };
    return await run(sb, active.id);
  } catch (err) {
    console.error("Dashboard preference failed:", err instanceof Error ? err.message : err);
    return { ok: false, error: FAILED };
  }
}

/**
 * Keeps the person's Overview layout. Whatever arrives is read as a layout
 * first; one that is the Standard layout is saved as no layout at all, so the
 * person follows Standard as it changes.
 */
export async function saveOverviewLayoutAction(layout: unknown): Promise<DashboardActionResult> {
  const overview = normalizeOverview(layout);
  if (overview.shown.length === 0) return { ok: false, error: "Show at least one card." };
  return withPreference(async (sb, companyId) => {
    await saveDashboardPreference(sb, companyId, { overview: isStandard(overview) ? null : overview });
    return { ok: true };
  });
}

/** Keeps the person's watchlist: at most 10 accounts of the open company's chart, each once, in their order. */
export async function saveWatchlistAction(accountIds: unknown): Promise<DashboardActionResult> {
  if (!Array.isArray(accountIds) || accountIds.some((id) => typeof id !== "string" || !UUID.test(id))) {
    return { ok: false, error: "Choose accounts from the list." };
  }
  const ids = (accountIds as string[]).map((id) => id.toLowerCase());
  if (ids.length > WATCHLIST_MAX) return { ok: false, error: `Choose up to ${WATCHLIST_MAX} accounts.` };
  if (new Set(ids).size !== ids.length) return { ok: false, error: "Choose each account once." };
  return withPreference(async (sb, companyId) => {
    if (ids.length > 0) {
      // The open company's own books: an id from anywhere else is not in them.
      const books = await createSupabaseServerClient();
      const { data, error } = await books.from("acc_account").select("id").in("id", ids);
      if (error) throw new Error(error.message);
      const known = new Set(((data ?? []) as { id: string }[]).map((row) => String(row.id).toLowerCase()));
      if (ids.some((id) => !known.has(id))) return { ok: false, error: "An account you chose is no longer in the chart of accounts." };
    }
    await saveDashboardPreference(sb, companyId, { watchlist: ids });
    return { ok: true };
  });
}

/** Turns Privacy on or off for the person in the open company. */
export async function setPrivacyAction(on: unknown): Promise<DashboardActionResult> {
  if (typeof on !== "boolean") return { ok: false, error: "Privacy is either on or off." };
  return withPreference(async (sb, companyId) => {
    await saveDashboardPreference(sb, companyId, { privacy: on });
    return { ok: true };
  });
}

/**
 * Keeps each card's choice for the person in the open company. Whatever
 * arrives is read as choices first: what no card offers is dropped and the
 * defaults fill the rest, so only choices the screen can draw are saved.
 */
export async function saveCardChoicesAction(choices: unknown): Promise<DashboardActionResult> {
  return withPreference(async (sb, companyId) => {
    await saveDashboardCards(sb, companyId, normalizeCardChoices(choices));
    return { ok: true };
  });
}
