import { describe, expect, it } from "vitest";
import {
  MAX_SEARCH_SUGGESTIONS,
  buildSearchSuggestions,
  type SearchableRow,
} from "@/lib/domain/transaction-search";

function row(description: string, reference: string | null = null): SearchableRow {
  return { description, reference };
}

const LEDGER: SearchableRow[] = [
  row("WIRE TYPE:WIRE IN DATE: 260213 TIME:1721 ET", "TRN-1"),
  row("WIRE TYPE:WIRE IN DATE: 260214 TIME:0902 ET", "TRN-2"),
  row("WIRE TYPE:WIRE OUT DATE: 260215 TIME:1130 ET", "TRN-3"),
  row("Monthly bank service fee", "BANK-FEE-AUG"),
  row("Monthly bank service fee", "BANK-FEE-JUL"),
  row("Monthly bank service fee", "BANK-FEE-JUN"),
  row("Customer ACH deposit", null),
  row("International wire fee", null),
];

describe("buildSearchSuggestions", () => {
  it("offers nothing until something is typed", () => {
    // 157 values dropped on somebody who has typed nothing is noise, not help.
    expect(buildSearchSuggestions(LEDGER, "")).toEqual([]);
    expect(buildSearchSuggestions(LEDGER, "   ")).toEqual([]);
  });

  it("groups the lines that share a description into one suggestion", () => {
    // Three months of the same bank fee is one thing to search for, not three
    // identical rows in a dropdown.
    const suggestions = buildSearchSuggestions(LEDGER, "monthly");
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      value: "Monthly bank service fee",
      field: "description",
      count: 3,
    });
  });

  it("puts a match at the start of the value above one in the middle", () => {
    // Typing "wire" means the wires, not the one fee that happens to contain
    // the word. Two values, both behind one line, so the single-line cap
    // cannot hide either and the ordering is the only thing under test.
    const values = buildSearchSuggestions(
      [row("Wire transfer out"), row("International wire fee")],
      "wire",
    ).map((s) => s.value);
    expect(values).toEqual(["Wire transfer out", "International wire fee"]);
  });

  it("ranks by how many lines are behind each value, within the same kind of match", () => {
    const rows = [row("Payment"), row("Payment"), row("Payment"), row("Payroll")];
    expect(buildSearchSuggestions(rows, "pay").map((s) => s.value)).toEqual(["Payment", "Payroll"]);
  });

  it("ignores case, so a typed word finds a shouted description", () => {
    // Bank feeds shout. A reader types in lower case.
    expect(buildSearchSuggestions(LEDGER, "WIRE TYPE").length).toBeGreaterThan(0);
    expect(buildSearchSuggestions(LEDGER, "wire type").length).toBeGreaterThan(0);
  });

  it("suggests a reference as well as a description", () => {
    const suggestions = buildSearchSuggestions(LEDGER, "BANK-FEE-AUG");
    expect(suggestions.map((s) => s.field)).toContain("reference");
    expect(suggestions.map((s) => s.value)).toContain("BANK-FEE-AUG");
  });

  it("skips a row with no reference rather than suggesting an empty one", () => {
    const suggestions = buildSearchSuggestions([row("Customer ACH deposit", null)], "customer");
    expect(suggestions.every((s) => s.value.trim() !== "")).toBe(true);
    expect(suggestions).toHaveLength(1);
  });

  it("never returns more than the cap, however many things match", () => {
    // The dropdown has to stay readable. Fails if the limit is applied per
    // field rather than to the whole list. Every value here is behind two
    // lines, so the separate one-line cap is not what is being measured.
    const many = Array.from({ length: 60 }, (_, i) => `Payment ${i}`).flatMap((description) => [
      row(description),
      row(description),
    ]);
    expect(buildSearchSuggestions(many, "pay").length).toBe(MAX_SEARCH_SUGGESTIONS);
    expect(buildSearchSuggestions(many, "e").length).toBeLessThanOrEqual(MAX_SEARCH_SUGGESTIONS);
  });

  it("offers a value only once even when it is both a description and a reference", () => {
    // Otherwise picking either one filters to the same rows and the reader is
    // asked to choose between two identical lines.
    const rows = [row("ACH-2201", "ACH-2201"), row("Something else", "ACH-2201")];
    const values = buildSearchSuggestions(rows, "ACH").map((s) => s.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("returns nothing when the typed text matches nothing", () => {
    expect(buildSearchSuggestions(LEDGER, "zzzzz")).toEqual([]);
  });

  it("leads with values that group, not values that happen to sort first", () => {
    // Found against real data: a bank wire description carries its own date
    // and time, so no two are ever equal and grouping produces a dropdown of
    // near-identical one-line entries. A value behind several lines is the
    // one worth offering — it is the only kind that narrows anything the
    // table below is not already showing.
    const rows = [
      ...Array.from({ length: 6 }, (_, i) => row(`WIRE TYPE:BOOK IN DATE:2602${i}0 TIME:161${i}`)),
      row("Wire Transfer Fee"),
      row("Wire Transfer Fee"),
    ];
    expect(buildSearchSuggestions(rows, "wire")[0]).toMatchObject({
      value: "Wire Transfer Fee",
      count: 2,
    });
  });

  it("does not let one-line values flood the dropdown", () => {
    // Six unique wires used to fill every remaining slot. A short list of
    // things worth picking beats a long list of things that each lead to one
    // row the table is already showing.
    const rows = Array.from({ length: 20 }, (_, i) => row(`WIRE TYPE:BOOK IN DATE:2602${i}`));
    expect(buildSearchSuggestions(rows, "wire").length).toBeLessThanOrEqual(3);
  });

  it("still offers a one-line value when that is all there is", () => {
    // The cap trims a flood; it must not silence the box entirely on a
    // statement where every description is unique.
    expect(buildSearchSuggestions([row("Customer ACH deposit")], "customer")).toHaveLength(1);
  });

  it("counts only the rows the caller handed it", () => {
    // The caller passes rows already narrowed by account, status and posted-to.
    // A suggestion built from anything wider could be chosen and return no
    // rows at all, which is worse than offering nothing.
    const narrowed = LEDGER.slice(3, 5);
    expect(buildSearchSuggestions(narrowed, "monthly")[0].count).toBe(2);
  });
});
