import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { statementKeysAsSent, statementLineHash, statementLineHashes, statementRowHash } from "@/lib/domain/banking-import";
import { NO_WEB_CRYPTO, statementLineKeyTable } from "@/lib/client/statement-line-keys";
import {
  checkStatementLinesFrom,
  keysAsSentFrom,
  lineKeyTexts,
  rowKeyText,
  statementDays,
  statementLineKeyText,
  type LineKeyTable,
} from "@/lib/domain/statement-line-keys";
import { otherSourceLines, presentLines, repeatKey, type BankLineOn, type RepeatLine } from "@/lib/domain/statement-repeats";

/**
 * Which lines of a statement are already in Bank Transactions, worked out in
 * the browser (2.04): the dialog hashes the lines' keys once per statement
 * read, reads the account's bank lines once, and answers every Not a
 * transaction tick from them. Every key must be the one the import sends, and
 * every answer the one the server's own rule gives. Invented data throughout.
 */
const ACCOUNT = "acct-keys";
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

const line = (
  txn_date: string,
  amount_minor: number,
  description = "EXAMPLE PAYROLL SERVICE",
  reference: string | null = null,
  external_id: string | null = null,
): RepeatLine => ({ txn_date, amount_minor, description, reference, external_id });

/**
 * An invented file: three identical payroll lines and two identical fees, out
 * of order; a line in words outside ASCII; two lines carrying one bank id on
 * different days; and a line whose words hold half a surrogate pair, as a
 * badly encoded file can.
 */
const FILE: RepeatLine[] = [
  line("2026-03-31", -41230),
  line("2026-03-31", -1500, "EXAMPLE FEE"),
  line("2026-03-31", -41230),
  line("2026-03-15", 250000, "DÉPÔT CAFÉ ☕ EXEMPLE", "REF-7"),
  line("2026-03-31", -1500, "EXAMPLE FEE"),
  line("2026-03-20", -999, "WIRE", null, "FIT-0001"),
  line("2026-03-21", -999, "WIRE AGAIN", null, "FIT-0001"),
  line("2026-03-02", -100, "BROKEN \uD800 TEXT"),
  line("2026-03-31", -41230),
];

/** The table as the server would work it out: node:crypto over the same texts. */
const serverTable = (lines: readonly RepeatLine[]): LineKeyTable =>
  new Map(lineKeyTexts(ACCOUNT, lines).map(({ key, texts }) => [key, texts.map(sha256)]));

/** Every set of indexes of a file of n lines: each way its lines can be ticked Not a transaction. */
const everyTick = (n: number): number[][] =>
  Array.from({ length: 2 ** n }, (_, mask) => Array.from({ length: n }, (_, i) => i).filter((i) => mask & (1 << i)));

