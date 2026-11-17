import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_CARD_CHOICES, normalizeCardChoices, type CardChoices } from "@/lib/domain/dashboard-home/card-choices";
import { normalizeOverview, standardLayout, type OverviewLayout } from "@/lib/domain/dashboard-home/layout";

/**
 * Each person's own Dashboard (migration 0198): the Overview's layout, the
 * account watchlist and Privacy, per person per company; and since 3.0.41
 * (migration 0200) each card's choice of period, months, horizon or window.
 *
 * `sb` is the person's own client for schema `onebook`
 * (`createSupabaseServerClientForSchema("onebook")`): row-level security keeps
 * the read to the person's own row, and the read also filters by the open
 * company explicitly. Writes go through `onebook.save_dashboard_preference`
 * and `onebook.save_dashboard_cards`, which take the person from the session,
 * never from the browser.
 */

export class DashboardPreferenceError extends Error {}

export interface DashboardPreference {
  /** Always a layout the Overview can draw: Standard when none is saved. */
  overview: OverviewLayout;
  /** False when the person has never saved a layout of their own. */
  overviewSaved: boolean;
  /** Account ids in the person's order; at most 10. */
  watchlist: string[];
  privacy: boolean;
  /** Each card's choice (3.0.41); the defaults for any the person has not made. */
  cards: CardChoices;
}

/** What a person who has saved nothing sees. */
export function defaultDashboardPreference(): DashboardPreference {
  return { overview: standardLayout(), overviewSaved: false, watchlist: [], privacy: false, cards: { ...DEFAULT_CARD_CHOICES } };
}

type PreferenceRow = { overview: unknown; watchlist: unknown; privacy: unknown; cards: unknown };

/** The person's choices in this company; the defaults when they have saved none. Throws when the read fails. */
export async function readDashboardPreference(sb: SupabaseClient, companyId: string): Promise<DashboardPreference> {
  const { data, error } = await sb
    .from("dashboard_preference")
    .select("overview, watchlist, privacy, cards")
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw new DashboardPreferenceError(error.message);
  const row = data as PreferenceRow | null;
  if (!row) return defaultDashboardPreference();
  return {
    overview: normalizeOverview(row.overview),
    overviewSaved: row.overview !== null && row.overview !== undefined,
    watchlist: Array.isArray(row.watchlist) ? row.watchlist.map(String) : [],
    privacy: row.privacy === true,
    cards: normalizeCardChoices(row.cards),
  };
}

export interface DashboardPreferenceChange {
  /** A layout to keep, or null to go back to the Standard layout. Left out: unchanged. */
  overview?: OverviewLayout | null;
  /** Left out: unchanged. */
  watchlist?: string[];
  /** Left out: unchanged. */
  privacy?: boolean;
}

/** Saves what changed; what is left out stays as it was. */
export async function saveDashboardPreference(
  sb: SupabaseClient,
  companyId: string,
  change: DashboardPreferenceChange,
): Promise<void> {
  const { error } = await sb.rpc("save_dashboard_preference", {
    p_company: companyId,
    p_overview: change.overview ?? null,
    p_reset_overview: change.overview === null,
    p_watchlist: change.watchlist ?? null,
    p_privacy: change.privacy ?? null,
  });
  if (error) throw new DashboardPreferenceError(error.message);
}

/**
 * Saves every card's choice at once (`onebook.save_dashboard_cards`, 0200);
 * the layout, the watchlist and Privacy stay as they are.
 */
export async function saveDashboardCards(sb: SupabaseClient, companyId: string, cards: CardChoices): Promise<void> {
  const { error } = await sb.rpc("save_dashboard_cards", { p_company: companyId, p_cards: cards });
  if (error) throw new DashboardPreferenceError(error.message);
}
