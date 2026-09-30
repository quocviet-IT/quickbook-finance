import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cleanPayee, directionOf, GENERIC_WORDS, historyKeys, nameWords } from "@/lib/domain/coding-names";

describe("cleanPayee", () => {
  it("squeezes spaces, drops a leading card or ACH word and long digit runs", () => {
    expect(cleanPayee("POS  STARBUCKS 12345678 SEATTLE")).toBe("STARBUCKS SEATTLE");
    expect(cleanPayee("ACH Metro Realty Partners")).toBe("Metro Realty Partners");
  });
  it("keeps short numbers and a leading word that is not a card word", () => {
    expect(cleanPayee("Suite 12345 Rent")).toBe("Suite 12345 Rent");
  });
  it("keeps the first 48 characters", () => {
    expect(cleanPayee("x".repeat(60))).toHaveLength(48);
  });
  it("reads nothing from nothing", () => {
    expect(cleanPayee(null)).toBe("");
  });
});

describe("nameWords", () => {
  it("lower-cases, keeps letters only, and drops the words every bank line carries", () => {
    expect(nameWords("ONLINE TRANSFER TO Metro Realty Partners LLC")).toEqual(["metro", "realty", "partners", "llc"]);
  });
  it("drops one-letter words", () => {
    expect(nameWords("A B Jewelry Co Supply")).toEqual(["jewelry", "supply"]);
  });
});

describe("historyKeys", () => {
  it("keys a name by its first three words, and by its first two when there are more", () => {
    expect(historyKeys("Metro Realty Partners LLC")).toEqual(["metro realty partners", "metro realty"]);
  });
  it("keeps a short name whole", () => {
    expect(historyKeys("Pacific Power")).toEqual(["pacific power"]);
    expect(historyKeys("Rent")).toEqual(["rent"]);
  });
  it("has no key for a line made only of bank words", () => {
    expect(historyKeys("WIRE TYPE:WIRE IN DATE:260915")).toEqual([]);
    expect(historyKeys("")).toEqual([]);
  });
  it("drops a long number, and keeps only the letters of a reference, as the prototype does", () => {
    expect(historyKeys("Acme Inc AP260921 260921 X9Q2ZZ")).toEqual(["acme inc ap", "acme inc"]);
  });
});

describe("directionOf", () => {
  it("calls money in, and nothing, in; money out out — as the prototype does", () => {
    expect(directionOf(100)).toBe("in");
    expect(directionOf(0)).toBe("in");
    expect(directionOf(-100)).toBe("out");
  });
});

describe("the names module", () => {
  it("carries the prototype's generic words", () => {
    for (const word of ["deposit", "wire", "ach", "ppd", "memo", "co"]) expect(GENERIC_WORDS.has(word)).toBe(true);
  });
  it("can be imported by plain-Node scripts", () => {
    expect(readFileSync("lib/domain/coding-names.ts", "utf8")).not.toMatch(/from "@\//);
  });
});
