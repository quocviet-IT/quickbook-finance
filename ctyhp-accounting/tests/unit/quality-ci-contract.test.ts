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
  name?: string;
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

type SecretReference = {
  name: string;
  path: Array<string | number>;
};

const dynamicSecretReference = "<dynamic>";

type WorkflowExpression = {
  body: string;
  closed: boolean;
};

function workflowExpressions(value: string): WorkflowExpression[] {
  const expressions: WorkflowExpression[] = [];
  let cursor = 0;

  while (cursor < value.length) {
    const start = value.indexOf("${{", cursor);
    if (start === -1) break;

    let inSingleQuotedLiteral = false;
    let closed = false;
    for (let index = start + 3; index < value.length; index += 1) {
      if (value[index] === "'") {
        if (inSingleQuotedLiteral && value[index + 1] === "'") {
          index += 1;
        } else {
          inSingleQuotedLiteral = !inSingleQuotedLiteral;
        }
        continue;
      }
      if (!inSingleQuotedLiteral && value[index] === "}" && value[index + 1] === "}") {
        expressions.push({ body: value.slice(start + 3, index), closed: true });
        cursor = index + 2;
        closed = true;
        break;
      }
    }
    if (!closed) {
      expressions.push({ body: value.slice(start + 3), closed: false });
      break;
    }
  }

  return expressions;
}

function maskSingleQuotedLiterals(expression: string): string {
  const masked = [...expression];
  let inSingleQuotedLiteral = false;

  for (let index = 0; index < expression.length; index += 1) {
    if (expression[index] === "'") {
      masked[index] = " ";
      if (inSingleQuotedLiteral && expression[index + 1] === "'") {
        masked[index + 1] = " ";
        index += 1;
      } else {
        inSingleQuotedLiteral = !inSingleQuotedLiteral;
      }
    } else if (inSingleQuotedLiteral) {
      masked[index] = " ";
    }
  }

  return masked.join("");
}

