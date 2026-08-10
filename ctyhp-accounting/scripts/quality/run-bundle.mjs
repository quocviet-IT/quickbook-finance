import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeBundle } from "./bundle.mjs";
import { BUDGETS, qualityMode, qualityPaths } from "./config.mjs";
import { qualityExitCode } from "./model.mjs";
import { aggregateQualityArtifacts, writeQualityReport } from "./report.mjs";

function atomicWrite(path, value) {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
}

function measurementsFor(report) {
  return [
    ...report.routes.map((route) => ({
      key: `bundle.route.${route.route}.gzipBytes`, kind: "bundle", value: route.gzipBytes,
    })),
    ...report.chunks.map((chunk) => ({
      key: `bundle.chunk.${chunk.chunk}.gzipBytes`,
      kind: "bundle",
      value: chunk.gzipBytes,
      chunk: chunk.chunk,
      bytes: chunk.bytes,
      hash: chunk.hash,
      routes: chunk.routes,
    })),
    { key: "bundle.shared.gzipBytes", kind: "bundle", value: report.shared.gzipBytes },
    { key: "bundle.total.gzipBytes", kind: "bundle", value: report.total.gzipBytes },
  ];
}

export function runBundleCli(argv = process.argv.slice(2), env = process.env) {
  const paths = qualityPaths(process.cwd());
  const mode = qualityMode(env);
  const nextDir = resolve(argv[0] ?? paths.nextDir);
  const resultsDir = paths.resultsDir;
  const bundle = analyzeBundle(nextDir);
  const section = {
    version: 1,
    mode,
    findings: [],
    measurements: measurementsFor(bundle),
    unavailable: [],
    safetyFailures: [],
    budgets: BUDGETS.bundle,
    bundle,
  };
  mkdirSync(resultsDir, { recursive: true });
  atomicWrite(join(resultsDir, "bundle.json"), section);

  const baselinePath = resolve(env.QUALITY_BASELINE_PATH ?? argv[1] ?? paths.baselinePath);
  const summary = aggregateQualityArtifacts(resultsDir, { mode, baselinePath });
  writeQualityReport(resultsDir, summary);
  return qualityExitCode({
    mode,
    comparison: summary.comparison ?? { newFindings: [], measurementRegressions: [] },
    safetyFailures: summary.safetyFailures,
  });
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  try {
    process.exitCode = runBundleCli();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
