import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  redirect: vi.fn((url: string): never => {
    // Next's real redirect() throws; tests observe the refusal the same way.
    throw new Error(`redirected to ${url}`);
  }),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/db/server", () => ({ createSupabaseServerClient: mocks.createClient }));

import { settingsGateFor } from "@/lib/domain/navigation";
import { requireSettingsPermission } from "@/lib/db/settings-access";

describe("settingsGateFor", () => {
  it("finds the catalog entry behind a settings route", () => {
    expect(settingsGateFor("/settings/users").anyPermissions).toEqual(["users.manage"]);
  });

  it("throws for a route with no catalog entry, rather than opening it", () => {
    expect(() => settingsGateFor("/settings/nowhere")).toThrow(/no settings catalog entry/i);
  });
});

/** A signed-in admin holding exactly the given permission keys. */
function clientWith(grants: readonly string[]) {
  return {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "u1" } } })) },
    from: (table: string) => {
      if (table === "acc_app_user") {
        const chain = {
          select: () => chain,
          eq: () => chain,
          in: () => chain,
          maybeSingle: async () => ({ data: { role: "admin" }, error: null }),
        };
        return chain;
      }
      const permissions = {
        select: () => permissions,
        eq: async () => ({
          data: grants.map((key) => ({ role: "admin", permission_key: key })),
          error: null,
        }),
      };
      return permissions;
    },
  };
}

describe("requireSettingsPermission fails closed by construction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws on an empty permission list, before resolving who is asking", async () => {
    // canShowNavItem short-circuits on an empty anyPermissions list — no gate
    // at all — so an empty call here would refuse nobody at runtime, and only
    // a test's regex over page sources stood between that and production.
    // Production edit that makes this fail: removing the emptiness guard,
    // which lets this call resolve for the admin the mock signs in (and would
    // resolve just the same for anyone).
    mocks.createClient.mockResolvedValue(clientWith(["company.export"]));
    await expect(requireSettingsPermission([], "/settings/backups")).rejects.toThrow(
      /at least one permission/i,
    );
    // Thrown before any lookup: a misconfigured gate must not depend on the
    // database being reachable to fail.
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("lets a holder of the named permission through", async () => {
    // Guards against the opposite over-correction: a gate that throws for
    // every list, empty or not.
    mocks.createClient.mockResolvedValue(clientWith(["company.restore"]));
    await expect(
      requireSettingsPermission(["company.restore"], "/settings/backups"),
    ).resolves.toBeUndefined();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("redirects someone who lacks the named permission, carrying the denied href", async () => {
    // Production edit that makes this fail: dropping the redirect (or the
    // canShowNavItem call) so the refusal never happens.
    mocks.createClient.mockResolvedValue(clientWith(["some.other"]));
    await expect(
      requireSettingsPermission(["company.restore"], "/settings/backups"),
    ).rejects.toThrow(/redirected to \/settings\?denied=%2Fsettings%2Fbackups/);
  });
});
