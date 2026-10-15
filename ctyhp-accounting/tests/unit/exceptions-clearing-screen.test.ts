import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TABLE_BOX_AT_1280, fitsBox } from "@/lib/design/table-metrics";
import { CLEARING_ELASTIC_FLOOR, CLEARING_FIXED_WIDTHS } from "@/app/(app)/reports/exceptions/clearing-columns";

const screen = readFileSync("app/(app)/reports/exceptions/ExceptionsClient.tsx", "utf8");

describe("the clearing section of the Exceptions screen", () => {
  it("fits the 984px box with its three elastic columns at their floors", () => {
    const fixed = CLEARING_FIXED_WIDTHS.reduce((a, b) => a + b, 0);
    expect(fitsBox(fixed, CLEARING_ELASTIC_FLOOR)).toBe(true);
    expect(TABLE_BOX_AT_1280).toBe(984);
  });

  it("is titled from the label and states why, with the first in, first out note", () => {
    expect(screen).toContain("CHECK_LABEL.clearing");
    expect(screen).toContain("${CLEARING_WHY} ${CLEARING_FIFO_NOTE}");
    expect(screen).toContain("LEFT_STANDING");
  });

  it("takes its sentences from the domain and never words them itself", () => {
    expect(screen).toContain("clearingSentences(row, ran.to, money)");
    expect(screen).not.toMatch(/across \$\{|No movement for/);
  });

  it("keeps nothing of the old undeposited check", () => {
    expect(screen).not.toMatch(/undeposited/i);
    expect(screen).not.toMatch(/Money received but not yet banked/);
  });

  it("scrolls only downwards", () => {
    expect(screen).not.toMatch(/scroll=\{\{\s*x/);
  });
});
