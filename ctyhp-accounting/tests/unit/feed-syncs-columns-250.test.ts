import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_VERSION, RELEASES } from "@/lib/domain/changelog";
import { TABLE_BOX_AT_1280 } from "@/lib/design/table-metrics";

const src = readFileSync(join(process.cwd(), "app/(app)/banking/BankFeedSyncList.tsx"), "utf8").replace(/\r/g, "");

describe("Bank feed syncs columns (2.50)", () => {
  const widths = [...src.matchAll(/width: (\d+|COUNT_WIDTH)/g)].map((m) => (m[1] === "COUNT_WIDTH" ? 80 : Number(m[1])));

  it("are Started, Status, four counts and Undo at fixed widths, with the bank elastic", () => {
    expect(src).toContain("const COUNT_WIDTH = 80;");
    expect(widths).toEqual([170, 120, 80, 80, 80, 80, 88]);
  });

  it("leave the bank column room for a name and its tag at the narrowest table", () => {
    const fixed = widths.reduce((sum, w) => sum + w, 0);
    expect(TABLE_BOX_AT_1280 - fixed).toBeGreaterThanOrEqual(280);
  });

  it("let the Disconnected tag wrap under the name instead of squeezing it", () => {
    expect(src).toMatch(/<Space size=\{\[6, 4\]\} wrap>\s*<span>\{name\}<\/span>/);
  });
});

describe("the 2.50 release in the release notes", () => {
  const release = RELEASES.find((r) => r.version === "2.50")!;

  it("is listed and dated the day it was built", () => {
    expect(release).toBeDefined();
    expect(Number(APP_VERSION)).toBeGreaterThanOrEqual(2.5);
    expect(release.date).toBe("2026-10-24");
    expect(release.changes[0].detail).toContain("the tag moves under the name");
  });
});
