import { describe, it, expect } from "vitest";
import { taxCodeCreateSchema } from "@/lib/domain/schemas";

const ok = { code: "TAX", name: "Sales Tax", rate_percent: 8.25, direction: "sales" as const };

describe("taxCodeCreateSchema", () => {
  it("accepts a valid sales tax code", () => {
    expect(taxCodeCreateSchema.safeParse(ok).success).toBe(true);
  });
  it("rejects a negative rate", () => {
    expect(taxCodeCreateSchema.safeParse({ ...ok, rate_percent: -1 }).success).toBe(false);
  });
  it("rejects a missing code", () => {
    expect(taxCodeCreateSchema.safeParse({ ...ok, code: "" }).success).toBe(false);
  });
  it("rejects an invalid direction", () => {
    expect(taxCodeCreateSchema.safeParse({ ...ok, direction: "vat" }).success).toBe(false);
  });
});
