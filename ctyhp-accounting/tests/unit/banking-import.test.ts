import { describe, expect, it } from "vitest";
import { statementRowHash } from "@/lib/domain/banking-import";

describe("bank statement import hashing", () => {
  it("uses a deterministic SHA-256 digest for immutable-row deduplication", () => {
    const parts = [
      "bank-account-id",
      "2026-07-28",
      -125_00,
      "JEWELRY SUPPLIER",
      "INV-2048",
    ];

    const digest = statementRowHash(parts);

    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(statementRowHash(parts)).toBe(digest);
    expect(statementRowHash([...parts, "changed"])).not.toBe(digest);
  });
});
