import { describe, expect, it } from "vitest";
import {
  HEALTH_CHECKS,
  buildPayload,
  checkConfiguration,
  httpStatusFor,
  isPlaceholder,
  overallStatus,
  type CheckResult,
} from "@/lib/domain/health";

const allOk: CheckResult[] = HEALTH_CHECKS.map((name) => ({ name, status: "ok" as const }));

describe("overall status", () => {
  it("is ok only when every check passes", () => {
    expect(overallStatus(allOk)).toBe("ok");
  });

  it("is down when any one check fails, wherever it sits", () => {
    // Looped rather than written once: a verdict that only notices the first
    // failure passes a single-case test and reports an outage as healthy.
    for (const failing of HEALTH_CHECKS) {
      const results = allOk.map((r) => (r.name === failing ? { ...r, status: "fail" as const } : r));
      expect(overallStatus(results), failing).toBe("down");
    }
  });

  it("is down when there are no results at all", () => {
    // An empty list means the probes never ran. "Everything passed" is the one
    // reading that must not be available here.
    expect(overallStatus([])).toBe("down");
  });
});

describe("http status", () => {
  it("answers 200 when up and 503 when down", () => {
    expect(httpStatusFor("ok")).toBe(200);
    expect(httpStatusFor("down")).toBe(503);
  });
});

describe("the payload", () => {
  it("carries exactly the permitted keys and nothing else", () => {
    // This is the guard that keeps "minimal detail" true. Someone adding
    // `error: e.message` later would leak internals to an unauthenticated
    // caller, and this fails before that reaches production.
    const payload = buildPayload(allOk, "2026-08-11T15:00:00.000Z");
    expect(Object.keys(payload).sort()).toEqual(["checkedAt", "checks", "status"]);
    for (const check of payload.checks) {
      expect(Object.keys(check).sort()).toEqual(["name", "status"]);
    }
  });

  it("reports the time it was checked", () => {
    expect(buildPayload(allOk, "2026-08-11T15:00:00.000Z").checkedAt).toBe(
      "2026-08-11T15:00:00.000Z",
    );
  });
});

describe("the placeholder rule", () => {
  it("rejects an empty value, the shipped example wording, and REPLACE", () => {
    for (const value of [
      undefined,
      "",
      "   ",
      "https://YOUR-PROJECT-REF.supabase.co",
      "your-anon-key",
      "REPLACE-with-a-real-key",
    ]) {
      expect(isPlaceholder(value), String(value)).toBe(true);
    }
  });

  it("accepts a value that looks configured", () => {
    expect(isPlaceholder("https://abcdefg.supabase.co")).toBe(false);
  });
});

describe("the configuration check", () => {
  it("passes when both values are set and the URL parses", () => {
    expect(
      checkConfiguration({ url: "https://abcdefg.supabase.co", anonKey: "a-real-looking-key" }),
    ).toEqual({ name: "configuration", status: "ok" });
  });

  it("fails when either value is missing or still a placeholder", () => {
    expect(checkConfiguration({ url: "https://abcdefg.supabase.co" }).status).toBe("fail");
    expect(checkConfiguration({ anonKey: "a-real-looking-key" }).status).toBe("fail");
    expect(
      checkConfiguration({ url: "https://YOUR-PROJECT-REF.supabase.co", anonKey: "k" }).status,
    ).toBe("fail");
  });

  it("fails when the URL is set but malformed", () => {
    // A malformed URL breaks every probe with an error that reads exactly like
    // an outage. Naming it here turns a confusing hour into a glance.
    expect(checkConfiguration({ url: "not a url", anonKey: "a-real-looking-key" }).status).toBe(
      "fail",
    );
  });
});
