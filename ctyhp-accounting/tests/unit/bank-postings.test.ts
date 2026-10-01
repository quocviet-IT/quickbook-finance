import { describe, expect, it } from "vitest";
import { postingsByLine } from "@/lib/domain/bank-postings";

const row = (txn: string, code: string, name: string) => ({ bank_transaction_id: txn, account_code: code, account_name: name, entry_number: "JE-1" });

describe("postingsByLine", () => {
  it("keeps one posting per line, the lowest account code first, with the others named", () => {
    const map = postingsByLine([row("t1", "8100", "Interest Expense"), row("t1", "2500", "Example Loan"), row("t2", "6100", "Rent")]);
    expect(map.get("t1")).toMatchObject({ account_code: "2500", account_name: "Example Loan", others: ["8100 — Interest Expense"] });
    expect(map.get("t2")).toMatchObject({ account_code: "6100", others: [] });
  });
  it("names an account once, however many lines post to it", () => {
    const map = postingsByLine([row("t1", "4000", "Sales"), row("t1", "4000", "Sales"), row("t1", "4100", "Other Sales")]);
    expect(map.get("t1")?.others).toEqual(["4100 — Other Sales"]);
  });
  it("puts the lower account number first, whatever its width", () => {
    const map = postingsByLine([row("t1", "1000", "Loan"), row("t1", "410", "Interest")]);
    expect(map.get("t1")).toMatchObject({ account_code: "410", account_name: "Interest", others: ["1000 — Loan"] });
  });
});
