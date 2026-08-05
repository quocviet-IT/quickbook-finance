import { describe, expect, it } from "vitest";
import { companySlugFromName } from "@/lib/domain/company-slug";
import { companyCreateSchema } from "@/lib/domain/schemas";

describe("companySlugFromName", () => {
  it("turns a legal name into a key the register accepts", () => {
    expect(companySlugFromName("North Star Bridal LLC")).toBe("north_star_bridal_llc");
    expect(companySlugFromName("Harbor Gems Trading Co.")).toBe("harbor_gems_trading_co");
    expect(companySlugFromName("  Aurora   Fine Jewelry  ")).toBe("aurora_fine_jewelry");
  });

  it("keeps the result inside the register's own pattern", () => {
    const pattern = /^[a-z][a-z0-9_]{1,40}$/;
    expect(companySlugFromName("3M Metals")).toMatch(pattern); // may not start with a digit
    expect(companySlugFromName("Übergem & Co")).toMatch(pattern);
    expect(companySlugFromName("A".repeat(80))).toMatch(pattern);
  });

  it("gives nothing back for a name with no usable letters", () => {
    expect(companySlugFromName("!!!")).toBe("");
    expect(companySlugFromName("")).toBe("");
  });
});

describe("companyCreateSchema", () => {
  const base = { legal_name: "North Star Bridal LLC", slug: "north_star" };

  it("accepts a trimmed name and key with sensible defaults", () => {
    expect(companyCreateSchema.parse({ legal_name: "  North Star  ", slug: "north_star" })).toEqual({
      legal_name: "North Star",
      slug: "north_star",
      is_sample: false,
      display_order: 100,
    });
  });

  it("rejects a key the register would refuse", () => {
    for (const slug of ["North_Star", "1north", "n", "no-dashes", "x".repeat(42), ""]) {
      expect(companyCreateSchema.safeParse({ ...base, slug }).success, slug).toBe(false);
    }
  });

  it("rejects an empty legal name and an absurd display order", () => {
    expect(companyCreateSchema.safeParse({ ...base, legal_name: "   " }).success).toBe(false);
    expect(companyCreateSchema.safeParse({ ...base, display_order: -1 }).success).toBe(false);
    expect(companyCreateSchema.safeParse({ ...base, display_order: 10_000 }).success).toBe(false);
  });
});
