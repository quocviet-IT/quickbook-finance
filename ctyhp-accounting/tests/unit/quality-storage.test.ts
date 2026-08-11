import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runBundleCli } from "../../scripts/quality/run-bundle.mjs";
import { writeRuntimeArtifacts } from "../../scripts/quality/run-runtime.mjs";
import { writeQualityReport } from "../../scripts/quality/report.mjs";
import { atomicWriteOwnedFile } from "../../scripts/quality/artifact-storage.mjs";

const fixtureNextDir = resolve(dirname(fileURLToPath(import.meta.url)), "../quality/fixtures/bundle/.next");

function emptySection(extra: Record<string, unknown> = {}) {
  return { findings: [], measurements: [], unavailable: [], safetyFailures: [], ...extra };
}

function runtimeSections() {
  return {
    axe: emptySection({ runs: [] }),
    keyboard: emptySection({ scenarios: [] }),
    viewports: emptySection({ snapshots: [] }),
    performance: emptySection(),
    routes: emptySection({ routes: [] }),
    queries: emptySection(),
  };
}

function summary() {
  return {
    version: 1,
    mode: "report",
    sectionArtifacts: [],
    findings: [],
    measurements: [],
    unavailable: [],
    safetyFailures: [],
  };
}

describe("owned quality artifact storage", () => {
  it("atomically replaces an existing regular artifact on repeated Windows runs", () => {
    const root = mkdtempSync(join(tmpdir(), "quality-storage-repeat-"));
    const target = join(root, "section.json");

    atomicWriteOwnedFile(root, target, "first\n");
    atomicWriteOwnedFile(root, target, "second\n");

    expect(readFileSync(target, "utf8")).toBe("second\n");
    expect(readdirSync(root)).toEqual(["section.json"]);
  });

  it("rejects a linked bundle result root without writing outside it", () => {
    const root = mkdtempSync(join(tmpdir(), "quality-bundle-linked-results-"));
    const outside = join(root, "outside");
    const linkedResults = join(root, ".quality-results");
    mkdirSync(outside);
    writeFileSync(join(outside, "sentinel.txt"), "outside-sentinel", "utf8");
    cpSync(fixtureNextDir, join(root, ".next"), { recursive: true });
    symlinkSync(outside, linkedResults, "junction");
    const previousCwd = process.cwd();
    try {
      process.chdir(root);
      expect(() => runBundleCli([".next"], { NODE_ENV: "test" }))
        .toThrow(/result root|owned|link|reparse/i);
    } finally {
      process.chdir(previousCwd);
    }

    expect(readFileSync(join(outside, "sentinel.txt"), "utf8")).toBe("outside-sentinel");
    expect(existsSync(join(outside, "bundle.json"))).toBe(false);
    unlinkSync(linkedResults);
  });

  it("rejects a prepositioned bundle temporary reparse entry", () => {
    const root = mkdtempSync(join(tmpdir(), "quality-bundle-temp-link-"));
    const results = join(root, ".quality-results");
    const outside = join(root, "outside");
    const temporary = join(results, "injected-bundle.tmp");
    mkdirSync(results);
    mkdirSync(outside);
    writeFileSync(join(outside, "sentinel.txt"), "outside-sentinel", "utf8");
    cpSync(fixtureNextDir, join(root, ".next"), { recursive: true });
    symlinkSync(outside, temporary, "junction");
    const previousCwd = process.cwd();
    try {
      process.chdir(root);
      expect(() => runBundleCli([".next"], { NODE_ENV: "test" }, {
        temporaryPathFor: () => temporary,
      })).toThrow(/temporary|link|exclusive|artifact/i);
    } finally {
      process.chdir(previousCwd);
    }

    expect(readFileSync(join(outside, "sentinel.txt"), "utf8")).toBe("outside-sentinel");
    expect(existsSync(join(results, "bundle.json"))).toBe(false);
    expect(lstatSync(temporary).isSymbolicLink()).toBe(true);
    unlinkSync(temporary);
  });

  it("rejects a linked bundle target without touching outside content", () => {
    const root = mkdtempSync(join(tmpdir(), "quality-bundle-target-link-"));
    const results = join(root, ".quality-results");
    const outside = join(root, "outside");
    const target = join(results, "bundle.json");
    mkdirSync(results);
    mkdirSync(outside);
    writeFileSync(join(outside, "sentinel.txt"), "outside-sentinel", "utf8");
    cpSync(fixtureNextDir, join(root, ".next"), { recursive: true });
    symlinkSync(outside, target, "junction");
    const previousCwd = process.cwd();
    try {
      process.chdir(root);
      expect(() => runBundleCli([".next"], { NODE_ENV: "test" }))
        .toThrow(/target|artifact|link|reparse|directory/i);
    } finally {
      process.chdir(previousCwd);
    }

    expect(readFileSync(join(outside, "sentinel.txt"), "utf8")).toBe("outside-sentinel");
    expect(lstatSync(target).isSymbolicLink()).toBe(true);
    unlinkSync(target);
  });

  it("rejects a prepositioned runtime section temporary reparse entry", () => {
    const root = mkdtempSync(join(tmpdir(), "quality-section-temp-link-"));
    const outside = join(root, "outside");
    const temporary = join(root, "injected-section.tmp");
    mkdirSync(outside);
    writeFileSync(join(outside, "sentinel.txt"), "outside-sentinel", "utf8");
    symlinkSync(outside, temporary, "junction");

    expect(typeof writeRuntimeArtifacts).toBe("function");
    expect(() => writeRuntimeArtifacts(root, runtimeSections(), {
      temporaryPathFor: () => temporary,
    })).toThrow(/temporary|link|exclusive|reparse/i);
    expect(readFileSync(join(outside, "sentinel.txt"), "utf8")).toBe("outside-sentinel");
    expect(existsSync(join(root, "axe.json"))).toBe(false);
    expect(lstatSync(temporary).isSymbolicLink()).toBe(true);
    unlinkSync(temporary);
  });

  it("rejects a linked runtime section target without touching outside content", () => {
    const root = mkdtempSync(join(tmpdir(), "quality-section-target-link-"));
    const outside = join(root, "outside");
    const target = join(root, "axe.json");
    mkdirSync(outside);
    writeFileSync(join(outside, "sentinel.txt"), "outside-sentinel", "utf8");
    symlinkSync(outside, target, "junction");

    expect(typeof writeRuntimeArtifacts).toBe("function");
    expect(() => writeRuntimeArtifacts(root, runtimeSections()))
      .toThrow(/target|link|reparse|directory/i);
    expect(readFileSync(join(outside, "sentinel.txt"), "utf8")).toBe("outside-sentinel");
    expect(lstatSync(target).isSymbolicLink()).toBe(true);
    unlinkSync(target);
  });

  it("rejects a dangling deterministic summary temporary symlink when supported", () => {
    const root = mkdtempSync(join(tmpdir(), "quality-summary-dangling-temp-"));
    const missingOutside = join(root, "missing-outside.txt");
    const temporary = join(root, "injected-summary.tmp");
    try {
      symlinkSync(missingOutside, temporary, "file");
    } catch (error) {
      if (["EACCES", "EPERM", "ENOTSUP"].includes((error as NodeJS.ErrnoException).code ?? "")) return;
      throw error;
    }

    expect(() => writeQualityReport(root, summary(), {
      temporaryPathFor: () => temporary,
    })).toThrow(/temporary|link|exclusive|artifact/i);
    expect(existsSync(join(root, "summary.json"))).toBe(false);
    expect(lstatSync(temporary).isSymbolicLink()).toBe(true);
  });
});
