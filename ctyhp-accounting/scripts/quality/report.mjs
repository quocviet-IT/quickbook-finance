import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BUDGETS, qualityMode, qualityPaths } from "./config.mjs";
import { compareAgainstBaseline, findingFingerprint, qualityExitCode, redactQualityValue } from "./model.mjs";

function atomicWrite(path, contents) {
  const temporaryPath = `${path}.tmp`;
  writeFileSync(temporaryPath, contents, "utf8");
  renameSync(temporaryPath, path);
}

function markdownFromSummary(summary) {
  const lines = [
    "# Quality report",
    "",
    `- Mode: ${summary.mode ?? "report"}`,
    `- Findings: ${summary.findings?.length ?? 0}`,
    `- Measurements: ${Array.isArray(summary.measurements) ? summary.measurements.length : Object.keys(summary.measurements ?? {}).length}`,
    `- Unavailable: ${summary.unavailable?.length ?? 0}`,
    `- Safety failures: ${summary.safetyFailures?.length ?? 0}`,
    "",
    "## Sanitized result",
    "",
    "```json",
    JSON.stringify(summary, null, 2),
    "```",
    "",
  ];
  return lines.join("\n");
}

export function writeQualityReport(resultsDir, summary) {
  mkdirSync(resultsDir, { recursive: true });
  const sanitized = redactQualityValue(summary);
  atomicWrite(join(resultsDir, "summary.json"), `${JSON.stringify(sanitized, null, 2)}\n`);
  atomicWrite(join(resultsDir, "summary.md"), markdownFromSummary(sanitized));
  return sanitized;
}

function normalizeMeasurements(measurements) {
  if (Array.isArray(measurements)) return measurements;
  if (measurements && typeof measurements === "object") return Object.values(measurements);
  return [];
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Quality harness error: malformed ${label} at ${path}: ${error.message}`);
  }
}

function readBaseline(path) {
  if (!existsSync(path)) throw new Error(`Quality harness error: regression baseline is missing at ${path}`);
  const baseline = readJson(path, "regression baseline");
  if (!baseline || baseline.version !== 1 || !Array.isArray(baseline.fingerprints) || !Array.isArray(baseline.measurements)) {
    throw new Error(`Quality harness error: regression baseline is malformed at ${path}`);
  }
  return baseline;
}

export function aggregateQualityArtifacts(resultsDir, options = {}) {
  const mode = options.mode ?? qualityMode();
  if (!existsSync(resultsDir)) {
    throw new Error(`Quality harness error: no section artifacts found in ${resultsDir}`);
  }
  const files = readdirSync(resultsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && entry.name !== "summary.json")
    .map((entry) => entry.name)
    .sort();
  if (!files.length) throw new Error(`Quality harness error: no section artifacts found in ${resultsDir}`);

  const sections = files.map((name) => readJson(join(resultsDir, name), `section artifact ${name}`));
  const findings = sections.flatMap((section) => section.findings ?? []).map((finding) => ({
    ...finding,
    fingerprint: finding.fingerprint || findingFingerprint(finding),
  }));
  const measurements = sections.flatMap((section) => normalizeMeasurements(section.measurements));
  const unavailable = sections.flatMap((section) => section.unavailable ?? []);
  const safetyFailures = sections.flatMap((section) => section.safetyFailures ?? []);
  const summary = { version: 1, mode, findings, measurements, unavailable, safetyFailures, budgets: BUDGETS };

  if (mode === "regression") {
    const baseline = readBaseline(options.baselinePath);
    summary.comparison = compareAgainstBaseline(summary, baseline, BUDGETS);
  }

  return summary;
}

export function runReportCli(argv = process.argv.slice(2), env = process.env) {
  const paths = qualityPaths(process.cwd());
  const resultsDir = resolve(argv[0] ?? paths.resultsDir);
  const mode = qualityMode(env);
  const baselinePath = resolve(env.QUALITY_BASELINE_PATH ?? argv[1] ?? paths.baselinePath);
  const summary = aggregateQualityArtifacts(resultsDir, { mode, baselinePath });
  writeQualityReport(resultsDir, summary);
  const comparison = summary.comparison ?? { newFindings: [], measurementRegressions: [] };
  return qualityExitCode({ mode, comparison, safetyFailures: summary.safetyFailures });
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  try {
    process.exitCode = runReportCli();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
