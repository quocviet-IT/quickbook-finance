import { describe, expect, it } from "vitest";
import { buildPasswordSetupUrl } from "@/lib/auth-url";

describe("buildPasswordSetupUrl", () => {
  it("uses the current application origin and replaces its path", () => {
    expect(buildPasswordSetupUrl("https://ctyhp-accounting.vercel.app/settings/users?tab=all")).toBe(
      "https://ctyhp-accounting.vercel.app/auth/set-password",
    );
  });

  it("supports local development", () => {
    expect(buildPasswordSetupUrl("http://localhost:3000")).toBe(
      "http://localhost:3000/auth/set-password",
    );
  });

  it("rejects non-web protocols", () => {
    expect(() => buildPasswordSetupUrl("javascript:alert(1)")).toThrow(/HTTP or HTTPS/);
  });
});
