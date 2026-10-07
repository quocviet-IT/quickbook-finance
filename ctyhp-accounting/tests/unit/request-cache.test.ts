import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A signed-in page used to reach the database about seven times in a row before
 * the layout could draw anything, because every helper asked again: which
 * company (once per client created — 294 call sites), who is signed in (three
 * times), what role (three round trips per getUserRole call, 87 call sites).
 * None of those answers can change within one request, so each is memoised per
 * request with React's cache(), and the layout asks its independent questions
 * together.
 *
 * Source-level on purpose, like role-resolvers-status.test.ts: cache() only
 * memoises inside a server render, and dropping one wrapper puts a round trip
 * back on every page without failing anything else.
 */
const PER_REQUEST = [
  ["lib/db/company.ts", "resolveActiveCompany"],
  ["lib/db/company.ts", "isPlatformAdmin"],
  ["lib/db/company.ts", "currentUser"],
  ["lib/db/server.ts", "createSupabaseServerClient"],
  ["lib/db/settings-access.ts", "currentAccess"],
] as const;

const source = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

describe("answers that cannot change within a request are asked once", () => {
  it.each(PER_REQUEST)("%s memoises %s with cache()", (file, name) => {
    expect(source(file)).toMatch(new RegExp(`export const ${name} = cache\\(`));
  });

  it("the signed-in layout asks for the company, the user and admin rights together", () => {
    // Three independent questions; asked one after another they were three
    // round trips before the first byte of every page.
    expect(source("app/(app)/layout.tsx")).toMatch(
      /Promise\.all\(\[\s*resolveActiveCompany\(\),\s*currentUser\(\),\s*isPlatformAdmin\(\),?\s*\]\)/,
    );
  });
});

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  currentAccess: vi.fn(),
  currentUser: vi.fn(),
  createClient: vi.fn(),
}));
vi.mock("@/lib/db/settings-access", () => ({ currentAccess: mocks.currentAccess }));
vi.mock("@/lib/db/company", () => ({ currentUser: mocks.currentUser }));
vi.mock("@/lib/db/server", () => ({ createSupabaseServerClient: mocks.createClient }));

import { getSessionUser, getUserRole } from "@/lib/auth";

describe("getUserRole and getSessionUser reuse the request's answers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("takes the role currentAccess already resolved, without a query of its own", async () => {
    mocks.currentAccess.mockResolvedValue({ role: "accountant", permissionKeys: [] });
    await expect(getUserRole()).resolves.toBe("accountant");
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("answers no role when currentAccess has none (signed out, suspended, unregistered)", async () => {
    mocks.currentAccess.mockResolvedValue({ role: null, permissionKeys: [] });
    await expect(getUserRole()).resolves.toBeNull();
  });

  it("returns the request's signed-in user", async () => {
    const user = { id: "u1", email: "someone@example.com" };
    mocks.currentUser.mockResolvedValue(user);
    await expect(getSessionUser()).resolves.toBe(user);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});
