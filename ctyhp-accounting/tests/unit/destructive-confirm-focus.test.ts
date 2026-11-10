import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every question asked before something that cannot be taken back opens with
 * focus on Cancel and names its action on the button.
 *
 * Ant Design's confirm focuses OK, so a reader who pressed Enter voided an
 * invoice, reversed an entry or turned off two-step sign-in. And a danger
 * button with no okText reads "OK", which says nothing about what it does.
 * Found on Void invoice in 3.0.8; 3.0.9 fixed the other twenty.
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

/** Each `.confirm(...)` call: where it is and its argument text. */
function confirmCalls(): { where: string; body: string }[] {
  const calls: { where: string; body: string }[] = [];
  for (const file of ["app", "components", "lib"].flatMap((d) => sources(join(ROOT, d)))) {
    const source = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    const pattern = /\b[\w.]*\.confirm\(/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source))) {
      const open = source.indexOf("(", match.index);
      let depth = 0;
      let close = open;
      for (; close < source.length; close++) {
        if (source[close] === "(") depth++;
        else if (source[close] === ")" && --depth === 0) break;
      }
      const line = source.slice(0, match.index).split("\n").length;
      calls.push({ where: `${relative(ROOT, file).replaceAll("\\", "/")}:${line}`, body: source.slice(open, close + 1) });
    }
  }
  return calls;
}

describe("destructive confirmations", () => {
  const calls = confirmCalls();
  const destructive = calls.filter((c) => /danger: true/.test(c.body) || /destructiveConfirmProps\(/.test(c.body));

  it("finds the app's confirmations (the scan itself works)", () => {
    expect(calls.length).toBeGreaterThan(20);
    expect(destructive.length).toBeGreaterThan(15);
  });

  it("open with focus on Cancel", () => {
    const offenders = destructive
      .filter((c) => !/autoFocusButton: "cancel"/.test(c.body) && !/destructiveConfirmProps\(/.test(c.body))
      .map((c) => c.where);
    expect(offenders).toEqual([]);
  });

  it("name their action on the button instead of OK", () => {
    const offenders = destructive
      .filter((c) => !/okText:/.test(c.body) && !/destructiveConfirmProps\(/.test(c.body))
      .map((c) => c.where);
    expect(offenders).toEqual([]);
  });
});
