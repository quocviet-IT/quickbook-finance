import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { statementDocType, statementFootnote, statementPayNote } from "@/lib/domain/party-statement";

describe("statementDocType", () => {
  it("names every kind of line the statements carry, the new ones included", () => {
    expect(["invoice", "payment", "credit_memo", "refund", "write_off"].map(statementDocType)).toEqual([
      "Invoice",
      "Payment",
      "Credit memo",
      "Refund",
      "Write-off",
    ]);
    expect(["bill", "bill_payment", "vendor_credit", "discount"].map(statementDocType)).toEqual([
      "Bill",
      "Bill payment",
      "Vendor credit",
      "Early payment discount",
    ]);
  });
  it("still reads a kind it does not name as words", () => {
    expect(statementDocType("deposit_applied")).not.toContain("_");
  });
});

describe("statementPayNote (2.87)", () => {
  it("asks a customer who owes, and nobody else", () => {
    expect(statementPayNote("customer", 4_000, "  Checks payable to Example Jewelry LLC.  ")).toBe("Checks payable to Example Jewelry LLC.");
    expect(statementPayNote("customer", 0, "Wire only")).toBeNull();
    expect(statementPayNote("customer", -500, "Wire only")).toBeNull();
    expect(statementPayNote("vendor", 4_000, "Wire only")).toBeNull();
    expect(statementPayNote("customer", 4_000, "   ")).toBeNull();
    expect(statementPayNote("customer", 4_000, null)).toBeNull();
  });
  it("is what the statement shows", () => {
    const body = readFileSync(join(process.cwd(), "components/reports/StatementBody.tsx"), "utf8");
    expect(body).toContain("statementPayNote(kind, data.report.closingMinor, payNote)");
  });
});

describe("statementFootnote", () => {
  it("says what the opening is, for each side, and promises nothing later", () => {
    const customer = statementFootnote("customer");
    expect(customer).toContain("invoices and refunds, less payments, credit memos and write-offs");
    expect(statementFootnote("vendor")).toContain("early payment discounts");
    expect(customer).toContain("closing balance is what was owed on the last day");
    expect(customer).not.toMatch(/later enhancement|current open items/);
  });
  it("is what the statement prints, in place of the old note", () => {
    const body = readFileSync(join(process.cwd(), "components/reports/StatementBody.tsx"), "utf8");
    expect(body).toContain("statementFootnote(kind)");
    expect(body).not.toContain("a later enhancement");
  });
});
