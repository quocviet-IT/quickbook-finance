import { describe, expect, it } from "vitest";
import { readRunFile } from "@/lib/client/run-files";
import { RUN_MESSAGES } from "@/lib/domain/statement-run";

const bank = { id: "bank-1", maskedNumber: "****7917", decimals: 2 };

describe("readRunFile", () => {
  it("cuts a CSV with a running balance into months", async () => {
    const csv = new File(
      ["Date,Description,Amount,Balance\n07/03/2026,DEPOSIT,500.00,1500.00\n08/04/2026,FEE,-5.00,1495.00\n"],
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

  it("says a CSV's columns were not recognized", async () => {
    const odd = new File(["When,What,How much\n07/03/2026,DEPOSIT,500.00\n"], "odd.csv");
    const [only] = await readRunFile(odd, bank);
    expect(only.problem).toBe("Its columns were not recognized — import it once on Banking to choose them");
  });

  it("keeps a file that cannot be read as a row that says so", async () => {
    const broken = { name: "broken.csv", type: "text/csv", text: () => Promise.reject(new Error("gone")) } as unknown as File;
    const [only] = await readRunFile(broken, bank);
    expect([only.fileName, only.source, only.problem]).toEqual(["broken.csv", "CSV", "This file could not be read"]);
  });
});
