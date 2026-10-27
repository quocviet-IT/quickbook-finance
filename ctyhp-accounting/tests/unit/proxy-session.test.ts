import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The proxy runs before every request — each page, each navigation, each
 * prefetch and server action. It used to ask the auth server who was signed in
 * (`getUser`), a network call on the critical path of everything, and one that
 * took seconds when Auth was slow. This project signs its tokens with ES256, so
 * `getClaims` verifies the signature locally against the published key set
 * (cached for ten minutes) and still refreshes an expired session first.
 *
 * Who the user really is, for data, is still settled by the layout (one
 * `getUser` per render) and by RLS reading the same token; the proxy only
 * routes and refreshes. The one exception is /login (2.67): there it asks, so a
 * session revoked elsewhere is cleared instead of looping to the dashboard.
 */
const mocks = vi.hoisted(() => ({
  getClaims: vi.fn(),
  getUser: vi.fn(),
  signOut: vi.fn(),
  refresh: null as null | {
    cookies: { name: string; value: string; options: Record<string, unknown> }[];
    headers: Record<string, string>;
  },
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    options: {
      cookies: {
        setAll: (
          cookies: { name: string; value: string; options: Record<string, unknown> }[],
          headers: Record<string, string>,
        ) => void;
      };
    },
  ) => ({
    auth: {
      getClaims: async () => {
        // A session refresh happens inside the call, before it answers.
        if (mocks.refresh) options.cookies.setAll(mocks.refresh.cookies, mocks.refresh.headers);
        return mocks.getClaims();
      },
      getUser: mocks.getUser,
      signOut: mocks.signOut,
    },
  }),
}));

import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

const request = (path: string) => new NextRequest(new URL(`http://localhost:3000${path}`));
const signedIn = { data: { claims: { sub: "u1", email: "someone@example.com" } }, error: null };
const signedOut = { data: null, error: { message: "Auth session missing!" } };

describe("the proxy routes on verified claims, asking the auth server only on /login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.refresh = null;
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    mocks.signOut.mockResolvedValue({ error: null });
  });

  it("lets a signed-in request through, and never calls getUser", async () => {
    mocks.getClaims.mockResolvedValue(signedIn);
    const response = await proxy(request("/invoices"));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("location")).toBeNull();
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("sends a request with no verified claims to /login", async () => {
    mocks.getClaims.mockResolvedValue(signedOut);
    const response = await proxy(request("/invoices"));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/login");
  });

  it("keeps a signed-in visitor off /login, once the auth server confirms the session", async () => {
    mocks.getClaims.mockResolvedValue(signedIn);
    const response = await proxy(request("/login"));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/dashboard");
    expect(mocks.getUser).toHaveBeenCalledTimes(1);
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it("shows /login, clearing its cookies, for a session revoked elsewhere that still verifies locally", async () => {
    // 27 October 2026: bounced to /dashboard, whose layout sent it back, it
    // looped until the browser gave up.
    mocks.getClaims.mockResolvedValue(signedIn);
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: "Session from session_id claim in JWT does not exist" } });
    const response = await proxy(request("/login"));
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("lets a signed-in visitor stay on /login for the code step", async () => {
    mocks.getClaims.mockResolvedValue(signedIn);
    const response = await proxy(request("/login?step=code"));
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("puts the library's no-store headers on a response that sets refreshed auth cookies", async () => {
    // @supabase/ssr hands these over with the cookies; a cached response that
    // carries a session cookie can be served to somebody else.
    mocks.refresh = {
      cookies: [{ name: "sb-test-auth-token", value: "fresh", options: { path: "/" } }],
      headers: {
        "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
        Expires: "0",
        Pragma: "no-cache",
      },
    };
    mocks.getClaims.mockResolvedValue(signedIn);
    const response = await proxy(request("/invoices"));
    expect(response.cookies.get("sb-test-auth-token")?.value).toBe("fresh");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("expires")).toBe("0");
  });
});
