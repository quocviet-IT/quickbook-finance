import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverStaticRoutes } from "../../scripts/quality/routes.mjs";
import {
  playwrightSessionCookies,
  sessionCookieHeader,
  sessionCookieParts,
} from "../../scripts/quality/session-cookie.mjs";

describe("quality route and session helpers", () => {
  it("discovers static pages and skips dynamic segments", () => {
    const root = mkdtempSync(join(tmpdir(), "onebook-routes-"));
    mkdirSync(join(root, "dashboard"), { recursive: true });
    mkdirSync(join(root, "invoices", "[id]"), { recursive: true });
    writeFileSync(join(root, "dashboard", "page.tsx"), "export default function Page(){}", "utf8");
    writeFileSync(join(root, "invoices", "[id]", "page.tsx"), "export default function Page(){}", "utf8");
    expect(discoverStaticRoutes(root)).toEqual(["/dashboard"]);
  });

  it("serializes the same chunked session for fetch and Playwright", () => {
    const input = {
      session: { access_token: "a".repeat(5000), refresh_token: "r", expires_at: 1, expires_in: 1, token_type: "bearer" },
      user: { id: "user-1", email: "admin@example.com" },
      supabaseUrl: "https://project.supabase.co",
      appBaseUrl: "http://localhost:3000",
    };
    const parts = sessionCookieParts(input);
    expect(parts.length).toBeGreaterThan(1);
    expect(sessionCookieHeader(input)).toContain(`${parts[0].name}=${parts[0].value}`);
    expect(playwrightSessionCookies(input)[0]).toMatchObject({ url: "http://localhost:3000" });
  });
});
