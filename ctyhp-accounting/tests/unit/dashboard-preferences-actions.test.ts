import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * The Dashboard's three actions, with the database clients and the open
 * company faked: what each refuses before it reaches the database, and what
 * it asks the database to save.
 */
const state = vi.hoisted(() => ({
  user: { id: "u-1" } as { id: string } | null,
  active: { id: "c-1" } as { id: string } | null,
  chart: [] as string[],
  chartError: null as string | null,
  rpcError: null as string | null,
  rpcs: [] as [string, Record<string, unknown>][],
  chartReads: [] as unknown[][],
  schemas: [] as string[],
}));

vi.mock("@/lib/db/server", () => ({
  createSupabaseServerClientForSchema: async (schema: string) => {
    state.schemas.push(schema);
    return {
      auth: { getUser: async () => ({ data: { user: state.user } }) },
      rpc: async (name: string, args: Record<string, unknown>) => {
        state.rpcs.push([name, args]);
        return { data: null, error: state.rpcError ? { message: state.rpcError } : null };
      },
    };
  },
  createSupabaseServerClient: async () => ({
    from: (table: string) => ({
      select: () => ({
        in: async (column: string, ids: string[]) => {
          state.chartReads.push([table, column, ids]);
          if (state.chartError) return { data: null, error: { message: state.chartError } };
          return { data: state.chart.filter((id) => ids.includes(id)).map((id) => ({ id })), error: null };
        },
      }),
    }),
  }),
}));

vi.mock("@/lib/db/company", () => ({
  resolveActiveCompany: async () => ({ active: state.active, options: [] }),
}));

import { saveCardChoicesAction, saveOverviewLayoutAction, saveWatchlistAction, setPrivacyAction } from "@/app/(app)/dashboard/actions";
import { DEFAULT_CARD_CHOICES } from "@/lib/domain/dashboard-home/card-choices";
import { presetLayout, standardLayout, toggleShown } from "@/lib/domain/dashboard-home/layout";

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

