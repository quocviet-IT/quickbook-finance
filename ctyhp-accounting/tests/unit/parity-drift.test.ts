import { describe, expect, it } from "vitest";
import { compareEntries, driftKey, type DriftEntry } from "@/lib/parity/drift";

const entry = (id: string, date: string, amounts: number[], accounts: string[] | null = null): DriftEntry => ({
  id,
  date,
  amounts,
  accounts,
  label: `Entry ${id}`,
});

describe("driftKey", () => {
  it("is the date and the sorted non-zero amounts", () => {
    expect(driftKey(entry("1", "2026-01-05", [500, -500, 0]))).toBe("2026-01-05|-500,500");
  });
});

describe("compareEntries", () => {
  it("matches entries by date and amounts, and lists what only one side has", () => {
    const result = compareEntries(
      [entry("p1", "2026-01-05", [500, -500]), entry("p2", "2026-01-06", [700, -700])],
      [entry("o1", "2026-01-05", [-500, 500]), entry("o2", "2026-01-07", [700, -700])],
    );
    expect(result.matched).toBe(1);
    expect(result.onlyPrototype.map((e) => e.id)).toEqual(["p2"]);
    expect(result.onlyOnebook.map((e) => e.id)).toEqual(["o2"]);
    expect(result.accountsDiffer).toEqual([]);
  });
  it("counts duplicates rather than remembering them", () => {
    const twice = [entry("p1", "2026-01-05", [500, -500]), entry("p2", "2026-01-05", [500, -500])];
    const result = compareEntries(twice, [entry("o1", "2026-01-05", [500, -500])]);
    expect(result.matched).toBe(1);
    expect(result.onlyPrototype.map((e) => e.id)).toEqual(["p2"]);
  });
  it("matches same accounts first, then reports matching amounts on other accounts apart", () => {
    const result = compareEntries(
      [entry("p1", "2026-01-05", [500, -500], ["6100", "1000"]), entry("p2", "2026-01-05", [500, -500], ["6200", "1000"])],
      [entry("o1", "2026-01-05", [500, -500], ["6200", "1000"]), entry("o2", "2026-01-05", [500, -500], ["6300", "1000"])],
    );
    expect(result.matched).toBe(1);
    expect(result.accountsDiffer.map((d) => [d.prototype.id, d.onebook.id])).toEqual([["p1", "o2"]]);
    expect(result.onlyPrototype).toEqual([]);
    expect(result.onlyOnebook).toEqual([]);
  });
  it("offers a candidate with known accounts first, whatever order the candidates come in", () => {
    const p1 = entry("p1", "2026-01-05", [500, -500], ["B", "Z"]);
    const unknown = entry("oNull", "2026-01-05", [500, -500], null);
    const known = entry("oKnown", "2026-01-05", [500, -500], ["A", "Z"]);
    for (const onebook of [[unknown, known], [known, unknown]]) {
      const result = compareEntries([p1], onebook);
      expect(result.matched).toBe(0);
      expect(result.accountsDiffer.map((d) => [d.prototype.id, d.onebook.id])).toEqual([["p1", "oKnown"]]);
      expect(result.onlyOnebook.map((e) => e.id)).toEqual(["oNull"]);
    }
  });
  it("sorts every list by date, then id", () => {
    const result = compareEntries(
      [entry("p2", "2026-02-01", [100, -100]), entry("p1", "2026-01-01", [200, -200])],
      [entry("o2", "2026-03-01", [300, -300]), entry("o1", "2026-01-15", [400, -400])],
    );
    expect(result.onlyPrototype.map((e) => e.id)).toEqual(["p1", "p2"]);
    expect(result.onlyOnebook.map((e) => e.id)).toEqual(["o1", "o2"]);
  });
});
