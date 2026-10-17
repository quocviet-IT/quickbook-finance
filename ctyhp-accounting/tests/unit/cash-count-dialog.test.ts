import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The Count cash dialog reads the book balance again when the date changes. Until
 * that read answers, the old date's balance must not stand in for the new one, and
 * the count cannot be recorded against a difference the person has not seen.
 */
const source = readFileSync(join(process.cwd(), "components/cash/CountCashDialog.tsx"), "utf8");

describe("the Count cash dialog while the book balance is read", () => {
  it("clears the old balance and the approval note when a read starts", () => {
    const read = source.slice(source.indexOf("function read("), source.indexOf("return load(on, countedMinor);"));
    expect(read).toContain("setBook(null)");
    expect(read).toContain("setWaits(false)");
  });

  it("shows no difference while reading", () => {
    expect(source).toMatch(/const difference = [^;]*!reading/);
  });

  it("does not let Record count be pressed while reading", () => {
    expect(source).toMatch(/disabled=\{options === null \|\| reading\}/);
  });
});
