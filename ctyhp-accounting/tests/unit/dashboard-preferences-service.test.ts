import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));

import { DEFAULT_CARD_CHOICES } from "@/lib/domain/dashboard-home/card-choices";
import { presetLayout, standardLayout } from "@/lib/domain/dashboard-home/layout";
import {
  DashboardPreferenceError,
  defaultDashboardPreference,
  readDashboardPreference,
  saveDashboardCards,
  saveDashboardPreference,
} from "@/lib/services/dashboard-preferences";

const COMPANY = "11111111-1111-4111-8111-111111111111";

interface Read {
  table: string;
  select: string;
  eq: [string, unknown][];
}

/** A client that answers the one read with `row` (or an error), and records every call. */
function fakeClient(answer: { row?: unknown; error?: string; rpcError?: string } = {}) {
  const reads: Read[] = [];
  const rpcs: [string, Record<string, unknown>][] = [];
  const from = (table: string) => {
    const read: Read = { table, select: "", eq: [] };
    reads.push(read);
    const builder: Record<string, unknown> = {};
    builder.select = (columns: string) => ((read.select = columns), builder);
    builder.eq = (column: string, value: unknown) => (read.eq.push([column, value]), builder);
    builder.maybeSingle = async () =>
      answer.error ? { data: null, error: { message: answer.error } } : { data: answer.row ?? null, error: null };
    return builder;
  };
  const rpc = async (name: string, args: Record<string, unknown>) => {
    rpcs.push([name, args]);
    return { data: null, error: answer.rpcError ? { message: answer.rpcError } : null };
  };
  return { sb: { from, rpc } as unknown as SupabaseClient, reads, rpcs };
}

describe("readDashboardPreference", () => {
  it("reads the person's row in the open company, and nothing else", async () => {
    const { sb, reads } = fakeClient();
    await readDashboardPreference(sb, COMPANY);
    expect(reads).toEqual([{ table: "dashboard_preference", select: "overview, watchlist, privacy, cards", eq: [["company_id", COMPANY]] }]);
  });

  it("gives the Standard layout, an empty watchlist, Privacy off and every card's default to someone who has saved nothing", async () => {
    const { sb } = fakeClient({ row: null });
    expect(await readDashboardPreference(sb, COMPANY)).toEqual({
      overview: standardLayout(),
      overviewSaved: false,
      watchlist: [],
      privacy: false,
      cards: DEFAULT_CARD_CHOICES,
    });
    expect(defaultDashboardPreference()).toEqual(await readDashboardPreference(sb, COMPANY));
  });

  it("reads back a saved layout, watchlist and Privacy", async () => {
    const owner = presetLayout("owner");
    const { sb } = fakeClient({ row: { overview: owner, watchlist: ["a-2", "a-1"], privacy: true, cards: {} } });
    expect(await readDashboardPreference(sb, COMPANY)).toEqual({
      overview: owner,
      overviewSaved: true,
      watchlist: ["a-2", "a-1"],
      privacy: true,
      cards: DEFAULT_CARD_CHOICES,
    });
  });

  it("keeps a row whose layout was reset: Standard, and not one of the person's own", async () => {
    const { sb } = fakeClient({ row: { overview: null, watchlist: [], privacy: false } });
    const read = await readDashboardPreference(sb, COMPANY);
    expect(read.overview).toEqual(standardLayout());
    expect(read.overviewSaved).toBe(false);
  });

  it("draws a layout saved before a card existed, with the new card at the end and hidden", async () => {
    const { sb } = fakeClient({ row: { overview: { order: ["pnl", "cash"], shown: ["pnl"], wide: [] }, watchlist: [], privacy: false } });
    const read = await readDashboardPreference(sb, COMPANY);
    expect(read.overview.order.slice(0, 2)).toEqual(["pnl", "cash"]);
    expect(read.overview.order).toHaveLength(14);
    expect(read.overview.shown).toEqual(["pnl"]);
  });

  it("reads back the card choices (3.0.41), dropping what no card offers and filling the defaults", async () => {
    const { sb } = fakeClient({
      row: { overview: null, watchlist: [], privacy: false, cards: { pnl: "last12", horizon: 90, billsDue: 30, cashMonths: 24, retired: "x" } },
    });
    expect((await readDashboardPreference(sb, COMPANY)).cards).toEqual({ ...DEFAULT_CARD_CHOICES, pnl: "last12", horizon: 90, billsDue: 30 });
  });

  it("gives every card its default for a row saved before the choices existed", async () => {
    const { sb } = fakeClient({ row: { overview: null, watchlist: [], privacy: true } });
    expect((await readDashboardPreference(sb, COMPANY)).cards).toEqual(DEFAULT_CARD_CHOICES);
  });

  it("throws when the read fails, so the page can say so", async () => {
    const { sb } = fakeClient({ error: "permission denied" });
    await expect(readDashboardPreference(sb, COMPANY)).rejects.toBeInstanceOf(DashboardPreferenceError);
  });
});

