import { describe, expect, it } from "vitest";
import { APP_VERSION, RELEASES } from "@/lib/domain/changelog";

describe("the credit card release in the release notes", () => {
  const release = RELEASES.find((r) => r.changes.some((c) => c.title === "Credit cards in Bank Transactions and Bank Reconciliation"))!;
  const said = release.changes.map((c) => `${c.title} ${c.detail ?? ""}`).join(" ");

  it("is listed, dated the day it was built, and newer releases sit above it", () => {
    expect(release).toBeDefined();
    expect(Number(APP_VERSION)).toBeGreaterThanOrEqual(Number(release.version));
    expect(release.date).toBe("2026-10-23");
  });

  it("says how a card is set up, imported, matched and reconciled, and what it does not read yet", () => {
    for (const words of [
      "offers Credit card as a kind of account",
      "a charge negative, a payment positive",
      "never coded twice",
      "the balance owed and charges positive, payments and credits negative",
      "never flagged as below zero",
      "PDF statements are not read yet",
      "Reconcile from statement files is not offered",
    ]) {
      expect(said).toContain(words);
    }
  });
});
