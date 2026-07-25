import { describe, expect, it } from "vitest";
import { assess1099, maskTin, sum1099Reportable, w9Effective } from "@/lib/domain/vendorTax";
import { toCsv } from "@/lib/csv";
import { taxYearSchema, vendorTaxProfileSchema } from "@/lib/domain/schemas";

describe("maskTin", () => {
  it("shows a dash when nothing is on file", () => {
    expect(maskTin(null, null)).toBe("—");
  });

  it("masks an SSN to its last four digits", () => {
    expect(maskTin("123-45-6789", "ssn")).toBe("•••-••-6789");
  });

  it("masks an EIN to its last four digits", () => {
    expect(maskTin("12-3456789", "ein")).toBe("••-•••6789");
  });

  it("masks without a type when the type is unknown", () => {
    expect(maskTin("123456789", null)).toBe("•••••6789");
  });

  it("never reveals a short value", () => {
    expect(maskTin("12", "ssn")).toBe("••••");
  });
});

describe("w9Effective", () => {
  it("is on file when the status says so and it has not expired", () => {
    expect(w9Effective("on_file", "2027-01-01", "2026-07-25")).toBe("on_file");
  });

  it("is on file with no expiry date", () => {
    expect(w9Effective("on_file", null, "2026-07-25")).toBe("on_file");
  });

  it("is expired one day past the expiry", () => {
    expect(w9Effective("on_file", "2026-07-24", "2026-07-25")).toBe("expired");
  });

  it("is still on file on the expiry date itself", () => {
    expect(w9Effective("on_file", "2026-07-25", "2026-07-25")).toBe("on_file");
  });

  it("is missing when never requested or only requested", () => {
    expect(w9Effective("not_requested", null, "2026-07-25")).toBe("missing");
    expect(w9Effective("requested", null, "2026-07-25")).toBe("missing");
  });

  it("respects an explicit expired status", () => {
    expect(w9Effective("expired", "2030-01-01", "2026-07-25")).toBe("expired");
  });
});

const CLEAN = {
  vendorName: "Ace Consulting",
  reportingName: "Ace Consulting LLC",
  classification: "llc" as const,
  w9Status: "on_file" as const,
  w9ExpiresDate: null,
  tinOnFile: true,
  addressComplete: true,
  is1099Eligible: true,
  boxCode: "NEC-1",
  thresholdMinor: 60000,
  paidMinor: 120000,
  eligibilityOverride: false,
};

describe("assess1099", () => {
  const asOf = "2026-07-25";

  it("reports a clean eligible vendor over the threshold with no exceptions", () => {
    const r = assess1099(CLEAN, asOf);
    expect(r.reportable).toBe(true);
    expect(r.exceptions).toEqual([]);
  });

  it("warns when paid over the threshold but not marked eligible", () => {
    const r = assess1099({ ...CLEAN, is1099Eligible: false, boxCode: null }, asOf);
    expect(r.reportable).toBe(false);
    expect(r.exceptions.map((e) => e.code)).toContain("not_marked_eligible");
    expect(r.exceptions.every((e) => e.severity === "warning")).toBe(true);
  });

  it("warns when marked eligible but under the threshold", () => {
    const r = assess1099({ ...CLEAN, paidMinor: 50000 }, asOf);
    expect(r.reportable).toBe(false);
    expect(r.exceptions.map((e) => e.code)).toContain("under_threshold");
  });

  it("blocks a reportable vendor with no taxpayer identifier", () => {
    const r = assess1099({ ...CLEAN, tinOnFile: false }, asOf);
    expect(r.reportable).toBe(true);
    const tin = r.exceptions.find((e) => e.code === "missing_tin");
    expect(tin?.severity).toBe("blocker");
  });

  it("blocks a reportable vendor with an incomplete address", () => {
    const r = assess1099({ ...CLEAN, addressComplete: false }, asOf);
    expect(r.exceptions.find((e) => e.code === "incomplete_address")?.severity).toBe("blocker");
  });

  it("blocks a reportable vendor with no reporting name", () => {
    const r = assess1099({ ...CLEAN, reportingName: null }, asOf);
    expect(r.exceptions.find((e) => e.code === "missing_reporting_name")?.severity).toBe("blocker");
  });

  it("blocks a reportable vendor whose W-9 has expired", () => {
    const r = assess1099({ ...CLEAN, w9ExpiresDate: "2026-01-01" }, asOf);
    expect(r.exceptions.find((e) => e.code === "w9_expired")?.severity).toBe("blocker");
  });

  it("blocks a reportable vendor with no W-9 at all", () => {
    const r = assess1099({ ...CLEAN, w9Status: "requested" }, asOf);
    expect(r.exceptions.find((e) => e.code === "w9_missing")?.severity).toBe("blocker");
  });

  it("warns when a corporation is marked eligible without an override", () => {
    const r = assess1099({ ...CLEAN, classification: "c_corporation" }, asOf);
    expect(r.exceptions.find((e) => e.code === "corporation_eligible")?.severity).toBe("warning");
  });

  it("does not warn about a corporation once the override is documented", () => {
    const r = assess1099({ ...CLEAN, classification: "c_corporation", eligibilityOverride: true }, asOf);
    expect(r.exceptions.map((e) => e.code)).not.toContain("corporation_eligible");
  });

  it("an override makes an under-threshold vendor reportable", () => {
    const r = assess1099({ ...CLEAN, paidMinor: 100, eligibilityOverride: true }, asOf);
    expect(r.reportable).toBe(true);
    expect(r.exceptions.map((e) => e.code)).not.toContain("under_threshold");
  });

  it("raises no exception for a vendor with no payments and no eligibility", () => {
    const r = assess1099(
      { ...CLEAN, paidMinor: 0, is1099Eligible: false, boxCode: null, tinOnFile: false, addressComplete: false },
      asOf,
    );
    expect(r.reportable).toBe(false);
    expect(r.exceptions).toEqual([]);
  });

  it("flags an eligible vendor with no box configured", () => {
    const r = assess1099({ ...CLEAN, boxCode: null }, asOf);
    expect(r.exceptions.find((e) => e.code === "missing_box")?.severity).toBe("blocker");
  });
});

