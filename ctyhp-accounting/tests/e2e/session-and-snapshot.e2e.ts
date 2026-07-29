import { describe, expect, it } from "vitest";
import { closeE2eSession, openE2eSession } from "./support/session";
import { readSnapshot } from "./support/ledger-snapshot";

describe("e2e session", () => {
  it("signs in as an administrator and reads a balanced ledger snapshot", async () => {
    const { sb, userId, marker, today } = await openE2eSession();
    try {
      expect(userId).toMatch(/^[0-9a-f-]{36}$/);
      expect(marker).toContain("E2E-");

      const snapshot = await readSnapshot(sb, today);
      expect(snapshot.totalDebitMinor).toBe(snapshot.totalCreditMinor);
      expect(snapshot.journalLineCount).toBeGreaterThan(0);
      expect(snapshot.byAccount.size).toBeGreaterThan(0);
    } finally {
      await closeE2eSession(sb);
    }
  });
});
