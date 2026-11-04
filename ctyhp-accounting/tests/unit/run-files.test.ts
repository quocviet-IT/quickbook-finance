import { describe, expect, it, vi } from "vitest";

// A PDF whose pages hold no text, as pdf.js reports it.
vi.mock("@/lib/client/pdf-text", () => ({
  readPdfStatementFile: async () => ({ message: (await import("@/lib/domain/pdf-statement-view")).PDF_MESSAGES.scanned }),
}));
import { datesReadTwoWays, needsOcr, readRunFile } from "@/lib/client/run-files";
import { guessStatementColumns, readStatementCsv } from "@/lib/domain/statement-csv";
import { RUN_MESSAGES } from "@/lib/domain/statement-run";
import { PDF_MESSAGES } from "@/lib/domain/pdf-statement-view";

const bank = { id: "bank-1", maskedNumber: "****7917", decimals: 2 };

describe("readRunFile", () => {
  it("cuts a CSV with a running balance into months", async () => {
    const csv = new File(
      ["Date,Description,Amount,Balance\n07/13/2026,DEPOSIT,500.00,1500.00\n08/14/2026,FEE,-5.00,1495.00\n"],
      "bank.csv",
      { type: "text/csv" },
    );
    const read = await readRunFile(csv, bank);
    expect(read.map((s) => [s.fileName, s.to, s.openingMinor, s.closingMinor, s.problem])).toEqual([
      ["bank.csv (2026-07)", "2026-07-31", 100000, 150000, null],
      ["bank.csv (2026-08)", "2026-08-31", 150000, 149500, null],
    ]);
  });

  it("refuses an OFX file, which carries no running balance", async () => {
    const ofx = new File(["OFXHEADER:100\n<OFX></OFX>"], "bank.ofx");
    const [only] = await readRunFile(ofx, bank);
    expect([only.fileName, only.problem]).toEqual(["bank.ofx", RUN_MESSAGES.noBalanceFormat]);
  });

  it("says a CSV's columns were not recognized when nothing in it reads as a date", async () => {
    const odd = new File(["When,What,How much\nyesterday,DEPOSIT,500.00\n"], "odd.csv");
    const [only] = await readRunFile(odd, bank);
    expect(only.problem).toBe("Its columns were not recognized — import it once on Banking to choose them");
  });

  it("reads oddly named columns by what they hold (2.43), and goes on to prove the month", async () => {
    const odd = new File(["When,What,How much\n07/13/2026,DEPOSIT,500.00\n"], "odd.csv");
    const [only] = await readRunFile(odd, bank);
    // No longer "not recognized": the file is read, and stops only where it has no balance to prove with.
    expect(only.problem).toBe(RUN_MESSAGES.noClosing);
  });

  describe("a CSV whose every date reads two ways (2.87)", () => {
    const csvText = "Date,Description,Amount,Balance\n03/04/2026,DEPOSIT,500.00,1500.00\n05/06/2026,FEE,-5.00,1495.00\n";

    it("waits, rather than reading it month first in silence, and says how to choose", async () => {
      const [only] = await readRunFile(new File([csvText], "two-ways.csv"), bank);
      expect(only.problem).toBe(datesReadTwoWays("03/04/2026"));
      expect(only.problem).toBe(
        "Its dates read two ways: 03/04/2026 is March 4, 2026 month first, or April 3, 2026 day first — import it once on Banking to choose",
      );
      expect(only.lines).toEqual([]);
    });

    it("reads it the way chosen on Banking for this account", async () => {
      const csv = readStatementCsv(csvText);
      const saved = { columns: guessStatementColumns(csv.headers, csv.records), dateOrder: "dmy", flipSigns: false };
      vi.stubGlobal("localStorage", { getItem: (key: string) => (key === "onebook.statement-columns.bank-1" ? JSON.stringify(saved) : null) });
      try {
        const read = await readRunFile(new File([csvText], "two-ways.csv"), bank);
        expect(read.every((s) => s.problem !== datesReadTwoWays("03/04/2026"))).toBe(true);
        expect(read.flatMap((s) => s.lines.map((l) => l.txn_date))).toEqual(["2026-04-03", "2026-06-05"]);
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  it("keeps a file that cannot be read as a row that says so", async () => {
    const broken = { name: "broken.csv", type: "text/csv", text: () => Promise.reject(new Error("gone")) } as unknown as File;
    const [only] = await readRunFile(broken, bank);
    expect([only.fileName, only.source, only.problem]).toEqual(["broken.csv", "CSV", "This file could not be read"]);
  });
});

describe("a scanned statement or a photo (3.0.5)", () => {
  it("makes a photo of a statement a file that waits for OCR, not one that cannot be read", async () => {
    for (const name of ["page.jpg", "page.JPEG", "page.png"]) {
      const read = await readRunFile(new File(["x"], name), bank);
      expect(read).toHaveLength(1);
      expect(needsOcr(read[0])).toBe(true);
      expect(read[0].fileName).toBe(name);
    }
  });

  it("makes a PDF with no text a file that waits for OCR", async () => {
    const read = await readRunFile(new File(["%PDF"], "scan.pdf", { type: "application/pdf" }), bank);
    expect(read.map(needsOcr)).toEqual([true]);
  });

  it("leaves a file that failed for another reason unreadable", async () => {
    const [csv] = await readRunFile(new File(["OFXHEADER:100\n<OFX></OFX>"], "bank.ofx"), bank);
    expect(needsOcr(csv)).toBe(false);
    expect(needsOcr({ ...csv, problem: PDF_MESSAGES.noLines })).toBe(false);
  });

  it("does not read a photo for a credit card", async () => {
    const [only] = await readRunFile(new File(["x"], "page.jpg"), { ...bank, side: "card" });
    expect(needsOcr(only)).toBe(false);
    expect(only.problem).toBe(RUN_MESSAGES.cardNeedsPdf);
  });
});
