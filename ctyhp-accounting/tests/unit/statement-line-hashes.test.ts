import { describe, expect, it } from "vitest";
import { statementLineHash, statementLineHashes } from "@/lib/domain/banking-import";

const fee = { txn_date: "2026-12-05", amount_minor: -500, description: "SERVICE FEE", reference: null };

describe("statementLineHashes", () => {
  it("keeps the first line's key as it always was, and gives a repeat in the same file its own", () => {
    const [first, second] = statementLineHashes("acct-1", [fee, { ...fee }]);
    expect(first).toBe(statementLineHash("acct-1", fee));
    expect(second).toBe(statementLineHash("acct-1", fee, 2));
    expect(second).not.toBe(first);
  });

  it("gives the same keys to the same file read twice, so a second import adds nothing", () => {
    const lines = [fee, { ...fee }, { ...fee, amount_minor: -700 }];
    expect(statementLineHashes("acct-1", lines)).toEqual(statementLineHashes("acct-1", lines));
  });

  it("leaves different lines, and lines carrying the bank's own id, as they were", () => {
    const other = { ...fee, description: "WIRE FEE" };
    const withId = { ...fee, external_id: "2026120501" };
    expect(statementLineHashes("acct-1", [fee, other, withId, { ...withId }])).toEqual([
      statementLineHash("acct-1", fee),
      statementLineHash("acct-1", other),
      statementLineHash("acct-1", withId),
      statementLineHash("acct-1", withId),
    ]);
  });
});
