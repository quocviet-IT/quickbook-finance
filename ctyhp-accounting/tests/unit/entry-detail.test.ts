import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  entryDisplayName,
  entryHeadline,
  entryTotals,
  sourceLabel,
  sourceTone,
} from "@/lib/domain/entry-detail";

describe("sourceLabel", () => {
  it("names every kind of entry the ledger records", () => {
    expect(sourceLabel("manual")).toBe("Journal");
    expect(sourceLabel("bank")).toBe("Bank");
    expect(sourceLabel("bill_payment")).toBe("Bill payment");
    expect(sourceLabel("opening_balance")).toBe("Opening");
  });

  it("still reads sensibly for a kind added after this list", () => {
    expect(sourceLabel("stock_count")).toBe("Stock count");
  });
});

describe("sourceTone", () => {
  it("puts sales, purchases, cash and plain journals on four different tints", () => {
    expect(sourceTone("invoice")).toBe("sales");
    expect(sourceTone("payment")).toBe("sales");
    expect(sourceTone("bill")).toBe("purchases");
    expect(sourceTone("expense")).toBe("purchases");
    expect(sourceTone("bank")).toBe("cash");
    expect(sourceTone("manual")).toBe("ledger");
    expect(sourceTone("depreciation")).toBe("ledger");
  });
});

describe("entryHeadline", () => {
  it("leads with the customer or vendor and puts the description under it", () => {
    expect(entryHeadline({ party: "Harbor Cafe", description: "Invoice INV-000014", entryNumber: "JE-000071" })).toEqual({
      payee: "Harbor Cafe",
      narration: "Invoice INV-000014",
    });
  });

  it("leads with the bank's own text when a line has no customer or vendor", () => {
    expect(entryHeadline({ party: null, description: "ZELLE FROM HARBOR CAFE", entryNumber: "JE-000090" })).toEqual({
      payee: "ZELLE FROM HARBOR CAFE",
      narration: null,
    });
  });

  it("falls back to the entry number when there is nothing else to name it by", () => {
    expect(entryHeadline({ party: null, description: "  ", entryNumber: "JE-000090" }).payee).toBe("JE-000090");
  });
});

describe("entryTotals", () => {
  it("adds each side and reports the gap between them", () => {
    expect(
      entryTotals([
        { debitMinor: 120_00, creditMinor: 0 },
        { debitMinor: 0, creditMinor: 100_00 },
        { debitMinor: 0, creditMinor: 20_00 },
      ]),
    ).toEqual({ debitMinor: 120_00, creditMinor: 120_00, differenceMinor: 0 });
    expect(entryTotals([{ debitMinor: 5_00, creditMinor: 0 }]).differenceMinor).toBe(5_00);
  });
});

describe("entryDisplayName", () => {
  it("uses the party, else the description, never a dash", () => {
    expect(entryDisplayName({ partyName: "Harbor Cafe", description: "x" })).toBe("Harbor Cafe");
    expect(entryDisplayName({ partyName: null, description: "ZELLE FROM HARBOR CAFE" })).toBe("ZELLE FROM HARBOR CAFE");
    expect(entryDisplayName({ partyName: null, description: null })).toBe("");
  });
});

describe("the entry detail modules", () => {
  it("keep the domain pure and the service read-only", () => {
    expect(readFileSync("lib/domain/entry-detail.ts", "utf8")).not.toMatch(/@\/lib\/(db|services)\//);
    const service = readFileSync("lib/services/entry-detail.ts", "utf8");
    expect(service).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    // The only RPC it may reach is the read-only transaction list, through reports.ts.
    expect(service).not.toMatch(/\.rpc\(/);
  });
});
