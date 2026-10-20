import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every source file is UTF-8.
 *
 * A script edit once wrote the "·" in a report's subtitle as the single
 * Latin-1 byte 0xB7. The type checker read past it, the unit tests passed, and
 * the production build stopped on "invalid utf-8 sequence". This finds it
 * where the tests run instead.
 */
const ROOTS = ["app", "components", "lib", "tests"];

function sourceFiles(dir: string, root: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, root, out);
    else if (/\.(tsx?|css|mjs|json)$/.test(entry)) out.push(relative(root, full).replaceAll("\\", "/"));
  }
  return out;
}

describe("source files", () => {
  // Read and decoded while the suite is collected, not inside the test: the
  // whole tree read in the test body ran past the 5s limit when the suite ran
  // in parallel on a busy machine (2026-10-20), as plural-contract once did.
  const root = process.cwd();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const files = ROOTS.flatMap((dir) => sourceFiles(join(root, dir), root));
  const broken = files.filter((file) => {
    try {
      decoder.decode(readFileSync(join(root, file)));
      return false;
    } catch {
      return true;
    }
  });

  it("finds the files it is supposed to be guarding", () => {
    expect(files).toContain("lib/domain/changelog.ts");
  });

  it("are all valid UTF-8", () => {
    expect(broken).toEqual([]);
  });
});
