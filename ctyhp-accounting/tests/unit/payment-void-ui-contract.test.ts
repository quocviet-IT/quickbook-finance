import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const route = join(process.cwd(), "app", "(app)", "payments");
const read = (file: string) => readFileSync(join(route, file), "utf8");

describe("payment void UI contract", () => {
  it("keeps financial forms in focused components", () => {
    expect(read("page.tsx")).toContain("listActors");
    expect(read("PaymentsClient.tsx")).toContain("<ReceivePaymentModal");
    expect(read("PaymentsClient.tsx")).toContain("<VoidPaymentModal");
    expect(read("ReceivePaymentModal.tsx")).toContain("Create replacement payment");
    expect(read("VoidPaymentModal.tsx")).toContain("voidPaymentAction");
  });

  it("exposes the approved actions and attribution copy", () => {
    const client = read("PaymentsClient.tsx");
    expect(client).toContain("Void payment");
    expect(client).toContain("Create replacement");
    expect(client).toContain("void_reason");
    expect(client).toContain("voided_by");
  });

  it("never offers to revive a void payment", () => {
    const client = read("PaymentsClient.tsx");
    expect(client).not.toMatch(/unvoid|un-void|reinstate/i);
    // A replacement is a new receipt through the ordinary posting path.
    expect(read("ReceivePaymentModal.tsx")).toContain("recordPaymentAction");
  });

  it("keeps every touched payment UI file below the 400-line ceiling", () => {
    for (const file of ["PaymentsClient.tsx", "ReceivePaymentModal.tsx", "VoidPaymentModal.tsx"]) {
      expect(read(file).split(/\r?\n/).length, file).toBeLessThanOrEqual(400);
    }
  });
});
