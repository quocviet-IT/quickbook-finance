import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { qualityPaths } from "./config.mjs";
import { findingFingerprint, redactQualityValue } from "./model.mjs";

const VALID_MEASUREMENT_KINDS = new Set(["bundle", "performance", "cls", "query"]);

function normalizeMeasurements(measurements) {
  const candidates = Array.isArray(measurements)
    ? measurements
    : measurements && typeof measurements === "object"
      ? Object.values(measurements)
      : null;
  const valid = candidates?.every((metric) =>
    metric && typeof metric === "object" && !Array.isArray(metric)
      && typeof metric.key === "string" && metric.key.length > 0
      && typeof metric.kind === "string" && VALID_MEASUREMENT_KINDS.has(metric.kind)
      && typeof metric.value === "number" && Number.isFinite(metric.value),
  );
  if (!valid) {
    throw new Error("Cannot accept quality baseline: every measurement must have a valid key, kind, and finite scalar value");
  }
  return candidates
    .map(({ key, kind, value }) => ({ key, kind, value }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function numericBudgets(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object" || Array.isArray(value) || !Object.keys(value).length) {
    throw new Error("Cannot accept quality baseline: only numeric threshold budget leaves are allowed");
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, numericBudgets(item)]),
  );
}

export function acceptBaseline(resultsPath, baselinePath, env = process.env) {
  if (env.QUALITY_ACCEPT_BASELINE !== "ONEBOOK_REVIEWED_QUALITY_BASELINE") {
    throw new Error("Set QUALITY_ACCEPT_BASELINE=ONEBOOK_REVIEWED_QUALITY_BASELINE after reviewing summary.md");
  }

  let summary;
  try {
    summary = JSON.parse(readFileSync(resultsPath, "utf8"));
  } catch (error) {
    throw new Error(`Cannot accept malformed quality summary at ${resultsPath}: ${error.message}`);
  }
  const fingerprints = [...new Set((summary.findings ?? []).map((finding) => {
    if (Object.hasOwn(finding, "fingerprint") && typeof finding.fingerprint !== "string") {
      throw new Error("Cannot accept quality baseline: every explicit fingerprint must be a string");
    }
    return finding.fingerprint || findingFingerprint(finding);
  }))].sort();
  const budgets = numericBudgets(summary.budgets);
  const baseline = redactQualityValue({
    version: 1,
    fingerprints,
    measurements: normalizeMeasurements(summary.measurements),
    budgets,
  });
  mkdirSync(dirname(baselinePath), { recursive: true });
  const temporaryPath = `${baselinePath}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, baselinePath);
  return baseline;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  try {
    const paths = qualityPaths(process.cwd());
    acceptBaseline(
      resolve(process.argv[2] ?? `${paths.resultsDir}/summary.json`),
      resolve(process.argv[3] ?? paths.baselinePath),
    );
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
