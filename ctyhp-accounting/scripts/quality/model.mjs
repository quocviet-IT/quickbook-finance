import { createHash } from "node:crypto";

const HTML = /<\/?[a-z][^>]*>/i;

function isSensitiveKey(key) {
  const normalized = key.replaceAll(/[-_]/g, "").toLowerCase();
  const sensitiveFragments = [
    "password", "passwd", "secret", "token", "apikey", "authorization", "credential", "cookie",
    "databaseurl",
  ];
  return sensitiveFragments.some((fragment) => normalized.includes(fragment))
    || normalized.startsWith("auth")
    || normalized.startsWith("customer")
    || normalized === "html"
    || normalized === "payload";
}

export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function findingFingerprint(finding) {
  return [finding.kind, finding.rule, finding.route, finding.viewport, finding.target]
    .map((value) => value ?? "")
    .join("|");
}

function redactString(value) {
  if (HTML.test(value)) return "[redacted-content]";

  return value
    .replace(/(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis(?:s)?|mssql|sqlserver):\/\/[^\s)]+/gi, "[redacted-url]")
    .replace(/https?:\/\/[^\s)]+/gi, (rawUrl) => {
      try {
        const parsed = new URL(rawUrl);
        return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
      } catch {
        return "[redacted-url]";
      }
    })
    .replace(/(\/[^?\s)]*)\?[^\s)]*/g, "$1")
    .replace(/(authorization|cookie)\s*[:=]\s*[^,\r\n]+/gi, "$1=[redacted]")
    .replace(/(password|passwd|secret|token|access[-_]?token|refresh[-_]?token|api[-_]?key)\s*[:=]\s*[^&,;\s]+/gi, "$1=[redacted]")
    .replace(/\b(Bearer|Basic)\s+[^,;\s]+/gi, "$1 [redacted]");
}

export function redactQualityValue(value, key = "") {
  if (Array.isArray(value)) return value.map((item) => redactQualityValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([itemKey, item]) => [
        itemKey,
        isSensitiveKey(itemKey)
          ? (typeof item === "string" && /url/i.test(itemKey)
              ? "[redacted-url]"
              : typeof item === "string" && HTML.test(item)
                ? "[redacted-content]"
                : "[redacted]")
          : redactQualityValue(item, itemKey),
      ]),
    );
  }
  if (typeof value !== "string") return value;
  if (isSensitiveKey(key)) return /url/i.test(key) ? "[redacted-url]" : "[redacted]";
  return redactString(value);
}

export function stableHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function compareAgainstBaseline(current, baseline, budgets) {
  const known = new Set(baseline?.fingerprints ?? []);
  const previous = new Map((baseline?.measurements ?? []).map((metric) => [metric.key, metric]));
  const measurementRegressions = (current.measurements ?? []).flatMap((metric) => {
    const prior = previous.get(metric.key);
    if (!prior || typeof metric.value !== "number" || metric.value <= prior.value) return [];
    const delta = metric.value - prior.value;
    const material = metric.kind === "query"
      || (metric.kind === "cls"
        ? delta > budgets.performance.clsAbsolute
        : delta > (metric.kind === "bundle" ? budgets.bundle.absoluteGzipBytes : budgets.performance.absoluteMs)
          && delta / prior.value > (metric.kind === "bundle" ? budgets.bundle.percent : budgets.performance.percent));
    return material
      ? [{ ...metric, previousValue: prior.value, delta, advisory: metric.kind === "query" }]
      : [];
  });

  return {
    newFindings: (current.findings ?? []).filter((finding) => !known.has(finding.fingerprint)),
    measurementRegressions,
  };
}

export function qualityExitCode({ mode, comparison, safetyFailures = [] }) {
  if (safetyFailures.length) return 1;
  const blockingMetrics = comparison.measurementRegressions.filter((item) => !item.advisory);
  return mode === "regression" && (comparison.newFindings.length || blockingMetrics.length) ? 1 : 0;
}
