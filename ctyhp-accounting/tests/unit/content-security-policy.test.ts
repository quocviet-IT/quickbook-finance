import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, newNonce } from "@/lib/domain/content-security-policy";

const directives = (policy: string) =>
  Object.fromEntries(
    policy.split(";").map((part) => {
      const [name, ...sources] = part.trim().split(/\s+/);
      return [name, sources];
    }),
  ) as Record<string, string[]>;

const production = directives(
  contentSecurityPolicy({ nonce: "abc123", supabaseUrl: "https://example.supabase.co", development: false }),
);

describe("contentSecurityPolicy", () => {
  it("runs a script only with this response's nonce, or when one that had it started it", () => {
    expect(production["script-src"]).toContain("'nonce-abc123'");
    expect(production["script-src"]).toContain("'strict-dynamic'");
    expect(production["script-src"]).not.toContain("'unsafe-inline'");
    expect(production["script-src"]).not.toContain("'unsafe-eval'");
  });

  it("lets Plaid Link load, frame and call home", () => {
    expect(production["script-src"]).toContain("https://cdn.plaid.com");
    expect(production["frame-src"]).toEqual(["https://cdn.plaid.com"]);
    expect(production["connect-src"]).toContain("https://*.plaid.com");
  });

  it("lets the browser reach this project's Supabase and nothing else of it", () => {
    expect(production["connect-src"]).toEqual(
      expect.arrayContaining(["'self'", "https://example.supabase.co", "wss://example.supabase.co"]),
    );
    const without = directives(contentSecurityPolicy({ nonce: "n", supabaseUrl: undefined, development: false }));
    expect(without["connect-src"].some((source) => source.includes("supabase"))).toBe(false);
  });

  it("is never framed and never posts a form elsewhere", () => {
    expect(production["frame-ancestors"]).toEqual(["'none'"]);
    expect(production["form-action"]).toEqual(["'self'"]);
    expect(production["object-src"]).toEqual(["'none'"]);
    expect(production["base-uri"]).toEqual(["'self'"]);
  });

  it("allows the images, styles and workers the screens use", () => {
    expect(production["img-src"]).toEqual(["'self'", "data:", "blob:"]);
    expect(production["style-src"]).toEqual(["'self'", "'unsafe-inline'"]);
    expect(production["worker-src"]).toEqual(["'self'", "blob:"]);
  });

  it("adds 'unsafe-eval' in development only", () => {
    const dev = directives(contentSecurityPolicy({ nonce: "n", supabaseUrl: undefined, development: true }));
    expect(dev["script-src"]).toContain("'unsafe-eval'");
  });
});

describe("newNonce", () => {
  it("is 128 random bits in base64, different every time", () => {
    const a = newNonce();
    const b = newNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(a).not.toBe(b);
  });
});
