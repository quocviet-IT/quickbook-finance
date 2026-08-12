import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CACHE_TTL_MS,
  cachedHealth,
  probeHealth,
  type HealthDeps,
} from "@/lib/services/health";

const CONFIGURED = {
  url: "https://abcdefg.supabase.co",
  anonKey: "a-real-looking-key",
};

function deps(fetchImpl: HealthDeps["fetch"]): HealthDeps {
  return { ...CONFIGURED, fetch: fetchImpl, now: () => new Date("2026-08-11T15:00:00.000Z") };
}

function respond(status: number, body = ""): Response {
  return new Response(body, { status });
}

function statusOf(payload: Awaited<ReturnType<typeof probeHealth>>, name: string) {
  return payload.checks.find((check) => check.name === name)?.status;
}

describe("probing health", () => {
  it("is ok when the rpc returns ok and auth answers", async () => {
    const payload = await probeHealth(
      deps(async (input) =>
        String(input).includes("/rpc/health") ? respond(200, '"ok"') : respond(200),
      ),
    );
    expect(payload.status).toBe("ok");
    expect(payload.checkedAt).toBe("2026-08-11T15:00:00.000Z");
  });

  it("calls the rpc through the onebook schema, with the key on both headers", async () => {
    // PostgREST rejects the anon key on `apikey` alone, and the function lives
    // in onebook rather than public — both were measured against the live
    // project, and getting either wrong reports a permanent outage.
    const seen: Request[] = [];
    await probeHealth(
      deps(async (input, init) => {
        seen.push(new Request(String(input), init));
        return String(input).includes("/rpc/health") ? respond(200, '"ok"') : respond(200);
      }),
    );
    const rpc = seen.find((request) => request.url.includes("/rpc/health"));
    expect(rpc, "the rpc was never called").toBeDefined();
    expect(rpc!.headers.get("apikey")).toBe(CONFIGURED.anonKey);
    expect(rpc!.headers.get("authorization")).toBe(`Bearer ${CONFIGURED.anonKey}`);
    expect(rpc!.headers.get("content-profile")).toBe("onebook");
  });

  it("fails the database check when the rpc answers with anything else", async () => {
    const payload = await probeHealth(
      deps(async (input) =>
        String(input).includes("/rpc/health") ? respond(401, "{}") : respond(200),
      ),
    );
    expect(statusOf(payload, "database")).toBe("fail");
    expect(statusOf(payload, "authentication")).toBe("ok");
    expect(payload.status).toBe("down");
  });

  it("fails a check when its probe throws rather than answering", async () => {
    // A dead host rejects the fetch outright. That is an outage, not a crash of
    // the health check itself.
    const payload = await probeHealth(
      deps(async () => {
        throw new Error("connect ECONNREFUSED");
      }),
    );
    expect(statusOf(payload, "database")).toBe("fail");
    expect(statusOf(payload, "authentication")).toBe("fail");
    expect(payload.status).toBe("down");
  });

  it("reports configuration without reaching the network for it", async () => {
    const fetchImpl = vi.fn(async () => respond(200, '"ok"'));
    const payload = await probeHealth({
      url: "not a url",
      anonKey: "a-real-looking-key",
      fetch: fetchImpl,
      now: () => new Date("2026-08-11T15:00:00.000Z"),
    });
    expect(statusOf(payload, "configuration")).toBe("fail");
  });

  it("runs the two network probes at the same time", async () => {
    // Serialised probes double the worst case, and the worst case is what a
    // monitor's timeout is set against.
    let inFlight = 0;
    let peak = 0;
    await probeHealth(
      deps(async (input) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 10));
        inFlight -= 1;
        return String(input).includes("/rpc/health") ? respond(200, '"ok"') : respond(200);
      }),
    );
    expect(peak).toBe(2);
  });
});

describe("the cache", () => {
  const realFetch = globalThis.fetch;
  const realUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const realKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Each test starts far past anything a previous one left behind, so the order
  // the tests run in cannot decide whether the cache is warm.
  let clock = Date.parse("2026-08-11T15:00:00.000Z");
  let calls = 0;

  function stubFetch(impl: HealthDeps["fetch"]) {
    globalThis.fetch = (async (...args: Parameters<HealthDeps["fetch"]>) => {
      calls += 1;
      return impl(...args);
    }) as HealthDeps["fetch"];
  }

  beforeEach(() => {
    clock += CACHE_TTL_MS * 10;
    calls = 0;
    vi.useFakeTimers();
    vi.setSystemTime(clock);
    process.env.NEXT_PUBLIC_SUPABASE_URL = CONFIGURED.url;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = CONFIGURED.anonKey;
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = realFetch;
    process.env.NEXT_PUBLIC_SUPABASE_URL = realUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = realKey;
  });

  it("asks once and reuses the answer inside the window", async () => {
    stubFetch(async (input) =>
      String(input).includes("/rpc/health") ? respond(200, '"ok"') : respond(200),
    );
    const first = await cachedHealth();
    const second = await cachedHealth();

    // Two probes for the first call, none for the second.
    expect(calls).toBe(2);
    expect(second).toEqual(first);
  });

  it("asks again once the window has passed", async () => {
    stubFetch(async (input) =>
      String(input).includes("/rpc/health") ? respond(200, '"ok"') : respond(200),
    );
    await cachedHealth();
    vi.setSystemTime(clock + CACHE_TTL_MS + 1);
    await cachedHealth();
    expect(calls).toBe(4);
  });

  it("reuses a failure exactly as it reuses a success", async () => {
    // Caching only the good answer would let a flood arriving during an outage
    // bypass the cap entirely — the worst moment to remove it.
    stubFetch(async () => {
      throw new Error("connect ECONNREFUSED");
    });
    const first = await cachedHealth();
    const second = await cachedHealth();

    expect(first.status).toBe("down");
    expect(calls).toBe(2);
    expect(second).toEqual(first);
  });
});
