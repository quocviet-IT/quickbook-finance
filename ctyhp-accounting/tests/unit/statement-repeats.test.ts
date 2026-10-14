import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseCsv } from "@/lib/csv";
import { statementLineHashes } from "@/lib/domain/banking-import";
import { readPdfStatements, toStatementLines } from "@/lib/domain/pdf-statement";
import { parseOfx, parseQif } from "@/lib/domain/statement-files";
import { parseStatementRows, type StatementLine } from "@/lib/domain/statement-import";
import {
  fileFigures,
  pdfFigures,
  proofPayload,
  proveStatement,
  statementImportRows,
  type StatementProof,
} from "@/lib/domain/statement-proof";
import {
  OTHER_SOURCE_WARNING,
  describeRepeats,
  importedSummary,
  otherSourceLines,
  presentLines,
  repeatKey,
  type BankLineOn,
  type BankLineSource,
} from "@/lib/domain/statement-repeats";
import { checkStatementLines, importStatement } from "@/lib/services/banking";
import { PAYROLL_REPEATS, glyphsOf } from "../fixtures/pdf-statements";

/**
 * OB-1 (2.04): genuine repeated lines are kept, said, and recognised when they
 * are already in Bank Transactions — from this statement or from another
 * source. Every bank, name, date and amount here is invented.
 */
