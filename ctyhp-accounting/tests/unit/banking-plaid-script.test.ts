import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "app", "(app)", "banking", "BankingClient.tsx"),
  "utf8",
);

/**
 * Plaid's script is fetched from their CDN on every visit to /banking, and on
 * a system where Plaid is not configured nobody can use it: the Connect button
 * is disabled and openPlaidLink refuses before it touches window.Plaid.
 *
 * Loading it anyway costs a cross-origin request and its execution on a screen
 * that is already the heaviest in the app. This asserts the script is asked
 * for only when it can actually be used — which is the same condition the two
 * places that use it already check.
 */
describe("the Plaid script", () => {
  it("is only loaded when Plaid is configured", () => {
    const scriptAt = source.indexOf("cdn.plaid.com");
    expect(scriptAt).toBeGreaterThan(-1);
    // The 400 characters before the tag must contain the guard.
    const before = source.slice(Math.max(0, scriptAt - 400), scriptAt);
    expect(before).toMatch(/plaidConfigured\s*\?|plaidConfigured\s*&&/);
  });

  it("still resumes an OAuth return, which only happens once Plaid is configured", () => {
    expect(source).toContain("onReady={resumePlaidOAuth}");
    expect(source).toContain("oauth_state_id");
  });
});
