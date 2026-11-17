import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every form marks its required fields and, on a failed Save, moves focus to
 * the first wrong field.
 *
 * Ant Design's required asterisk was switched off with requiredMark={false},
 * and a raw form.validateFields() leaves focus on the Save button. 3.0.10 fixed
 * the invoice, estimate and customer forms; 3.0.45 fixed all the others. The
 * answer is validateOrFocus(form) from lib/client/validate-or-focus.ts.
 */
const ROOT = process.cwd();

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && !entry.name.startsWith(".")) sources(full, out);
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test.")) {
      out.push(full);
    }
  }
  return out;
}

const files = ["app", "components"]
  .flatMap((d) => sources(join(ROOT, d)))
  .map((file) => ({
    path: relative(ROOT, file).replaceAll("\\", "/"),
    source: readFileSync(file, "utf8").replace(/\r\n/g, "\n"),
  }));

/** Files that may call validateFields with arguments (a partial validation), each with its reason. */
const PARTIAL_VALIDATION_ALLOWED: Record<string, string> = {};

/** Files that may keep requiredMark={false}: every field there is required, so an asterisk on each says nothing. */
const REQUIRED_MARK_OFF_ALLOWED: Record<string, string> = {
  // The email and password boxes (and the code box) are all required.
  "app/(auth)/login/LoginClient.tsx": "every field on the sign-in forms is required",
  // One inline code field.
  "app/(app)/account/two-step/TwoStepClient.tsx": "a single inline code field, always required",
};

describe("form validation", () => {
  it("scans the app's files (the scan itself works)", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => /validateOrFocus\(/.test(f.source))).toBe(true);
  });

  it("calls validateOrFocus instead of a bare validateFields()", () => {
    const offenders = files
      .filter((f) => /\.validateFields\(\s*\)/.test(f.source))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("calls validateFields with arguments only where allowed", () => {
    const offenders = files
      .filter((f) => /\.validateFields\(\s*[^\s)]/.test(f.source) && !(f.path in PARTIAL_VALIDATION_ALLOWED))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("keeps the required mark on, except where every field is required", () => {
    const offenders = files
      .filter((f) => /requiredMark=\{false\}/.test(f.source) && !(f.path in REQUIRED_MARK_OFF_ALLOWED))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});