describe("sum1099Reportable", () => {
  it("sums only the reportable rows", () => {
    const rows = [CLEAN, { ...CLEAN, paidMinor: 50000 }, { ...CLEAN, paidMinor: 200000 }];
    expect(sum1099Reportable(rows, "2026-07-25")).toBe(320000); // 1200.00 + 2000.00
  });

  it("is zero with no rows", () => {
    expect(sum1099Reportable([], "2026-07-25")).toBe(0);
  });
});

describe("toCsv", () => {
  it("writes a header and rows", () => {
    const csv = toCsv([{ a: "1", b: "2" }], [
      { key: "a", header: "A" },
      { key: "b", header: "B" },
    ]);
    expect(csv).toBe("A,B\r\n1,2");
  });

  it("quotes a value containing a comma", () => {
    const csv = toCsv([{ a: "one, two" }], [{ key: "a", header: "A" }]);
    expect(csv).toBe('A\r\n"one, two"');
  });

  it("doubles an embedded quote", () => {
    const csv = toCsv([{ a: 'say "hi"' }], [{ key: "a", header: "A" }]);
    expect(csv).toBe('A\r\n"say ""hi"""');
  });

  it("quotes a value containing a newline", () => {
    const csv = toCsv([{ a: "line1\nline2" }], [{ key: "a", header: "A" }]);
    expect(csv).toBe('A\r\n"line1\nline2"');
  });

  it("renders null and undefined as empty", () => {
    const csv = toCsv([{ a: null, b: undefined }], [
      { key: "a", header: "A" },
      { key: "b", header: "B" },
    ]);
    expect(csv).toBe("A,B\r\n,");
  });

  it("renders numbers and booleans", () => {
    const csv = toCsv([{ a: 12.5, b: true }], [
      { key: "a", header: "A" },
      { key: "b", header: "B" },
    ]);
    expect(csv).toBe("A,B\r\n12.5,true");
  });
});

describe("vendor tax schemas", () => {
  const base = {
    w9_status: "on_file",
    classification: "llc",
    reporting_name: "Ace Consulting LLC",
    tin_ref: "12-3456789",
    tin_type: "ein",
    is_1099_eligible: true,
    box_code: "NEC-1",
    eligibility_override: false,
    reason: "W-9 received",
  };

  it("accepts a complete profile", () => {
    expect(vendorTaxProfileSchema.safeParse(base).success).toBe(true);
  });

  it("requires a change reason", () => {
    expect(vendorTaxProfileSchema.safeParse({ ...base, reason: "" }).success).toBe(false);
  });

  it("requires a box when eligible", () => {
    expect(vendorTaxProfileSchema.safeParse({ ...base, box_code: "" }).success).toBe(false);
  });

  it("requires an override reason when overriding", () => {
    expect(
      vendorTaxProfileSchema.safeParse({ ...base, eligibility_override: true }).success,
    ).toBe(false);
    expect(
      vendorTaxProfileSchema.safeParse({
        ...base,
        eligibility_override: true,
        override_reason: "Attorney fees are reportable despite the corporation",
      }).success,
    ).toBe(true);
  });

  it("rejects an implausible tax year", () => {
    expect(taxYearSchema.safeParse({ year: 1998 }).success).toBe(false);
    expect(taxYearSchema.safeParse({ year: 2026 }).success).toBe(true);
  });
});