beforeEach(() => {
  state.user = { id: "u-1" };
  state.active = { id: "c-1" };
  state.chart = [];
  state.chartError = null;
  state.rpcError = null;
  state.rpcs = [];
  state.chartReads = [];
  state.schemas = [];
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("saveOverviewLayoutAction", () => {
  it("saves a layout of the person's own for the open company, through the register's client", async () => {
    const owner = presetLayout("owner");
    expect(await saveOverviewLayoutAction(owner)).toEqual({ ok: true });
    expect(state.schemas).toEqual(["onebook"]);
    expect(state.rpcs).toEqual([
      ["save_dashboard_preference", { p_company: "c-1", p_overview: owner, p_reset_overview: false, p_watchlist: null, p_privacy: null }],
    ]);
  });

  it("saves the Standard layout as a reset, so the person follows Standard", async () => {
    expect(await saveOverviewLayoutAction(standardLayout())).toEqual({ ok: true });
    expect(state.rpcs[0][1]).toMatchObject({ p_overview: null, p_reset_overview: true });
  });

  it("reads what arrives as a layout first: unknown cards are dropped before saving", async () => {
    const sent = { ...presetLayout("owner"), shown: ["cash", "forecast"] };
    await saveOverviewLayoutAction(sent);
    expect((state.rpcs[0][1].p_overview as { shown: string[] }).shown).toEqual(["cash"]);
  });

  it("refuses a layout with nothing shown, without saving", async () => {
    const none = { ...standardLayout(), shown: [] };
    expect(await saveOverviewLayoutAction(none)).toEqual({ ok: false, error: "Show at least one card." });
    expect(state.rpcs).toEqual([]);
  });

  it("refuses a signed-out person and one with no company open", async () => {
    state.user = null;
    expect(await saveOverviewLayoutAction(toggleShown(standardLayout(), "bank"))).toEqual({ ok: false, error: "Sign in to change your dashboard." });
    state.user = { id: "u-1" };
    state.active = null;
    expect(await saveOverviewLayoutAction(toggleShown(standardLayout(), "bank"))).toEqual({ ok: false, error: "Open a company to change your dashboard." });
    expect(state.rpcs).toEqual([]);
  });

  it("never throws: a database refusal comes back as a sentence, not its words", async () => {
    state.rpcError = "permission denied for function";
    const result = await saveOverviewLayoutAction(presetLayout("owner"));
    expect(result).toEqual({ ok: false, error: "Your dashboard could not be saved. Try again in a moment." });
  });
});

describe("saveWatchlistAction", () => {
  it("saves accounts of the open company's chart, in the person's order", async () => {
    state.chart = [ID(1), ID(2), ID(3)];
    expect(await saveWatchlistAction([ID(3), ID(1)])).toEqual({ ok: true });
    expect(state.chartReads).toEqual([["acc_account", "id", [ID(3), ID(1)]]]);
    expect(state.rpcs[0][1]).toEqual({ p_company: "c-1", p_overview: null, p_reset_overview: false, p_watchlist: [ID(3), ID(1)], p_privacy: null });
  });

  it("saves an empty watchlist without reading the chart", async () => {
    expect(await saveWatchlistAction([])).toEqual({ ok: true });
    expect(state.chartReads).toEqual([]);
    expect(state.rpcs[0][1].p_watchlist).toEqual([]);
  });

  it("refuses anything but a list of ids, more than ten, and a repeat", async () => {
    for (const bad of [null, "x", [1], ["not-an-id"], [ID(1), 5]]) {
      expect(await saveWatchlistAction(bad)).toEqual({ ok: false, error: "Choose accounts from the list." });
    }
    expect(await saveWatchlistAction(Array.from({ length: 11 }, (_, i) => ID(i + 1)))).toEqual({ ok: false, error: "Choose up to 10 accounts." });
    expect(await saveWatchlistAction([ID(1), ID(1).toUpperCase()])).toEqual({ ok: false, error: "Choose each account once." });
    expect(state.rpcs).toEqual([]);
  });

  it("refuses an account that is not in the open company's chart", async () => {
    state.chart = [ID(1)];
    expect(await saveWatchlistAction([ID(1), ID(9)])).toEqual({
      ok: false,
      error: "An account you chose is no longer in the chart of accounts.",
    });
    expect(state.rpcs).toEqual([]);
  });

  it("does not save when the chart cannot be read", async () => {
    state.chartError = "statement timeout";
    expect(await saveWatchlistAction([ID(1)])).toEqual({ ok: false, error: "Your dashboard could not be saved. Try again in a moment." });
    expect(state.rpcs).toEqual([]);
  });
});

describe("setPrivacyAction", () => {
  it("saves on and off, and only that", async () => {
    expect(await setPrivacyAction(true)).toEqual({ ok: true });
    expect(await setPrivacyAction(false)).toEqual({ ok: true });
    expect(state.rpcs.map(([, args]) => args)).toEqual([
      { p_company: "c-1", p_overview: null, p_reset_overview: false, p_watchlist: null, p_privacy: true },
      { p_company: "c-1", p_overview: null, p_reset_overview: false, p_watchlist: null, p_privacy: false },
    ]);
  });

  it("refuses anything but a boolean", async () => {
    for (const bad of ["true", 1, null, undefined]) expect((await setPrivacyAction(bad)).ok).toBe(false);
    expect(state.rpcs).toEqual([]);
  });
});

describe("saveCardChoicesAction (3.0.41)", () => {
  it("saves every card's choice for the open company, through the register's client and its own function", async () => {
    const choices = { ...DEFAULT_CARD_CHOICES, pnl: "last12", cashMonths: 12, horizon: 90, billsDue: 30 };
    expect(await saveCardChoicesAction(choices)).toEqual({ ok: true });
    expect(state.schemas).toEqual(["onebook"]);
    expect(state.rpcs).toEqual([["save_dashboard_cards", { p_company: "c-1", p_cards: choices }]]);
  });

  it("reads what arrives as choices first: what no card offers is dropped and the defaults fill the rest", async () => {
    await saveCardChoicesAction({ sales: "last3", horizon: 45, cashMonths: "12", user_id: "u-2", company: "c-9" });
    expect(state.rpcs[0][1]).toEqual({ p_company: "c-1", p_cards: { ...DEFAULT_CARD_CHOICES, sales: "last3" } });
    await saveCardChoicesAction("last12");
    expect(state.rpcs[1][1]).toEqual({ p_company: "c-1", p_cards: DEFAULT_CARD_CHOICES });
  });

  it("refuses a signed-out person and one with no company open, without saving", async () => {
    state.user = null;
    expect(await saveCardChoicesAction(DEFAULT_CARD_CHOICES)).toEqual({ ok: false, error: "Sign in to change your dashboard." });
    state.user = { id: "u-1" };
    state.active = null;
    expect(await saveCardChoicesAction(DEFAULT_CARD_CHOICES)).toEqual({ ok: false, error: "Open a company to change your dashboard." });
    expect(state.rpcs).toEqual([]);
  });

  it("never throws: a database refusal comes back as a sentence, not its words", async () => {
    state.rpcError = "function onebook.save_dashboard_cards does not exist";
    expect(await saveCardChoicesAction(DEFAULT_CARD_CHOICES)).toEqual({ ok: false, error: "Your dashboard could not be saved. Try again in a moment." });
  });
});
