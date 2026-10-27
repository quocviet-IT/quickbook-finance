import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { skipsSession } from "@/lib/domain/public-routes";
import { sessionRedirect } from "@/lib/domain/two-step";

describe("paths that skip the session", () => {
  it("lets every route handler through", () => {
    for (const path of ["/api/health", "/api/recurring/run", "/api/bank-feeds/sync"]) {
      expect(skipsSession(path), path).toBe(true);
    }
  });

  it("lets the status page through, trailing slash or not", () => {
    expect(skipsSession("/status")).toBe(true);
    expect(skipsSession("/status/")).toBe(true);
    expect(skipsSession("/api/health/")).toBe(true);
    // Trimming the trailing slash must not narrow the route-handler prefix:
    // `/api/` trimmed is `/api`, which no longer carries it.
    expect(skipsSession("/api/")).toBe(true);
  });

  it("holds everything else to the session", () => {
    for (const path of ["/invoices", "/dashboard", "/settings/users", "/login", "/"]) {
      expect(skipsSession(path), path).toBe(false);
    }
  });

  it("does not let a path merely starting with the same letters through", () => {
    // /status-report is not the status page, and /apiary is not a route handler.
    for (const path of ["/status-report", "/statusboard", "/apiary"]) {
      expect(skipsSession(path), path).toBe(false);
    }
  });
});

describe("the proxy still bounces a signed-in visitor off /login alone", () => {
  it("does not share the public-path set with the redirect branch", () => {
    // The obvious edit is to collect /login and /status into one set and use it
    // in both branches. That breaks the page: the second branch sends a
    // signed-in visitor from /login to /dashboard, so a shared set would send
    // them off /status too — meaning every member of staff actually at work
    // could not open it.
    // Since 2.65 the branches live in sessionRedirect (lib/domain/two-step.ts).
    const rules = readFileSync(join(process.cwd(), "lib", "domain", "two-step.ts"), "utf8");
    expect(rules).toMatch(/onLogin\s*=\s*path === "\/login"/);
    expect(rules).not.toMatch(/skipsSession/);
    expect(sessionRedirect("/status", null, true)).toBeNull();
    expect(sessionRedirect("/login", null, true)).toBe("/dashboard");
  });

  it("actually calls skipsSession, rather than testing a predicate nothing uses", () => {
    // Without this, reverting the top of proxy() to its old inline
    // `startsWith("/api/")` check would leave every test in this file green —
    // skipsSession("/status") is still true on its own — while a signed-out
    // visitor hitting /status during an outage got redirected to /login, which
    // is the one thing this change exists to prevent.
    const source = readFileSync(join(process.cwd(), "proxy.ts"), "utf8");
    expect(source).toMatch(/skipsSession\(request\.nextUrl\.pathname\)/);
    expect(source).not.toMatch(/pathname\.startsWith\("\/api\/"\)/);
  });
});
