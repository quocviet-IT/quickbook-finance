import { describe, expect, it } from "vitest";
import { closeE2eSession, openE2eSession } from "./support/session";
import { sweepMarker } from "./support/cleanup";

describe("marker sweep", () => {
  it("removes a marked customer and reports what it deleted", async () => {
    const { sb, marker } = await openE2eSession();
    try {
      const { error } = await sb
        .from("acc_customer")
        .insert({ name: marker, currency_code: "USD" });
      expect(error).toBeNull();

      const first = await sweepMarker(sb, marker);
      expect(first.customers).toBe(1);

      const second = await sweepMarker(sb, marker);
      expect(second).toEqual({ invoices: 0, customers: 0 });
    } finally {
      await closeE2eSession(sb);
    }
  });
});
