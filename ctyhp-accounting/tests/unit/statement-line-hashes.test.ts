import { describe, expect, it } from "vitest";
import { statementKeysAsSent, statementLineHash, statementLineHashes, statementRowHash } from "@/lib/domain/banking-import";

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

  it("leaves different lines, and the first line carrying the bank's own id, as they were", () => {
    const other = { ...fee, description: "WIRE FEE" };
    const withId = { ...fee, external_id: "2026120501" };
    expect(statementLineHashes("acct-1", [fee, other, withId])).toEqual([
      statementLineHash("acct-1", fee),
      statementLineHash("acct-1", other),
      statementRowHash(["acct-1", "fitid", "2026120501"]),
    ]);
  });

  it("keeps two lines of one file that carry the same bank id as two lines (2.04)", () => {
    // They collapsed to one before: the second was skipped as a duplicate of the first.
    const withId = { ...fee, external_id: "2026120501" };
    const [first, second, third] = statementLineHashes("acct-1", [withId, { ...withId }, { ...withId, description: "SERVICE FEE 2" }]);
    expect(first).toBe(statementRowHash(["acct-1", "fitid", "2026120501"]));
    expect(second).toBe(statementRowHash(["acct-1", "fitid", "2026120501", "#2"]));
    expect(second).toBe(statementLineHash("acct-1", withId, 2));
    // The bank's id is the key, whatever the words: a third line with that id is its third occurrence.
    expect(third).toBe(statementRowHash(["acct-1", "fitid", "2026120501", "#3"]));
  });

  it("counts a line with a bank id apart from an identical line without one", () => {
    const withId = { ...fee, external_id: "2026120501" };
    expect(statementLineHashes("acct-1", [fee, withId, { ...fee }])).toEqual([
      statementLineHash("acct-1", fee),
      statementLineHash("acct-1", withId),
      statementLineHash("acct-1", fee, 2),
    ]);
  });
});

describe("statementKeysAsSent", () => {
  it("counts over the lines sent, and gives a line marked Not a transaction no key", () => {
    const misread = { ...fee, amount_minor: -9900, description: "CHECK IMAGE" };
    const keys = statementKeysAsSent("acct-1", [fee, misread, { ...fee }], [1]);
    expect(keys).toEqual([statementLineHash("acct-1", fee), null, statementLineHash("acct-1", fee, 2)]);
  });

  it("gives the keys the import sends when nothing is marked", () => {
    const lines = [fee, { ...fee }, { ...fee, amount_minor: -700 }];
    expect(statementKeysAsSent("acct-1", lines)).toEqual(statementLineHashes("acct-1", lines));
  });
});
