import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CORE_SCHEMA, load } from "js-yaml";
import { describe, expect, it } from "vitest";

type WorkflowStep = {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
};

type WorkflowJob = {
  "runs-on"?: string;
  "timeout-minutes"?: number;
  defaults?: { run?: { "working-directory"?: string } };
  env?: Record<string, string>;
  steps?: WorkflowStep[];
};

type Workflow = {
  on?: Record<string, unknown>;
  permissions?: Record<string, string>;
  jobs?: Record<string, WorkflowJob>;
};

const repositoryRoot = resolve(process.cwd(), "..");

function readWorkflow(name: string): Workflow | null {
  const path = resolve(repositoryRoot, ".github", "workflows", name);
  if (!existsSync(path)) return null;
  return load(readFileSync(path, "utf8"), { schema: CORE_SCHEMA }) as Workflow;
}

function stepByName(steps: WorkflowStep[], name: string): WorkflowStep {
  const step = steps.find((candidate) => candidate.name === name);
  expect(step, `workflow step ${name}`).toBeDefined();
  return step!;
}

function indexByName(steps: WorkflowStep[], name: string): number {
  const index = steps.findIndex((candidate) => candidate.name === name);
  expect(index, `workflow step ${name}`).toBeGreaterThanOrEqual(0);
  return index;
}

function structuralTokens(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(structuralTokens);
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, nested]) => [key, ...structuralTokens(nested)]);
  }
  return value == null ? [] : [String(value)];
}

function runNodeValidation(command: string, values: Record<string, string>) {
  const match = /^node -e "([\s\S]+)"$/.exec(command.trim());
  expect(match, "configuration validation must be an executable Node command").not.toBeNull();
  const env = { ...process.env };
  for (const name of [
    "QUALITY_BASE_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SMOKE_EMAIL",
    "SMOKE_PASSWORD",
  ]) {
    delete env[name];
  }
  Object.assign(env, values);
  return spawnSync(process.execPath, ["-e", match![1]], { encoding: "utf8", env });
}

