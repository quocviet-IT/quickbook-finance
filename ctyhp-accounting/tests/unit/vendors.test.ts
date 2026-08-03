import { describe, expect, it } from "vitest";
import { createdVendorRow } from "@/lib/domain/vendors";

describe("createdVendorRow", () => {
  it("is active, so the picker that just created it still lists it", () => {
    // Recurring filters its vendor list on is_active. Default this wrong and the
    // vendor vanishes the instant it is created, and gets created again.
    expect(createdVendorRow("v-1", { name: "Kiln & Anvil Co." }).is_active).toBe(true);
  });

  it("carries the name and id the server returned", () => {
    const row = createdVendorRow("v-1", { name: "Pacific Stone Supply" });
    expect(row.id).toBe("v-1");
    expect(row.name).toBe("Pacific Stone Supply");
  });

  it("keeps the payment terms the vendor was created with", () => {
    // A bill snapshots these when it posts, so a vendor created mid-document
    // must carry them from the start rather than pick up a default later.
    const row = createdVendorRow("v-1", {
      name: "Kiln & Anvil Co.",
      payment_terms: "1/10 net 30",
      payment_terms_days: 30,
      discount_percent: 1,
      discount_days: 10,
    });
    expect(row.payment_terms).toBe("1/10 net 30");
    expect(row.payment_terms_days).toBe(30);
    expect(row.discount_percent).toBe(1);
    expect(row.discount_days).toBe(10);
  });

  it("stores an untouched contact field as null, not an empty string", () => {
    // The column is nullable and the rest of the app tests for null; "" would
    // read as "an email that is blank" rather than "no email on file".
    const row = createdVendorRow("v-1", { name: "Kiln & Anvil Co.", email: "", phone: "" });
    expect(row.email).toBeNull();
    expect(row.phone).toBeNull();
  });

  it("leaves terms null when none were entered", () => {
    const row = createdVendorRow("v-1", { name: "Kiln & Anvil Co." });
    expect(row.payment_terms).toBeNull();
    expect(row.payment_terms_days).toBeNull();
    expect(row.discount_percent).toBeNull();
    expect(row.discount_days).toBeNull();
  });
});