const money = (minor: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(minor / 100);
const ACCOUNT = "acct-ob1";

// --- A stand-in for the database ---------------------------------------------

interface StoredLine {
  id: string;
  txn_date: string;
  amount_minor: number;
  raw_hash: string;
  source_kind: BankLineSource;
  import_batch_id: string | null;
}

/**
 * Bank Transactions for one account, as 0143 serves it: the proved import
 * inserts each row not marked skip unless its key is already there (the unique
 * index on the account and the key), refuses a statement that does not add up
 * without an override, and `acc_bank_lines_on` pages its lines by date then id.
 */
function fakeBank(cap = 1000) {
  const stored: StoredLine[] = [];
  const imports: Record<string, unknown>[] = [];
  /** One per page asked for: what it was asked with, its order, and its range. */
  const reads: { args: Record<string, unknown>; orders: string[]; range: [number, number] | null }[] = [];
  let next = 0;
  const id = () => `line-${String(++next).padStart(6, "0")}`;
  const add = (line: Omit<StoredLine, "id">) => stored.push({ id: id(), ...line });

  const sb = {
    rpc(fn: string, args: Record<string, unknown>) {
      if (fn === "acc_import_bank_statement_proved") {
        imports.push(args);
        const rows = args.p_rows as { txn_date: string; amount_minor: number; raw_hash: string; skip?: boolean }[];
        const proof = args.p_proof as { opening_minor: number; closing_minor: number; override: unknown };
        const out = proof.opening_minor + rows.reduce((sum, r) => sum + r.amount_minor, 0) - proof.closing_minor;
        if (out !== 0 && !proof.override) {
          return Promise.resolve({ data: null, error: { message: `The statement does not add up: out by ${Math.abs(out) / 100}` } });
        }
        const toImport = rows.filter((r) => r.skip !== true);
        if (!toImport.length) return Promise.resolve({ data: [{ inserted: 0, skipped: 0, batch_id: null }], error: null });
        const batch = `batch-${imports.length}`;
        let inserted = 0;
        let skipped = 0;
        for (const r of toImport) {
          if (stored.some((s) => s.raw_hash === r.raw_hash)) skipped += 1;
          else {
            add({ txn_date: r.txn_date, amount_minor: r.amount_minor, raw_hash: r.raw_hash, source_kind: "import", import_batch_id: batch });
            inserted += 1;
          }
        }
        return Promise.resolve({ data: [{ inserted, skipped, batch_id: batch }], error: null });
      }
      if (fn === "acc_bank_lines_on") {
        const read = { args, orders: [] as string[], range: null as [number, number] | null };
        reads.push(read);
        const rows = stored
          .filter((s) => s.txn_date >= (args.p_from as string) && s.txn_date <= (args.p_to as string))
          .sort((a, b) => (a.txn_date < b.txn_date ? -1 : a.txn_date > b.txn_date ? 1 : a.id < b.id ? -1 : 1));
        const chain = {
          order(column: string) {
            read.orders.push(column);
            return chain;
          },
          range(from: number, to: number) {
            read.range = [from, to];
            return Promise.resolve({ data: rows.slice(from, from + Math.min(to - from + 1, cap)), error: null });
          },
          // Awaited without a range, PostgREST answers with its first page and says nothing.
          then(resolve: (value: unknown) => unknown) {
            return resolve({ data: rows.slice(0, cap), error: null });
          },
        };
        return chain;
      }
      throw new Error(`unexpected rpc ${fn}`);
    },
  } as unknown as SupabaseClient;
  return { sb, stored, imports, reads, add };
}

/** One import as the dialog does it: check the lines, skip those already here from another source, import with the proof. */
async function importAsTheDialogDoes(bank: ReturnType<typeof fakeBank>, rows: StatementLine[], proof: StatementProof) {
  const check = await checkStatementLines(bank.sb, ACCOUNT, rows);
  const skip = check.otherSource.map((line) => line.index);
  const repeats = describeRepeats(rows, [], check.present, skip, money);
  const result = await importStatement(bank.sb, ACCOUNT, "payroll.file", statementImportRows(rows, [], skip), proofPayload(proof));
  const summary = importedSummary({ inserted: result.inserted, alreadyHere: result.skipped, otherSource: result.otherSource, repeats });
  return { check, repeats, result, summary };
}

// --- The five payroll-shaped files: 2 + 3 identical lines on one day ----------

const PRIOR = { date: "2026-02-28", endingMinor: 2000000 };
const PAYROLL = [-65520, -65520, -41230, -41230, -41230];

const csvFile = (): { rows: StatementLine[]; proof: StatementProof } => {
  let balance = 2000000;
  const text = [
    "Date,Description,Amount,Balance",
    ...PAYROLL.map((amount) => {
      balance += amount;
      return `03/31/2026,EXAMPLE PAYROLL SERVICE,${(amount / 100).toFixed(2)},${(balance / 100).toFixed(2)}`;
    }),
  ].join("\n");
  const rows = parseStatementRows(parseCsv(text)).rows;
  return { rows, proof: proveStatement({ kind: "csv", lines: rows }, money) };
};

const pdfFile = () => {
  const [statement] = readPdfStatements(glyphsOf(PAYROLL_REPEATS));
  const rows = toStatementLines(statement);
  return { rows, proof: proveStatement({ kind: "pdf", lines: rows, figures: pdfFigures(statement) }, money) };
};

const ofxText = (fitids: (string | null)[]) => `OFXHEADER:100
DATA:OFXSGML
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKACCTFROM><BANKID>000000000<ACCTID>00003333<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20260301
<DTEND>20260331
${PAYROLL.map(
  (amount, i) =>
    `<STMTTRN>\n<TRNTYPE>DEBIT\n<DTPOSTED>20260331\n<TRNAMT>${(amount / 100).toFixed(2)}\n` +
    `${fitids[i] ? `<FITID>${fitids[i]}\n` : ""}<NAME>EXAMPLE PAYROLL SERVICE\n</STMTTRN>`,
).join("\n")}
</BANKTRANLIST>
<LEDGERBAL><BALAMT>17452.70<DTASOF>20260331</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

const ofxFile = (fitids: (string | null)[]) => {
  const read = parseOfx(ofxText(fitids));
  return { rows: read.rows, proof: proveStatement({ kind: "ofx", lines: read.rows, figures: fileFigures(read), prior: PRIOR }, money) };
};

const qifFile = () => {
  const text = [
    "!Type:Bank",
    "D3/1'26",
    "T20,000.00",
    "POpening Balance",
    "^",
    ...PAYROLL.flatMap((amount) => ["D3/31'26", `T${(amount / 100).toFixed(2)}`, "PEXAMPLE PAYROLL SERVICE", "^"]),
  ].join("\n");
  const read = parseQif(text);
  return { rows: read.rows, proof: proveStatement({ kind: "qif", lines: read.rows, figures: fileFigures(read), typedClosingMinor: 1745270 }, money) };
};

const FILES: [string, () => { rows: StatementLine[]; proof: StatementProof }][] = [
  ["CSV", csvFile],
  ["PDF (glyphs)", pdfFile],
  ["OFX without FITID", () => ofxFile([null, null, null, null, null])],
  ["OFX with a repeated FITID", () => ofxFile(["PAY-0331-A", "PAY-0331-A", "PAY-0331-B", "PAY-0331-B", "PAY-0331-B"])],
  ["QIF", qifFile],
];

describe.each(FILES)("payroll in a %s file: 2 + 3 identical lines on one day", (_name, read) => {
  it("reads all five lines, and the statement adds up", () => {
    const { rows, proof } = read();
    expect(rows.map((r) => [r.txn_date, r.amount_minor])).toEqual(PAYROLL.map((amount) => ["2026-03-31", amount]));
    expect(proof).toMatchObject({ proves: true, openingMinor: 2000000, closingMinor: 1745270 });
  });

  it("imports all five into an account that has none, and says the repeats are kept", async () => {
    const bank = fakeBank();
    const { rows, proof } = read();
    const { check, repeats, result, summary } = await importAsTheDialogDoes(bank, rows, proof);
    expect(check).toEqual({ present: [], otherSource: [] });
    expect(repeats.map((g) => g.text)).toEqual([
      "2 identical lines on Mar 31, 2026 (−655.20): 2 will be imported.",
      "3 identical lines on Mar 31, 2026 (−412.30): 3 will be imported.",
    ]);
    expect(result).toMatchObject({ inserted: 5, skipped: 0, otherSource: 0 });
    expect(bank.stored).toHaveLength(5);
    expect(summary).toBe("Imported 5 lines. 5 repeated lines on Mar 31 kept.");
  });

  it("imports two of three identical lines when one is already present", async () => {
    const bank = fakeBank();
    const { rows, proof } = read();
    // An earlier statement that held one of the three: its key is the first copy's.
    const first = statementLineHashes(ACCOUNT, rows)[2];
    bank.add({ txn_date: "2026-03-31", amount_minor: -41230, raw_hash: first, source_kind: "import", import_batch_id: "batch-old" });
    const { check, repeats, result, summary } = await importAsTheDialogDoes(bank, rows, proof);
    expect(check).toEqual({ present: [2], otherSource: [] });
    expect(repeats[1]).toMatchObject({ identical: 3, alreadyPresent: 1, otherSource: 0, toImport: 2 });
    expect(repeats[1].text).toBe("3 identical lines on Mar 31, 2026 (−412.30): 1 already in Bank Transactions, 2 will be imported.");
    expect(result).toMatchObject({ inserted: 4, skipped: 1 });
    expect(bank.stored.filter((s) => s.amount_minor === -41230)).toHaveLength(3);
    expect(summary).toBe("Imported 4 lines. 1 was already here from this statement; 4 repeated lines on Mar 31 kept.");
  });

  it("imports nothing when the same file is imported again", async () => {
    const bank = fakeBank();
    const { rows, proof } = read();
    await importAsTheDialogDoes(bank, rows, proof);
    const again = await importAsTheDialogDoes(bank, rows, proof);
    expect(again.check).toEqual({ present: [0, 1, 2, 3, 4], otherSource: [] });
    expect(again.repeats.map((g) => g.text)).toEqual([
      "2 identical lines on Mar 31, 2026 (−655.20): 2 already in Bank Transactions, none will be imported.",
      "3 identical lines on Mar 31, 2026 (−412.30): 3 already in Bank Transactions, none will be imported.",
    ]);
    expect(again.result).toMatchObject({ inserted: 0, skipped: 5 });
    expect(bank.stored).toHaveLength(5);
    expect(again.summary).toBe("Imported 0 lines. 5 were already here from this statement.");
  });
});

describe("lines already in Bank Transactions from another source", () => {
  it("are skipped by default, still count in the proof, and are said after the import", async () => {
    const bank = fakeBank();
    const { rows, proof } = csvFile();
    // The books already hold two of the payroll lines, in the entry's own words.
    bank.add({ txn_date: "2026-03-31", amount_minor: -41230, raw_hash: "ledger:entry-line-1", source_kind: "books", import_batch_id: null });
    bank.add({ txn_date: "2026-03-31", amount_minor: -65520, raw_hash: "ledger:entry-line-2", source_kind: "books", import_batch_id: null });
    const { check, repeats, result, summary } = await importAsTheDialogDoes(bank, rows, proof);
    expect(check.otherSource).toEqual([
      { index: 0, source: "books", bankLineId: "line-000002" },
      { index: 2, source: "books", bankLineId: "line-000001" },
    ]);
    expect(repeats.map((g) => g.text)).toEqual([
      "2 identical lines on Mar 31, 2026 (−655.20): 1 already in Bank Transactions, 1 will be imported.",
      "3 identical lines on Mar 31, 2026 (−412.30): 1 already in Bank Transactions, 2 will be imported.",
    ]);
    const sent = bank.imports[0].p_rows as { skip?: boolean }[];
    expect(sent.map((r) => r.skip === true)).toEqual([true, false, true, false, false]);
    expect(result).toMatchObject({ inserted: 3, skipped: 0, otherSource: 2 });
    expect(summary).toBe(
      "Imported 3 lines. 2 skipped as already in Bank Transactions from another source; 3 repeated lines on Mar 31 kept.",
    );
  });

  it("can be ticked back, and then every line is imported with the same keys", async () => {
    const bank = fakeBank();
    const { rows, proof } = csvFile();
    bank.add({ txn_date: "2026-03-31", amount_minor: -41230, raw_hash: "ledger:entry-line-1", source_kind: "books", import_batch_id: null });
    const check = await checkStatementLines(bank.sb, ACCOUNT, rows);
    expect(check.otherSource.map((l) => l.index)).toEqual([2]);
    const keysOf = (b: ReturnType<typeof fakeBank>) => (b.imports[0].p_rows as { raw_hash: string }[]).map((r) => r.raw_hash);

    await importStatement(bank.sb, ACCOUNT, "a.csv", statementImportRows(rows, [], [2]), proofPayload(proof));
    const tickedBack = fakeBank();
    const result = await importStatement(tickedBack.sb, ACCOUNT, "a.csv", statementImportRows(rows), proofPayload(proof));
    expect(keysOf(tickedBack)).toEqual(keysOf(bank));
    expect(result).toMatchObject({ inserted: 5, otherSource: 0 });
  });

  it("say so in the dialog's words", () => {
    expect(OTHER_SOURCE_WARNING).toBe("Already in Bank Transactions from another source (the books, a bank feed or another file)");
  });
});

// --- The pure rules ------------------------------------------------------------

const fileLine = (txn_date: string, amount_minor: number, description = "EXAMPLE LINE", external_id: string | null = null) => ({
  txn_date,
  amount_minor,
  description,
  reference: null,
  external_id,
});
const bankLine = (id: string, txnDate: string, amountMinor: number, rawHash: string, sourceKind: BankLineSource): BankLineOn => ({
  id,
  txnDate,
  amountMinor,
  rawHash,
  sourceKind,
  importBatchId: sourceKind === "import" ? "batch-1" : null,
});

describe("repeatKey", () => {
  it("is the bank's own id when the line has one, else its day, amount, words and reference", () => {
    expect(repeatKey(fileLine("2026-03-31", -100, "A", "F-1"))).toBe(repeatKey(fileLine("2026-04-01", -999, "B", "F-1")));
    expect(repeatKey(fileLine("2026-03-31", -100, "A"))).not.toBe(repeatKey(fileLine("2026-03-31", -100, "B")));
    expect(repeatKey(fileLine("2026-03-31", -100, "A"))).not.toBe(repeatKey(fileLine("2026-03-31", -100, "A", "F-1")));
  });
});

describe("presentLines", () => {
  it("names the lines whose own key is already there, and never a line marked Not a transaction", () => {
    const existing = [bankLine("b1", "2026-03-31", -100, "k2", "import")];
    expect(presentLines(["k1", "k2", null], existing)).toEqual([1]);
    expect(presentLines([null, null], existing)).toEqual([]);
  });
});

describe("otherSourceLines", () => {
  const two = [fileLine("2026-03-31", -41230, "EXAMPLE PAYROLL SERVICE"), fileLine("2026-03-31", -41230, "EXAMPLE PAYROLL SERVICE")];

  it("marks one of two identical lines when one such bank line is already there: the count rule", () => {
    const existing = [bankLine("b1", "2026-03-31", -41230, "feed-hash-1", "feed")];
    expect(otherSourceLines(two, ["k1", "k2"], existing)).toEqual([{ index: 0, source: "feed", bankLineId: "b1" }]);
  });

  it("marks both when two are there, and no more lines than the file has", () => {
    const existing = ["b1", "b2", "b3"].map((id) => bankLine(id, "2026-03-31", -41230, `feed-${id}`, "feed"));
    expect(otherSourceLines(two, ["k1", "k2"], existing).map((l) => l.bankLineId)).toEqual(["b1", "b2"]);
  });

  it("does not compare the words: a line made from the books carries the entry's", () => {
    const existing = [bankLine("b1", "2026-03-31", -41230, "ledger:entry-line-9", "books")];
    expect(otherSourceLines([fileLine("2026-03-31", -41230, "WIRE TO EXAMPLE PAYROLL")], ["k1"], existing)).toEqual([
      { index: 0, source: "books", bankLineId: "b1" },
    ]);
  });

  it("names where each came from: the books, a bank feed, another file, or anything else", () => {
    const lines = [fileLine("2026-03-01", -100), fileLine("2026-03-02", -200), fileLine("2026-03-03", -300), fileLine("2026-03-04", -400)];
    const existing = [
      bankLine("b1", "2026-03-01", -100, "ledger:l1", "books"),
      bankLine("b2", "2026-03-02", -200, "feed-2", "feed"),
      bankLine("b3", "2026-03-03", -300, "other-file-3", "import"),
      bankLine("b4", "2026-03-04", -400, "typed-4", "other"),
    ];
    expect(otherSourceLines(lines, ["k1", "k2", "k3", "k4"], existing).map((l) => l.source)).toEqual(["books", "feed", "import", "other"]);
  });

  it("needs the same day and the same amount", () => {
    const existing = [bankLine("b1", "2026-03-30", -41230, "ledger:a", "books"), bankLine("b2", "2026-03-31", -41231, "ledger:b", "books")];
    expect(otherSourceLines(two, ["k1", "k2"], existing)).toEqual([]);
  });

  it("never marks a line whose own key is there, and a bank line holding one of the file's keys accounts for no other", () => {
    const three = [...two, fileLine("2026-03-31", -41230, "EXAMPLE PAYROLL SERVICE")];
    const existing = [bankLine("b1", "2026-03-31", -41230, "k1", "import"), bankLine("b2", "2026-03-31", -41230, "ledger:x", "books")];
    // k1 is the first line, already here from this statement; the books' line stands for one of the other two.
    expect(otherSourceLines(three, ["k1", "k2", "k3"], existing)).toEqual([{ index: 1, source: "books", bankLineId: "b2" }]);
  });

  it("leaves out a line marked Not a transaction", () => {
    const existing = [bankLine("b1", "2026-03-31", -41230, "feed-1", "feed")];
    expect(otherSourceLines(two, [null, "k2"], existing)).toEqual([{ index: 1, source: "feed", bankLineId: "b1" }]);
  });
});

describe("describeRepeats", () => {
  const lines = [
    fileLine("2026-03-31", -41230, "EXAMPLE PAYROLL SERVICE"),
    fileLine("2026-03-31", -41230, "EXAMPLE PAYROLL SERVICE"),
    fileLine("2026-03-31", -1500, "EXAMPLE FEE"),
    fileLine("2026-03-31", -41230, "EXAMPLE PAYROLL SERVICE"),
  ];

  it("lists only lines that repeat, with how many are already here and how many will be imported", () => {
    const [group] = describeRepeats(lines, [], [0], [1], money);
    expect(group).toMatchObject({ indexes: [0, 1, 3], identical: 3, alreadyPresent: 1, otherSource: 1, toImport: 1 });
    expect(group.text).toBe("3 identical lines on Mar 31, 2026 (−412.30): 2 already in Bank Transactions, 1 will be imported.");
    expect(describeRepeats(lines, [], [], [], money)[0].text).toBe("3 identical lines on Mar 31, 2026 (−412.30): 3 will be imported.");
  });

  it("leaves out a line marked Not a transaction, and a set it leaves single", () => {
    expect(describeRepeats(lines, [1], [], [], money)[0].identical).toBe(2);
    expect(describeRepeats(lines, [1, 3], [], [], money)).toEqual([]);
  });

  it("groups lines carrying the same bank id, and not lines with different ones", () => {
    const withIds = [fileLine("2026-03-31", -100, "A", "F-1"), fileLine("2026-03-31", -100, "A", "F-1"), fileLine("2026-03-31", -100, "A", "F-2")];
    expect(describeRepeats(withIds, [], [], [], money).map((g) => g.indexes)).toEqual([[0, 1]]);
  });
});

describe("importedSummary", () => {
  const group = (date: string, toImport: number) =>
    ({ indexes: [], date, amountMinor: -100, identical: toImport, alreadyPresent: 0, otherSource: 0, toImport, text: "" });

  it("says each part only when it is not zero", () => {
    expect(importedSummary({ inserted: 40, alreadyHere: 2, otherSource: 3, repeats: [group("2026-03-31", 3)] })).toBe(
      "Imported 40 lines. 2 were already here from this statement; 3 skipped as already in Bank Transactions from another source; 3 repeated lines on Mar 31 kept.",
    );
    expect(importedSummary({ inserted: 40, alreadyHere: 0, otherSource: 0, repeats: [] })).toBe("Imported 40 lines.");
    expect(importedSummary({ inserted: 1, alreadyHere: 1, otherSource: 1, repeats: [group("2026-03-31", 1)] })).toBe(
      "Imported 1 line. 1 was already here from this statement; 1 skipped as already in Bank Transactions from another source; 1 repeated line on Mar 31 kept.",
    );
  });

  it("names the days of the repeats, up to three", () => {
    const say = (dates: string[]) => importedSummary({ inserted: 99, alreadyHere: 0, otherSource: 0, repeats: dates.map((d) => group(d, 2)) });
    expect(say(["2026-04-30", "2026-03-31"])).toBe("Imported 99 lines. 4 repeated lines on Mar 31 and Apr 30 kept.");
    expect(say(["2026-03-31", "2026-04-30", "2026-05-31"])).toBe("Imported 99 lines. 6 repeated lines on Mar 31, Apr 30 and May 31 kept.");
    expect(say(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"])).toBe("Imported 99 lines. 8 repeated lines on 4 days kept.");
  });

  it("never says more repeats were kept than lines were imported", () => {
    expect(importedSummary({ inserted: 1, alreadyHere: 2, otherSource: 0, repeats: [group("2026-03-31", 3)] })).toBe(
      "Imported 1 line. 2 were already here from this statement; 1 repeated line on Mar 31 kept.",
    );
  });
});

describe("importStatement", () => {
  const { rows, proof } = csvFile();

  it("asks nothing when there is no line to send", async () => {
    const bank = fakeBank();
    expect(await importStatement(bank.sb, ACCOUNT, "empty.csv", [], proofPayload(proof))).toEqual({
      inserted: 0,
      skipped: 0,
      otherSource: 0,
      batchId: null,
    });
    expect(bank.imports).toEqual([]);
  });

  it("sends the database's refusal on as it is", async () => {
    const bank = fakeBank();
    const out = { ...proofPayload(proof), closing_minor: 1 };
    await expect(importStatement(bank.sb, ACCOUNT, "out.csv", rows, out)).rejects.toThrow(/^The statement does not add up/);
    expect(bank.stored).toEqual([]);
  });

  it("makes no batch when every line is already here from another source", async () => {
    const bank = fakeBank();
    const result = await importStatement(bank.sb, ACCOUNT, "all.csv", statementImportRows(rows, [], [0, 1, 2, 3, 4]), proofPayload(proof));
    expect(result).toEqual({ inserted: 0, skipped: 0, otherSource: 5, batchId: null });
    expect(bank.imports).toHaveLength(1);
  });

  it("sends the keys of the lines sent, a line marked Not a transaction left out of the count", async () => {
    const bank = fakeBank();
    const misread = { ...rows[0], amount_minor: -1, description: "CHECK IMAGE" };
    const withMisread = [misread, ...rows];
    const marked = proveStatement({ kind: "csv", lines: withMisread, aside: [0], typedOpeningMinor: 2000000 }, money);
    await importStatement(bank.sb, ACCOUNT, "marked.csv", statementImportRows(withMisread, [0]), proofPayload(marked));
    expect((bank.imports[0].p_rows as { raw_hash: string }[]).map((r) => r.raw_hash)).toEqual(statementLineHashes(ACCOUNT, rows));
    expect((bank.imports[0].p_proof as { set_aside: number }).set_aside).toBe(1);
  });
});

describe("checkStatementLines", () => {
  it("reads the account's lines over the file's days, every page, in a total order", async () => {
    const bank = fakeBank();
    for (let i = 0; i < 2300; i += 1) {
      bank.add({ txn_date: "2026-03-15", amount_minor: -(1000 + i), raw_hash: `ledger:${i}`, source_kind: "books", import_batch_id: null });
    }
    // The last of them, past the first two pages, is the twin of the file's one line.
    const lines = [fileLine("2026-03-15", -3299, "EXAMPLE SUPPLIES"), fileLine("2026-03-20", -5, "EXAMPLE FEE")];
    const check = await checkStatementLines(bank.sb, ACCOUNT, lines);
    expect(check.otherSource).toEqual([{ index: 0, source: "books", bankLineId: "line-002300" }]);
    expect(bank.reads.map((r) => r.range)).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
    for (const read of bank.reads) {
      expect(read).toMatchObject({ args: { p_bank_account_id: ACCOUNT, p_from: "2026-03-15", p_to: "2026-03-20" }, orders: ["txn_date", "id"] });
    }
  });

  it("reads over the days of the lines sent, and nothing when every line is marked Not a transaction", async () => {
    const bank = fakeBank();
    const lines = [fileLine("2026-03-01", -100), fileLine("2026-03-31", -200)];
    await checkStatementLines(bank.sb, ACCOUNT, lines, [0]);
    expect(bank.reads[0].args).toMatchObject({ p_from: "2026-03-31", p_to: "2026-03-31" });
    expect(await checkStatementLines(bank.sb, ACCOUNT, lines, [0, 1])).toEqual({ present: [], otherSource: [] });
    expect(bank.reads).toHaveLength(1);
  });
});
