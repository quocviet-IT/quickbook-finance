import { describe, expect, it } from "vitest";
import { mergeMapping, parseMappingReply } from "@/lib/ai/mapping-prompt";
import { proposeMapping } from "@/lib/domain/import-mapping";

const HEADERS = 5; // indices 0..4

describe("parseMappingReply", () => {
  it("reads a clean JSON answer", () => {
    const out = parseMappingReply('{"mapping":{"customer":1,"quantity":3}}', "invoices", HEADERS);
    expect(out).toEqual({ customer: 1, quantity: 3 });
  });

  it("survives a code fence and a sentence around the JSON", () => {
    // Models add both, whatever the instruction said.
    const text = 'Sure! ```json\n{"mapping":{"customer":2}}\n``` Hope that helps.';
    expect(parseMappingReply(text, "invoices", HEADERS)).toEqual({ customer: 2 });
  });

  it("drops a field that is not in the spec", () => {
    // A hallucinated key must never reach applyMapping.
    const out = parseMappingReply(
      '{"mapping":{"customer":1,"shipping_zone":2}}',
      "invoices",
      HEADERS,
    );
    expect(out).toEqual({ customer: 1 });
  });

  it("drops a column index the file does not have", () => {
    const out = parseMappingReply('{"mapping":{"customer":99,"quantity":0}}', "invoices", HEADERS);
    expect(out).toEqual({ quantity: 0 });
  });

  it("drops a negative index", () => {
    expect(parseMappingReply('{"mapping":{"customer":-1}}', "invoices", HEADERS)).toEqual({});
  });

  it("never uses one column for two fields", () => {
    const out = parseMappingReply('{"mapping":{"customer":1,"memo":1}}', "invoices", HEADERS);
    expect(Object.values(out)).toEqual([1]);
  });

  it("ignores a non-integer index rather than rounding it", () => {
    expect(parseMappingReply('{"mapping":{"customer":1.5}}', "invoices", HEADERS)).toEqual({});
  });

  it("ignores a string index rather than coercing it", () => {
    expect(parseMappingReply('{"mapping":{"customer":"1"}}', "invoices", HEADERS)).toEqual({});
  });

  it("returns nothing for prose with no JSON", () => {
    expect(parseMappingReply("I could not work out the columns.", "invoices", HEADERS)).toEqual({});
  });

  it("returns nothing for malformed JSON", () => {
    expect(parseMappingReply('{"mapping":{"customer":', "invoices", HEADERS)).toEqual({});
  });

  it("returns nothing when the mapping key is missing", () => {
    expect(parseMappingReply('{"columns":{"customer":1}}', "invoices", HEADERS)).toEqual({});
  });

  it("keeps null out of the result rather than storing it", () => {
    // null means "no column"; the caller's baseline already represents that.
    expect(parseMappingReply('{"mapping":{"customer":null,"memo":2}}', "invoices", HEADERS)).toEqual(
      { memo: 2 },
    );
  });
});

describe("mergeMapping", () => {
  const HEADERS_LIST = ["Invoice No", "Client Name", "Mystery Column", "Qty", "Rate"];

  it("keeps what the alias matcher found and only fills its gaps", () => {
    const baseline = proposeMapping(HEADERS_LIST, "invoices");
    const before = baseline.columns.invoice_number;
    // The model claims a different column for a field already matched.
    const merged = mergeMapping(baseline, { invoice_number: 2 }, HEADERS_LIST, "invoices");
    expect(merged.columns.invoice_number).toBe(before);
    expect(merged.aiFields).toEqual([]);
  });

  it("records which fields the model contributed", () => {
    const baseline = proposeMapping(HEADERS_LIST, "invoices");
    expect(baseline.columns.memo).toBeNull();
    const merged = mergeMapping(baseline, { memo: 2 }, HEADERS_LIST, "invoices");
    expect(merged.columns.memo).toBe(2);
    expect(merged.aiFields).toEqual(["memo"]);
  });

  it("will not let the model reuse a column the baseline already took", () => {
    const baseline = proposeMapping(HEADERS_LIST, "invoices");
    const merged = mergeMapping(baseline, { memo: baseline.columns.quantity! }, HEADERS_LIST, "invoices");
    expect(merged.columns.memo).toBeNull();
    expect(merged.aiFields).toEqual([]);
  });

  it("recomputes what is still missing and still unused", () => {
    const baseline = proposeMapping(HEADERS_LIST, "invoices");
    const merged = mergeMapping(baseline, { memo: 2 }, HEADERS_LIST, "invoices");
    expect(merged.unmapped).not.toContain("Mystery Column");
    expect(merged.missingRequired).not.toContain("memo");
  });

  it("is exactly the baseline when the model offered nothing", () => {
    const baseline = proposeMapping(HEADERS_LIST, "invoices");
    const merged = mergeMapping(baseline, {}, HEADERS_LIST, "invoices");
    expect(merged.columns).toEqual(baseline.columns);
    expect(merged.aiFields).toEqual([]);
  });
});
