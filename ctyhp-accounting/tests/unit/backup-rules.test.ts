import { describe, expect, it } from "vitest";
import { buildManifest } from "@/lib/domain/company-export";
import {
  expiredBackups,
  restoreCompatibility,
  shouldSkip,
  snapshotDescription,
  snapshotHash,
} from "@/lib/domain/backup";

describe("what a manifest is reduced to before hashing", () => {
  it("keeps only each file's path and content hash", () => {
    const manifest = {
      files: [
        { path: "data/acc_account.csv", sha256: "aa" },
        { path: "data/acc_journal_line.csv", sha256: "bb" },
      ],
    };
    expect(snapshotDescription(manifest)).toEqual({
      "data/acc_account.csv": "aa",
      "data/acc_journal_line.csv": "bb",
    });
  });
});

describe("the hash that decides whether a night is worth keeping", () => {
  it("is the same for the same files, whatever order they are given in", async () => {
    // Stability is the whole point: if the hash moves on its own, every night
    // writes a new snapshot while the code believes it is comparing them.
    const a = await snapshotHash({
      "data/acc_account.csv": "aa",
      "data/acc_journal_line.csv": "bb",
    });
    const b = await snapshotHash({
      "data/acc_journal_line.csv": "bb",
      "data/acc_account.csv": "aa",
    });
    expect(a).toBe(b);
  });

  it("changes when any one file changes", async () => {
    const before = await snapshotHash({ "data/acc_account.csv": "aa" });
    const after = await snapshotHash({ "data/acc_account.csv": "ab" });
    expect(after).not.toBe(before);
  });

  it("changes when a file is added, not only when one is edited", async () => {
    const before = await snapshotHash({ "data/acc_account.csv": "aa" });
    const after = await snapshotHash({
      "data/acc_account.csv": "aa",
      "data/acc_item.csv": "cc",
    });
    expect(after).not.toBe(before);
  });

  it("is the same across two exports of unchanged books, even though the manifest's timestamp and actor differ", async () => {
    // This is the property the skip rule above depends on. If `generatedAt`
    // or `generatedBy` leaked into the hash, no two nightly runs would ever
    // match, even over books nobody touched, and every night would write a
    // snapshot — the exact failure `shouldSkip` exists to prevent.
    const manifestOf = (generatedAt: string, actorEmail: string) =>
      JSON.parse(
        buildManifest({
          datasets: [],
          files: [
            { path: "data/acc_account.csv", sha256: "aa", rowCount: 1 },
            { path: "data/acc_journal_line.csv", sha256: "bb", rowCount: 2 },
          ],
          totals: {
            trialBalanceDebitMinor: 24_625_360,
            trialBalanceCreditMinor: 24_625_360,
            arTotalMinor: 850_548,
            apTotalMinor: 1_586_500,
            journalLineCount: 120,
          },
          controlTotalsAsOf: "2026-08-14",
          schemaVersion: "0111_x.sql",
          generatedAt,
          actorEmail,
        }),
      ) as { files: Array<{ path: string; sha256: string }> };

    const tonight = manifestOf("2026-08-15T02:00:00.000Z", "cron@ctyhp.example");
    const lastNight = manifestOf("2026-08-14T02:00:00.000Z", "someone-else@ctyhp.example");

    // Whole manifests, not a hand-picked `{path: sha256}` object — the
    // exclusion of `generatedAt`/`generatedBy` has to happen inside
    // `snapshotDescription` for this test to mean anything. A test-local
    // helper that already stripped them would make this pass no matter what
    // `snapshotDescription` did.
    expect(await snapshotHash(snapshotDescription(tonight))).toBe(
      await snapshotHash(snapshotDescription(lastNight)),
    );
  });
});

describe("deciding whether to write tonight's snapshot", () => {
  it("skips when the books are byte-for-byte what they were", () => {
    expect(shouldSkip("abc", "abc")).toBe(true);
  });

  it("writes when they are not", () => {
    expect(shouldSkip("abc", "abd")).toBe(false);
  });

  it("writes when there is nothing to compare with", () => {
    // The first snapshot a company ever takes has no predecessor, and skipping
    // it would leave the company with none at all.
    expect(shouldSkip("abc", null)).toBe(false);
  });
});

describe("choosing what retention deletes", () => {
  const made = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `b${i}`,
      takenAt: `2026-08-${String(i + 1).padStart(2, "0")}`,
    }));

  it("keeps the newest and returns the rest", () => {
    const expired = expiredBackups(made(33), 30);
    expect(expired.map((b) => b.id)).toEqual(["b0", "b1", "b2"]);
  });

  it("returns nothing at exactly the limit", () => {
    // The boundary that decides whether a company loses its oldest snapshot one
    // night early.
    expect(expiredBackups(made(30), 30)).toEqual([]);
  });

  it("returns nothing below the limit", () => {
    expect(expiredBackups(made(4), 30)).toEqual([]);
  });

  it("orders by when it was taken, not by the order it was handed", () => {
    const shuffled = [made(3)[2], made(3)[0], made(3)[1]];
    expect(expiredBackups(shuffled, 2).map((b) => b.id)).toEqual(["b0"]);
  });

  it("breaks a tie in takenAt by id, not by input order", () => {
    // `sort` is stable, so two snapshots sharing a `takenAt` would otherwise
    // be deleted in whatever order the caller's query happened to return
    // them in — database query order, not a decision. Handed in both
    // orderings here so a stability-only implementation can't pass by luck.
    const tied = [
      { id: "b1", takenAt: "2026-08-10" },
      { id: "b2", takenAt: "2026-08-10" },
    ];
    expect(expiredBackups(tied, 1).map((b) => b.id)).toEqual(["b1"]);
    expect(expiredBackups([...tied].reverse(), 1).map((b) => b.id)).toEqual(["b1"]);
  });
});

describe("whether a snapshot can be loaded by this code", () => {
  it("loads one taken on the same schema", () => {
    expect(restoreCompatibility("0111_x.sql", "0111_x.sql")).toBe("ok");
  });

  it("loads an older one, because columns added since take their defaults", () => {
    expect(restoreCompatibility("0090_x.sql", "0111_x.sql")).toBe("ok");
  });

  it("refuses one newer than the code reading it", () => {
    // A newer snapshot holds columns this code does not know about. Loading it
    // anyway drops them in silence, which is the one outcome worth refusing.
    expect(restoreCompatibility("0120_x.sql", "0111_x.sql")).toBe("snapshot-is-newer");
  });

  it("refuses when the snapshot does not say what it was taken on", () => {
    expect(restoreCompatibility("unknown", "0111_x.sql")).toBe("snapshot-is-newer");
  });
});