describe("saveDashboardPreference", () => {
  it("saves a layout and keeps everything else", async () => {
    const { sb, rpcs } = fakeClient();
    const layout = presetLayout("accountant");
    await saveDashboardPreference(sb, COMPANY, { overview: layout });
    expect(rpcs).toEqual([
      [
        "save_dashboard_preference",
        { p_company: COMPANY, p_overview: layout, p_reset_overview: false, p_watchlist: null, p_privacy: null },
      ],
    ]);
  });

  it("goes back to the Standard layout on null", async () => {
    const { sb, rpcs } = fakeClient();
    await saveDashboardPreference(sb, COMPANY, { overview: null });
    expect(rpcs[0][1]).toEqual({ p_company: COMPANY, p_overview: null, p_reset_overview: true, p_watchlist: null, p_privacy: null });
  });

  it("saves a watchlist, an empty one included", async () => {
    const { sb, rpcs } = fakeClient();
    await saveDashboardPreference(sb, COMPANY, { watchlist: ["a-1", "a-2"] });
    await saveDashboardPreference(sb, COMPANY, { watchlist: [] });
    expect(rpcs.map(([, args]) => args)).toEqual([
      { p_company: COMPANY, p_overview: null, p_reset_overview: false, p_watchlist: ["a-1", "a-2"], p_privacy: null },
      { p_company: COMPANY, p_overview: null, p_reset_overview: false, p_watchlist: [], p_privacy: null },
    ]);
  });

  it("turns Privacy off as well as on", async () => {
    const { sb, rpcs } = fakeClient();
    await saveDashboardPreference(sb, COMPANY, { privacy: true });
    await saveDashboardPreference(sb, COMPANY, { privacy: false });
    expect(rpcs.map(([, args]) => args.p_privacy)).toEqual([true, false]);
    expect(rpcs.every(([, args]) => args.p_overview === null && args.p_reset_overview === false && args.p_watchlist === null)).toBe(true);
  });

  it("throws when the database refuses", async () => {
    const { sb } = fakeClient({ rpcError: "Not a member of this company" });
    await expect(saveDashboardPreference(sb, COMPANY, { privacy: true })).rejects.toBeInstanceOf(DashboardPreferenceError);
  });
});

describe("saveDashboardCards (3.0.41)", () => {
  it("saves every card's choice for the open company through its own function, and nothing else", async () => {
    const { sb, rpcs, reads } = fakeClient();
    const cards = { ...DEFAULT_CARD_CHOICES, sales: "last3" as const, horizon: 60 as const };
    await saveDashboardCards(sb, COMPANY, cards);
    expect(rpcs).toEqual([["save_dashboard_cards", { p_company: COMPANY, p_cards: cards }]]);
    expect(reads).toEqual([]);
  });

  it("throws when the database refuses", async () => {
    const { sb } = fakeClient({ rpcError: "Not a member of this company" });
    await expect(saveDashboardCards(sb, COMPANY, { ...DEFAULT_CARD_CHOICES })).rejects.toBeInstanceOf(DashboardPreferenceError);
  });
});
