import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  requireDestructiveE2eEnvironment,
  requireDestructiveE2eServiceRoleEnvironment,
} from "../../scripts/e2e-environment.mjs";

const isolatedEnvironment = {
  ALLOW_DESTRUCTIVE_E2E: "ONEBOOK_TEST_DATABASE_ONLY",
  E2E_DATABASE_URL: "postgresql://e2e_user:e2e_secret@test-db.example.com:5432/onebook_e2e",
  E2E_SUPABASE_URL: "https://onebook-e2e.supabase.co/",
  E2E_SUPABASE_ANON_KEY: "e2e-anon-key",
  E2E_SUPABASE_SERVICE_ROLE_KEY: "e2e-service-role-key",
  E2E_EMAIL: "e2e-admin@example.com",
  E2E_PASSWORD: "e2e-admin-secret",
  E2E_SECONDARY_EMAIL: "e2e-clerk@example.com",
  E2E_SECONDARY_PASSWORD: "e2e-clerk-secret",
};

describe("requireDestructiveE2eEnvironment", () => {
  it("requires the exact destructive E2E opt-in", () => {
    expect(() =>
      requireDestructiveE2eEnvironment({
        ...isolatedEnvironment,
        ALLOW_DESTRUCTIVE_E2E: "true",
      }),
    ).toThrow("ALLOW_DESTRUCTIVE_E2E=ONEBOOK_TEST_DATABASE_ONLY");
  });

  it.each([
    "E2E_DATABASE_URL",
    "E2E_SUPABASE_URL",
    "E2E_SUPABASE_ANON_KEY",
    "E2E_EMAIL",
    "E2E_PASSWORD",
    "E2E_SECONDARY_EMAIL",
    "E2E_SECONDARY_PASSWORD",
  ])("requires %s without disclosing supplied secrets", (name) => {
    const environment = {
      ...isolatedEnvironment,
      E2E_PASSWORD: "must-never-appear-in-an-error",
      [name]: "   ",
    };

    try {
      requireDestructiveE2eEnvironment(environment);
      throw new Error("expected the guard to reject missing configuration");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(name);
      expect((error as Error).message).not.toContain("must-never-appear-in-an-error");
    }
  });

  it("rejects the ordinary application database target even when credentials differ", () => {
    expect(() =>
      requireDestructiveE2eEnvironment({
        ...isolatedEnvironment,
        SUPABASE_DB_URL:
          "postgresql://production_owner:production_secret@test-db.example.com:5432/onebook_e2e",
      }),
    ).toThrow("E2E_DATABASE_URL must not target SUPABASE_DB_URL");
  });

  it("rejects the ordinary application Supabase target after URL normalization", () => {
    expect(() =>
      requireDestructiveE2eEnvironment({
        ...isolatedEnvironment,
        NEXT_PUBLIC_SUPABASE_URL: "https://onebook-e2e.supabase.co",
      }),
    ).toThrow("E2E_SUPABASE_URL must not target NEXT_PUBLIC_SUPABASE_URL");
  });

  it("returns the seven trimmed isolated values", () => {
    expect(
      requireDestructiveE2eEnvironment({
        ...isolatedEnvironment,
        E2E_EMAIL: "  e2e-admin@example.com  ",
      }),
    ).toEqual({
      databaseUrl: isolatedEnvironment.E2E_DATABASE_URL,
      supabaseUrl: isolatedEnvironment.E2E_SUPABASE_URL,
      anonKey: isolatedEnvironment.E2E_SUPABASE_ANON_KEY,
      email: "e2e-admin@example.com",
      password: isolatedEnvironment.E2E_PASSWORD,
      secondaryEmail: isolatedEnvironment.E2E_SECONDARY_EMAIL,
      secondaryPassword: isolatedEnvironment.E2E_SECONDARY_PASSWORD,
    });
  });
});

describe("requireDestructiveE2eServiceRoleEnvironment", () => {
  it("requires a dedicated E2E service-role key", () => {
    expect(() =>
      requireDestructiveE2eServiceRoleEnvironment({
        ...isolatedEnvironment,
        E2E_SUPABASE_SERVICE_ROLE_KEY: "",
      }),
    ).toThrow("E2E_SUPABASE_SERVICE_ROLE_KEY");
  });

  it("returns the isolated target with its dedicated service-role key", () => {
    expect(
      requireDestructiveE2eServiceRoleEnvironment(isolatedEnvironment),
    ).toMatchObject({
      supabaseUrl: isolatedEnvironment.E2E_SUPABASE_URL,
      serviceRoleKey: isolatedEnvironment.E2E_SUPABASE_SERVICE_ROLE_KEY,
    });
  });
});

describe("destructive script startup", () => {
  it("refuses cleanup before attempting a database connection", () => {
    const script = fileURLToPath(
      new URL("../../scripts/cleanup-test-ledger.mjs", import.meta.url),
    );
    const environment = { ...process.env };
    delete environment.ALLOW_DESTRUCTIVE_E2E;
    delete environment.E2E_DATABASE_URL;
    environment.SUPABASE_DB_URL =
      "postgresql://ignored:ignored@127.0.0.1:1/onebook";

    const result = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      env: environment,
      timeout: 5_000,
    });
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).not.toBe(0);
    expect(output).toContain(
      "ALLOW_DESTRUCTIVE_E2E=ONEBOOK_TEST_DATABASE_ONLY",
    );
    expect(output).not.toContain("ECONNREFUSED");
  });
});
