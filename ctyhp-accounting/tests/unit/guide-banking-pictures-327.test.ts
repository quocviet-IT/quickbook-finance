import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GUIDE_FLOWS } from "@/lib/domain/system-guide";
import { RELEASES } from "@/lib/domain/changelog";

/**
 * 3.0.27: Banking's thirty steps get their pictures, the last of the guide's steps
 * without one. They are captured from the sample company once it holds bank
 * statements of its own, made up and read in through Banking's own screens.
 */

const ROOT = process.cwd();
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8").replace(/\r\n/g, "\n");
const banking = GUIDE_FLOWS.filter((flow) => flow.area === "banking");

describe("Banking's steps have pictures (3.0.27)", () => {
  it("gives every one of Banking's steps a picture of its own screen", () => {
    const missing = banking.flatMap((flow) =>
      flow.steps.flatMap((step, index) =>
        step.screenshot?.src.startsWith("/guide/steps/") ? [] : [`${flow.id} step ${index + 1}`],
      ),
    );
    expect(missing).toEqual([]);
  });

  it("leaves no step in the guide without a picture", () => {
    const missing = GUIDE_FLOWS.flatMap((flow) =>
      flow.steps.flatMap((step, index) => (step.screenshot ? [] : [`${flow.id} step ${index + 1}`])),
    );
    expect(missing).toEqual([]);
  });

  it("says what each Banking picture shows, naming the control ringed in orange", () => {
    for (const flow of banking) {
      flow.steps.forEach((step, index) => {
        expect(step.screenshot?.alt ?? "", `${flow.id} step ${index + 1}`).toMatch(/ringed in orange/);
      });
    }
  });

  it("makes up the sample company's statements in the script, never reading a real one", () => {
    // Statements are built in memory from the sample company's own entries and
    // handed to the file chooser; no statement file is read from disk. Since
    // 3.0.28 they sit in a module the guide videos share.
    const statements = read("scripts", "guide-statements.mjs");
    expect(statements).toMatch(/function statementCsv\(/);
    const script = read("scripts", "capture-step-shots.mjs");
    expect(script).toMatch(/from "\.\/guide-statements\.mjs"/);
    for (const source of [statements, script]) {
      expect(source).not.toMatch(/readFileSync\([^)]*\.(csv|pdf|ofx|qfx|qbo|qif)/i);
    }
  });
});

describe("the release note (3.0.27)", () => {
  it("says Banking's steps now have pictures too", () => {
    const release = RELEASES.find((candidate) => candidate.version === "3.0.27");
    expect(release).toBeDefined();
    const said = (release?.changes ?? []).map((change) => `${change.title} ${change.detail ?? ""}`).join(" ");
    expect(said).toContain("Banking");
    expect(said).toContain("picture");
  });
});