describe("quality CI contracts", () => {
  it("runs bundle reporting immediately after a successful build and always publishes its artifact", () => {
    const workflow = readWorkflow("ci.yml");
    expect(workflow, "the existing CI workflow must remain parseable").not.toBeNull();

    expect(workflow!.on).toEqual({
      pull_request: { branches: ["main"] },
      push: { branches: ["main"] },
    });
    expect(workflow!.permissions).toEqual({ contents: "read" });

    const job = workflow!.jobs?.gates;
    expect(job, "the CI gates job must remain present").toBeDefined();
    const steps = job!.steps ?? [];
    const buildIndex = indexByName(steps, "Build");
    const bundleIndex = indexByName(steps, "Bundle quality report");
    const uploadIndex = indexByName(steps, "Upload quality report");

    expect(bundleIndex).toBe(buildIndex + 1);
    expect(uploadIndex).toBe(bundleIndex + 1);
    expect(steps[bundleIndex]).toEqual({
      name: "Bundle quality report",
      run: "npm run quality:bundle",
      env: { QUALITY_MODE: "report" },
    });
    expect(steps[uploadIndex]).toEqual({
      name: "Upload quality report",
      if: "always()",
      uses: "actions/upload-artifact@v4",
      with: {
        name: "quality-bundle-${{ github.sha }}",
        path: "ctyhp-accounting/.quality-results",
        "if-no-files-found": "error",
        "retention-days": 14,
      },
    });

    expect(structuralTokens(workflow).join("\n")).not.toMatch(/\$\{\{\s*secrets\./);
  });

  it("runs the authenticated audit only in a secret-minimal manual or weekly report workflow", () => {
    const workflow = readWorkflow("quality-runtime.yml");
    expect(workflow, "the runtime quality workflow must exist and parse as YAML").not.toBeNull();

    expect(workflow!.on).toEqual({
      workflow_dispatch: null,
      schedule: [{ cron: "17 3 * * 1" }],
    });
    expect(workflow!.permissions).toEqual({ contents: "read" });

    const job = workflow!.jobs?.["runtime-quality"];
    expect(job, "the runtime-quality job must remain present").toBeDefined();
    expect(job).toMatchObject({
      "runs-on": "ubuntu-latest",
      "timeout-minutes": 30,
      defaults: { run: { "working-directory": "ctyhp-accounting" } },
      env: { QUALITY_MODE: "report" },
    });
    expect(Object.keys(job!.env ?? {})).toEqual(["QUALITY_MODE"]);

    const steps = job!.steps ?? [];
    expect(steps.slice(0, 4)).toEqual([
      { uses: "actions/checkout@v4" },
      {
        uses: "actions/setup-node@v4",
        with: {
          "node-version": 22,
          cache: "npm",
          "cache-dependency-path": "ctyhp-accounting/package-lock.json",
        },
      },
      { name: "Install dependencies", run: "npm ci" },
      { name: "Install Playwright Chromium", run: "npx playwright install --with-deps chromium" },
    ]);

    const validateIndex = indexByName(steps, "Validate runtime configuration");
    const selfTestIndex = indexByName(steps, "Prove the read-only browser guard");
    const runtimeIndex = indexByName(steps, "Run runtime quality report");
    const uploadIndex = indexByName(steps, "Upload runtime quality report");
    expect(selfTestIndex).toBe(validateIndex + 1);
    expect(runtimeIndex).toBe(selfTestIndex + 1);
    expect(uploadIndex).toBe(runtimeIndex + 1);
    const requiredRuntimeEnv = {
      QUALITY_BASE_URL: "${{ vars.QUALITY_BASE_URL }}",
      NEXT_PUBLIC_SUPABASE_URL: "${{ vars.NEXT_PUBLIC_SUPABASE_URL }}",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "${{ secrets.NEXT_PUBLIC_SUPABASE_ANON_KEY }}",
      SMOKE_EMAIL: "${{ secrets.SMOKE_EMAIL }}",
      SMOKE_PASSWORD: "${{ secrets.SMOKE_PASSWORD }}",
    };
    expect(steps[validateIndex].env).toEqual(requiredRuntimeEnv);
    expect(steps[selfTestIndex].run).toBe("node scripts/quality/self-test-runtime.mjs");
    expect(steps[runtimeIndex].run).toBe("npm run quality:runtime");
    expect(steps[runtimeIndex].env).toEqual({
      ...requiredRuntimeEnv,
      QUALITY_DATABASE_URL: "${{ secrets.QUALITY_DATABASE_URL }}",
    });
    expect(steps[uploadIndex]).toEqual({
      name: "Upload runtime quality report",
      if: "always()",
      uses: "actions/upload-artifact@v4",
      with: {
        name: "quality-runtime-${{ github.sha }}",
        path: "ctyhp-accounting/.quality-results",
        "if-no-files-found": "warn",
        "retention-days": 14,
      },
    });

    const serializedStructure = structuralTokens(workflow).join("\n");
    for (const forbidden of [
      "SUPABASE_SERVICE_ROLE_KEY",
      "E2E_DATABASE_URL",
      "E2E_SUPABASE_URL",
      "E2E_SUPABASE_ANON_KEY",
      "E2E_SUPABASE_SERVICE_ROLE_KEY",
      "E2E_EMAIL",
      "E2E_PASSWORD",
      "E2E_SECONDARY_EMAIL",
      "E2E_SECONDARY_PASSWORD",
      "QUALITY_ACCEPT_BASELINE",
      "SUPABASE_DB_URL",
    ]) {
      expect(serializedStructure, `${forbidden} must not be referenced`).not.toContain(forbidden);
    }
  });

  it("fails closed on missing runtime configuration without printing configured values", () => {
    const workflow = readWorkflow("quality-runtime.yml");
    expect(workflow, "the runtime quality workflow must exist and parse as YAML").not.toBeNull();
    const steps = workflow!.jobs?.["runtime-quality"]?.steps ?? [];
    const validation = stepByName(steps, "Validate runtime configuration");
    expect(validation.run).toBeTypeOf("string");

    const configured = {
      QUALITY_BASE_URL: "https://quality-base.invalid",
      NEXT_PUBLIC_SUPABASE_URL: "https://supabase-url.invalid",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "sentinel-anon-key",
      SMOKE_EMAIL: "quality-user@example.invalid",
      SMOKE_PASSWORD: "sentinel-smoke-password",
    };
    const accepted = runNodeValidation(validation.run!, configured);
    expect(accepted.status, accepted.stderr).toBe(0);
    expect(accepted.stdout).toBe("");
    expect(accepted.stderr).toBe("");

    const { SMOKE_PASSWORD: omittedPassword, ...missingPassword } = configured;
    const rejected = runNodeValidation(validation.run!, missingPassword);
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain("SMOKE_PASSWORD");
    for (const value of Object.values(missingPassword)) {
      expect(rejected.stderr).not.toContain(value);
    }
    expect(rejected.stderr).not.toContain(omittedPassword);
  });
});
