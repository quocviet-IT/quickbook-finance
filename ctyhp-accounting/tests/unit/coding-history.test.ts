import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildHistoryIndex,
  HISTORY_MIN,
  HISTORY_SHARE,
  suggestFromHistory,
  type HistorySource,
} from "@/lib/domain/coding-history";

let seq = 0;
const src = (accountId: string, texts: string[], direction: "in" | "out" = "out", date = "2026-01-01"): HistorySource => ({
  entryId: `e${(seq += 1)}`,
  date,
  direction,
  accountId,
  texts,
});
const all = () => true;

describe("history thresholds", () => {
  it("are the prototype's: two entries, three in four", () => {
    expect(HISTORY_MIN).toBe(2);
    expect(HISTORY_SHARE).toBe(0.75);
  });
});

describe("suggestFromHistory", () => {
  it("suggests after two entries that agree, and says how often", () => {
    const index = buildHistoryIndex(
      [src("rent", ["Metro Realty Partners"]), src("rent", ["Metro Realty Partners"], "out", "2026-02-01")],
      all,
    );
    expect(suggestFromHistory(index, ["METRO REALTY PARTNERS LLC"], "out")).toEqual({
      accountId: "rent",
      hits: 2,
      of: 2,
      key: "metro realty partners",
      last: "2026-02-01",
    });
  });
  it("stays quiet after one entry", () => {
    const index = buildHistoryIndex([src("rent", ["Metro Realty Partners"])], all);
    expect(suggestFromHistory(index, ["Metro Realty Partners"], "out")).toBeNull();
  });
  it("needs three in four to agree: 3 of 4 speaks, 2 of 3 does not", () => {
    const three = buildHistoryIndex(
      [src("a", ["Acme Supply"]), src("a", ["Acme Supply"]), src("a", ["Acme Supply"]), src("b", ["Acme Supply"])],
      all,
    );
    expect(suggestFromHistory(three, ["Acme Supply"], "out")?.accountId).toBe("a");
    const two = buildHistoryIndex([src("a", ["Acme Supply"]), src("a", ["Acme Supply"]), src("b", ["Acme Supply"])], all);
    expect(suggestFromHistory(two, ["Acme Supply"], "out")).toBeNull();
  });
  it("keeps money in and money out apart", () => {
    const index = buildHistoryIndex([src("sales", ["Acme Supply"], "in"), src("sales", ["Acme Supply"], "in")], all);
    expect(suggestFromHistory(index, ["Acme Supply"], "out")).toBeNull();
    expect(suggestFromHistory(index, ["Acme Supply"], "in")?.accountId).toBe("sales");
  });
  it("tries the longest key first: three words agreeing beat two", () => {
    const index = buildHistoryIndex(
      [
        src("rent", ["Metro Realty Partners"]),
        src("rent", ["Metro Realty Partners"]),
        src("repairs", ["Metro Realty Services"]),
        src("repairs", ["Metro Realty Services"]),
      ],
      all,
    );
    // "metro realty" alone is split two and two; "metro realty services" is not.
    expect(suggestFromHistory(index, ["Metro Realty Services"], "out")?.accountId).toBe("repairs");
    expect(suggestFromHistory(index, ["Metro Realty"], "out")).toBeNull();
  });
  it("counts an entry once for a key, however many of its texts carry it", () => {
    const index = buildHistoryIndex([src("rent", ["Metro Realty Partners", "Metro Realty Partners — March rent"])], all);
    expect(index.get("out|metro realty partners")?.n).toBe(1);
  });
  it("learns nothing from an entry whose account may not teach", () => {
    const index = buildHistoryIndex([src("ar", ["Acme"]), src("ar", ["Acme"])], (id) => id !== "ar");
    expect(suggestFromHistory(index, ["Acme"], "out")).toBeNull();
  });
  it("takes other thresholds when asked, for measuring them", () => {
    const index = buildHistoryIndex([src("a", ["Acme Supply"]), src("a", ["Acme Supply"]), src("b", ["Acme Supply"])], all);
    expect(suggestFromHistory(index, ["Acme Supply"], "out", { min: 2, share: 0.6 })?.accountId).toBe("a");
  });
});

describe("the history module", () => {
  it("can be imported by plain-Node scripts", () => {
    const src = readFileSync("lib/domain/coding-history.ts", "utf8");
    expect(src).not.toMatch(/from "@\//);
    expect(src).toMatch(/from "\.\/coding-names\.ts"/);
  });
});