function secretReferencesByPath(value: unknown): SecretReference[] {
  const references: SecretReference[] = [];

  function visit(candidate: unknown, path: Array<string | number>) {
    if (typeof candidate === "string") {
      for (const { body: expression, closed } of workflowExpressions(candidate)) {
        if (!closed && /\bsecrets\b/i.test(expression)) {
          references.push({ name: dynamicSecretReference, path });
          continue;
        }
        const searchableExpression = maskSingleQuotedLiterals(expression);
        const recognizedStarts = new Set<number>();
        for (const match of expression.matchAll(
          /\bsecrets\s*(?:\.\s*([A-Za-z_][A-Za-z0-9_]*)|\[\s*(["'])([A-Za-z_][A-Za-z0-9_]*)\2\s*\])/gi,
        )) {
          if (!/^secrets$/i.test(searchableExpression.slice(match.index, match.index + 7))) continue;
          references.push({ name: match[1] ?? match[3], path });
          recognizedStarts.add(match.index);
        }
        for (const match of searchableExpression.matchAll(/\bsecrets\b/gi)) {
          if (!recognizedStarts.has(match.index)) {
            references.push({ name: dynamicSecretReference, path });
          }
        }
      }
      return;
    }
    if (Array.isArray(candidate)) {
      candidate.forEach((item, index) => visit(item, [...path, index]));
      return;
    }
    if (candidate && typeof candidate === "object") {
      for (const [key, nested] of Object.entries(candidate)) {
        visit(key, [...path, `<key:${key}>`]);
        visit(nested, [...path, key]);
      }
    }
  }

  visit(value, []);
  return references;
}

function secretReferences(value: unknown): string[] {
  return [...new Set(secretReferencesByPath(value).map(({ name }) => name))].sort();
}

function formatReferencePath(path: Array<string | number>): string {
  return path.reduce<string>(
    (formatted, segment) =>
      typeof segment === "number" ? `${formatted}[${segment}]` : `${formatted ? `${formatted}.` : ""}${segment}`,
    "",
  );
}

function credentialPolicyViolations(workflow: Workflow): string[] {
  const allowedSecrets = new Set([
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "QUALITY_DATABASE_URL",
    "SMOKE_EMAIL",
    "SMOKE_PASSWORD",
  ]);
  const allowedSecretByPath = new Map<string, string>([
    ["jobs.runtime-quality.steps[4].env.NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"],
    ["jobs.runtime-quality.steps[4].env.SMOKE_EMAIL", "SMOKE_EMAIL"],
    ["jobs.runtime-quality.steps[4].env.SMOKE_PASSWORD", "SMOKE_PASSWORD"],
    ["jobs.runtime-quality.steps[6].env.NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"],
    ["jobs.runtime-quality.steps[6].env.QUALITY_DATABASE_URL", "QUALITY_DATABASE_URL"],
    ["jobs.runtime-quality.steps[6].env.SMOKE_EMAIL", "SMOKE_EMAIL"],
    ["jobs.runtime-quality.steps[6].env.SMOKE_PASSWORD", "SMOKE_PASSWORD"],
  ]);
  const references = secretReferencesByPath(workflow);
  const violations = [...new Set(references.map(({ name }) => name))]
    .filter((name) => name !== dynamicSecretReference && !allowedSecrets.has(name))
    .sort()
    .map((name) => `unexpected secret reference: ${name}`);

  for (const reference of references) {
    const path = formatReferencePath(reference.path);
    if (reference.name === dynamicSecretReference) {
      violations.push(`dynamic secret reference is forbidden at ${path}`);
      continue;
    }
    if (allowedSecretByPath.get(path) === reference.name) continue;

    const [root, jobName, scope, indexOrEnv, field, envName] = reference.path;
    if (root === "jobs" && scope === "env" && typeof indexOrEnv === "string") {
      violations.push(`credential env is forbidden at job scope: ${indexOrEnv} -> ${reference.name}`);
      continue;
    }
    if (
      root === "jobs" &&
      typeof jobName === "string" &&
      scope === "steps" &&
      typeof indexOrEnv === "number" &&
      field === "env" &&
      typeof envName === "string"
    ) {
      const step = workflow.jobs?.[jobName]?.steps?.[indexOrEnv];
      violations.push(`credential env is forbidden on step "${step?.name ?? "<unnamed>"}": ${envName}`);
      continue;
    }

    violations.push(`secret reference is forbidden at ${path}: ${reference.name}`);
  }

  return [...new Set(violations)];
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

  it("allows only the four runtime secrets and rejects credential env on every other step", () => {
    const workflow = readWorkflow("quality-runtime.yml");
    expect(workflow, "the runtime quality workflow must exist and parse as YAML").not.toBeNull();

    expect(secretReferences(workflow)).toEqual([
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "QUALITY_DATABASE_URL",
      "SMOKE_EMAIL",
      "SMOKE_PASSWORD",
    ]);
    expect(credentialPolicyViolations(workflow!)).toEqual([]);

    const maliciousWorkflow = structuredClone(workflow!);
    const selfTest = stepByName(
      maliciousWorkflow.jobs?.["runtime-quality"]?.steps ?? [],
      "Prove the read-only browser guard",
    );
    selfTest.env = { ARBITRARY_SECRET: "${{ secrets.ARBITRARY_SECRET }}" };

    expect(credentialPolicyViolations(maliciousWorkflow)).toEqual([
      "unexpected secret reference: ARBITRARY_SECRET",
      'credential env is forbidden on step "Prove the read-only browser guard": ARBITRARY_SECRET',
    ]);
  });

  it.each([
    {
      location: "the self-test run command",
      mutate(workflow: Workflow) {
        const selfTest = stepByName(
          workflow.jobs?.["runtime-quality"]?.steps ?? [],
          "Prove the read-only browser guard",
        );
        selfTest.run = 'echo "${{ secrets.SMOKE_PASSWORD }}"';
      },
      expectedPath: "jobs.runtime-quality.steps[5].run",
    },
    {
      location: "the artifact upload inputs",
      mutate(workflow: Workflow) {
        const upload = stepByName(
          workflow.jobs?.["runtime-quality"]?.steps ?? [],
          "Upload runtime quality report",
        );
        upload.with = { ...upload.with, password: "${{ secrets.SMOKE_PASSWORD }}" };
      },
      expectedPath: "jobs.runtime-quality.steps[7].with.password",
    },
    {
      location: "a job-level non-env field",
      mutate(workflow: Workflow) {
        const job = workflow.jobs?.["runtime-quality"];
        expect(job, "the runtime-quality job must remain present").toBeDefined();
        job!.name = "${{ secrets.SMOKE_PASSWORD }}";
      },
      expectedPath: "jobs.runtime-quality.name",
    },
  ])("rejects an allowlisted secret injected into $location", ({ mutate, expectedPath }) => {
    const workflow = readWorkflow("quality-runtime.yml");
    expect(workflow, "the runtime quality workflow must exist and parse as YAML").not.toBeNull();
    const maliciousWorkflow = structuredClone(workflow!);
    mutate(maliciousWorkflow);

    expect(credentialPolicyViolations(maliciousWorkflow)).toEqual([
      `secret reference is forbidden at ${expectedPath}: SMOKE_PASSWORD`,
    ]);
  });

  it.each([
    {
      syntax: "static bracket",
      expression: "${{ SeCrEtS [ 'SMOKE_PASSWORD' ] }}",
      expectedViolation:
        "secret reference is forbidden at jobs.runtime-quality.steps[5].run: SMOKE_PASSWORD",
    },
    {
      syntax: "dynamic bracket",
      expression: "${{ secrets [ matrix.secret_name ] }}",
      expectedViolation:
        "dynamic secret reference is forbidden at jobs.runtime-quality.steps[5].run",
    },
    {
      syntax: "allowlisted secret after a quoted expression terminator",
      expression: "${{ format('}}{0}', secrets.SMOKE_PASSWORD) }}",
      expectedViolation:
        "secret reference is forbidden at jobs.runtime-quality.steps[5].run: SMOKE_PASSWORD",
    },
    {
      syntax: "allowlisted secret after an escaped quote and quoted expression terminator",
      expression: "${{ format('it''s }} {0}', secrets.SMOKE_PASSWORD) }}",
      expectedViolation:
        "secret reference is forbidden at jobs.runtime-quality.steps[5].run: SMOKE_PASSWORD",
    },
  ])("rejects $syntax secret syntax instead of ignoring it", ({ expression, expectedViolation }) => {
    const workflow = readWorkflow("quality-runtime.yml");
    expect(workflow, "the runtime quality workflow must exist and parse as YAML").not.toBeNull();
    const maliciousWorkflow = structuredClone(workflow!);
    const selfTest = stepByName(
      maliciousWorkflow.jobs?.["runtime-quality"]?.steps ?? [],
      "Prove the read-only browser guard",
    );
    selfTest.run = `echo "${expression}"`;

    expect(credentialPolicyViolations(maliciousWorkflow)).toEqual([expectedViolation]);
  });

  it("ignores secret-like text inside a single-quoted expression literal", () => {
    const workflow = readWorkflow("quality-runtime.yml");
    expect(workflow, "the runtime quality workflow must exist and parse as YAML").not.toBeNull();
    const workflowWithLiteral = structuredClone(workflow!);
    const selfTest = stepByName(
      workflowWithLiteral.jobs?.["runtime-quality"]?.steps ?? [],
      "Prove the read-only browser guard",
    );
    selfTest.run = "echo \"${{ format('literal secrets.SMOKE_PASSWORD') }}\"";

    expect(credentialPolicyViolations(workflowWithLiteral)).toEqual([]);
  });

  it.each([
    {
      description: "is missing its closing delimiter",
      expression: "${{ secrets.SMOKE_PASSWORD",
    },
    {
      description: "has an unterminated single-quoted literal",
      expression: "${{ 'unterminated secrets.SMOKE_PASSWORD }}",
    },
  ])("fails closed when an expression $description", ({ expression }) => {
    const workflow = readWorkflow("quality-runtime.yml");
    expect(workflow, "the runtime quality workflow must exist and parse as YAML").not.toBeNull();
    const malformedWorkflow = structuredClone(workflow!);
    const selfTest = stepByName(
      malformedWorkflow.jobs?.["runtime-quality"]?.steps ?? [],
      "Prove the read-only browser guard",
    );
    selfTest.run = `echo "${expression}"`;

    expect(credentialPolicyViolations(malformedWorkflow)).toEqual([
      "dynamic secret reference is forbidden at jobs.runtime-quality.steps[5].run",
    ]);
  });

  const configuredRuntime = {
    QUALITY_BASE_URL: "https://quality-base.invalid",
    NEXT_PUBLIC_SUPABASE_URL: "https://supabase-url.invalid",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "sentinel-anon-key",
    SMOKE_EMAIL: "quality-user@example.invalid",
    SMOKE_PASSWORD: "sentinel-smoke-password",
  };
  const requiredRuntimeNames = Object.keys(configuredRuntime);

  it("accepts complete runtime configuration without printing configured values", () => {
    const workflow = readWorkflow("quality-runtime.yml");
    expect(workflow, "the runtime quality workflow must exist and parse as YAML").not.toBeNull();
    const steps = workflow!.jobs?.["runtime-quality"]?.steps ?? [];
    const validation = stepByName(steps, "Validate runtime configuration");
    expect(validation.run).toBeTypeOf("string");

    const accepted = runNodeValidation(validation.run!, configuredRuntime);
    expect(accepted.status, accepted.stderr).toBe(0);
    expect(accepted.stdout).toBe("");
    expect(accepted.stderr).toBe("");
  });

  it.each(requiredRuntimeNames)(
    "fails closed when %s is missing, naming only that variable and printing no values",
    (missingName) => {
      const workflow = readWorkflow("quality-runtime.yml");
      expect(workflow, "the runtime quality workflow must exist and parse as YAML").not.toBeNull();
      const steps = workflow!.jobs?.["runtime-quality"]?.steps ?? [];
      const validation = stepByName(steps, "Validate runtime configuration");
      expect(validation.run).toBeTypeOf("string");

      const missingConfiguration: Record<string, string> = { ...configuredRuntime };
      delete missingConfiguration[missingName];
      const rejected = runNodeValidation(validation.run!, missingConfiguration);

      expect(rejected.status).toBe(1);
      expect(rejected.stdout).toBe("");
      expect(rejected.stderr).toContain(missingName);
      for (const otherName of requiredRuntimeNames.filter((name) => name !== missingName)) {
        expect(rejected.stderr).not.toContain(otherName);
      }
      for (const value of Object.values(configuredRuntime)) {
        expect(rejected.stderr).not.toContain(value);
      }
    },
  );
});
