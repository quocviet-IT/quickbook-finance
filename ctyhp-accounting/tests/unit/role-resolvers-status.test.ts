import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Two places in TypeScript answer "what role is this person", and the database
 * answers it a third time in `acc_current_role()` — which returns a role only
 * for status 'invited' or 'active', and which `acc_is_admin()`, `acc_is_staff()`
 * and every RLS policy are built on.
 *
 * When a TypeScript resolver forgets the status filter, a suspended user passes
 * the application guard and is then refused by the database. The write is safe;
 * the person sees a screen they should not have been shown and an error nobody
 * can explain. The product tells whoever suspended them that access was revoked
 * "immediately across the whole application".
 *
 * A source-level check because the alternative is a live Supabase session. It is
 * narrow on purpose: it pins the one clause that is easy to drop in a refactor.
 */
const RESOLVERS = [
  ["lib/auth.ts", "getUserRole"],
  ["lib/db/settings-access.ts", "currentAccess"],
] as const;

describe("every role resolver agrees with acc_current_role about status", () => {
  for (const [file, fn] of RESOLVERS) {
    it(`${fn} in ${file} reads acc_app_user filtered to invited or active`, () => {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      expect(source).toContain('.from("acc_app_user")');
      expect(source).toMatch(/\.in\(\s*"status"\s*,\s*\[\s*"invited"\s*,\s*"active"\s*\]\s*\)/);
    });
  }

  it("names the two resolvers this rule covers, so a third has to be added here", () => {
    // If you are reading this because you added a third resolver: the right move
    // is usually not to add it, but to call one of the two that already exist.
    expect(RESOLVERS).toHaveLength(2);
  });
});