const bankLine = (id: string, txnDate: string, amountMinor: number, rawHash: string, sourceKind: BankLineOn["sourceKind"]): BankLineOn => ({
  id,
  txnDate,
  amountMinor,
  rawHash,
  sourceKind,
  importBatchId: sourceKind === "import" ? "batch-old" : null,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("statementLineKeyText", () => {
  it("is the text the import's key is a hash of, for every occurrence", () => {
    for (const l of FILE) {
      for (const occurrence of [1, 2, 3]) {
        expect(sha256(statementLineKeyText(ACCOUNT, l, occurrence))).toBe(statementLineHash(ACCOUNT, l, occurrence));
      }
    }
    expect(statementLineKeyText(ACCOUNT, FILE[0])).toBe("acct-keys|2026-03-31|-41230|EXAMPLE PAYROLL SERVICE|");
    expect(statementLineKeyText(ACCOUNT, FILE[0], 2)).toBe("acct-keys|2026-03-31|-41230|EXAMPLE PAYROLL SERVICE||#2");
    expect(statementLineKeyText(ACCOUNT, FILE[5], 2)).toBe("acct-keys|fitid|FIT-0001|#2");
  });

  it("joins a row's parts as statementRowHash always has, a missing part as empty", () => {
    const parts = ["acct-keys", "2026-03-31", -41230, null, undefined, "REF"];
    expect(rowKeyText(parts)).toBe("acct-keys|2026-03-31|-41230|||REF");
    expect(sha256(rowKeyText(parts))).toBe(statementRowHash(parts));
  });
});

describe("lineKeyTexts", () => {
  it("gives each set of identical lines one text per line, its 1st, 2nd, … occurrence", () => {
    const sets = lineKeyTexts(ACCOUNT, FILE);
    expect(sets.reduce((n, set) => n + set.texts.length, 0)).toBe(FILE.length);
    expect(sets.map((set) => [set.key, set.texts.length])).toEqual([
      [repeatKey(FILE[0]), 3],
      [repeatKey(FILE[1]), 2],
      [repeatKey(FILE[3]), 1],
      [repeatKey(FILE[5]), 2],
      [repeatKey(FILE[7]), 1],
    ]);
    // Two lines with the bank's own id are one set, whatever their dates and words.
    expect(sets[3].texts).toEqual([statementLineKeyText(ACCOUNT, FILE[6], 1), statementLineKeyText(ACCOUNT, FILE[6], 2)]);
  });
});

describe("statementLineKeyTable: the keys hashed in the browser", () => {
  it("are the keys the import sends: Web Crypto gives what node:crypto gives, words outside ASCII and half a surrogate pair included", async () => {
    const table = await statementLineKeyTable(ACCOUNT, FILE);
    expect(table).toEqual(serverTable(FILE));
    expect(keysAsSentFrom(FILE, [], table)).toEqual(statementLineHashes(ACCOUNT, FILE));
  });

  it("are refused, saying why, by a browser without Web Crypto", async () => {
    vi.stubGlobal("crypto", undefined);
    await expect(statementLineKeyTable(ACCOUNT, FILE)).rejects.toThrow(NO_WEB_CRYPTO);
  });
});

describe("keysAsSentFrom: the adapter", () => {
  const table = serverTable(FILE);

  it("gives the keys statementKeysAsSent gives, whatever is ticked Not a transaction", () => {
    for (const aside of everyTick(FILE.length)) {
      expect(keysAsSentFrom(FILE, aside, table), `aside ${aside.join(",")}`).toEqual(statementKeysAsSent(ACCOUNT, FILE, aside));
    }
  });

  it("moves the key of an identical line after a ticked one, as the import counts them", () => {
    const keys = keysAsSentFrom(FILE, [0], table);
    expect(keys[0]).toBeNull();
    expect(keys[2]).toBe(statementLineHash(ACCOUNT, FILE[2], 1));
    expect(keys[8]).toBe(statementLineHash(ACCOUNT, FILE[8], 2));
  });

  it("throws for a line its table was not worked out for", () => {
    expect(() => keysAsSentFrom([...FILE, line("2026-03-31", -7, "NOT READ")], [], table)).toThrow(
      "No key was worked out for line 10 of this statement",
    );
    // Nor for one more identical line than the file had.
    expect(() => keysAsSentFrom([...FILE, FILE[0]], [], table)).toThrow("line 10");
  });
});

describe("checkStatementLinesFrom", () => {
  const table = serverTable(FILE);
  const bankLines: BankLineOn[] = [
    // The first payroll line, already here from an earlier statement.
    bankLine("b1", "2026-03-31", -41230, statementLineHash(ACCOUNT, FILE[0]), "import"),
    // A payroll line made from the books, and a fee from a bank feed.
    bankLine("b2", "2026-03-31", -41230, "ledger:entry-line-1", "books"),
    bankLine("b3", "2026-03-31", -1500, "feed-3", "feed"),
    // The second line carrying the bank's id, imported before.
    bankLine("b4", "2026-03-21", -999, statementLineHash(ACCOUNT, FILE[6], 2), "import"),
  ];

  it("answers every tick as the server's own rule answers it", () => {
    for (const aside of everyTick(FILE.length)) {
      const hashes = statementKeysAsSent(ACCOUNT, FILE, aside);
      expect(checkStatementLinesFrom(FILE, aside, { keys: table, bankLines }), `aside ${aside.join(",")}`).toEqual({
        present: presentLines(hashes, bankLines),
        otherSource: otherSourceLines(FILE, hashes, bankLines),
      });
    }
  });

  it("says which lines are already here from this statement and which from another source", () => {
    expect(checkStatementLinesFrom(FILE, [], { keys: table, bankLines })).toEqual({
      present: [0, 6],
      otherSource: [
        { index: 1, source: "feed", bankLineId: "b3" },
        { index: 2, source: "books", bankLineId: "b2" },
      ],
    });
  });
});

describe("statementDays", () => {
  it("is the first and last day of the lines, in whatever order they were read", () => {
    expect(statementDays(FILE)).toEqual({ from: "2026-03-02", to: "2026-03-31" });
    expect(statementDays([line("2026-04-01", 1)])).toEqual({ from: "2026-04-01", to: "2026-04-01" });
    expect(statementDays([])).toBeNull();
  });
});
