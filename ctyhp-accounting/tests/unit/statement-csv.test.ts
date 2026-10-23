import { describe, expect, it } from "vitest";
import { guessStatementColumns, readStatementCsv, sniffDelimiter, statementCsvNote } from "@/lib/domain/statement-csv";
import { detectDateOrder, detectStatementColumns, parseStatementRows } from "@/lib/domain/statement-import";

/** Read a file the way the import does: records, guessed columns, then lines. */
function read(text: string) {
  const csv = readStatementCsv(text);
  const columns = guessStatementColumns(csv.headers, csv.records);
  const dateOrder = detectDateOrder(csv.records.map((r) => (columns.date ? r[columns.date] ?? "" : "")));
  const { rows, skipped } = parseStatementRows(csv.records, { columns, dateOrder });
  return { csv, columns, rows, skipped };
}

describe("reading a bank CSV whatever its layout", () => {
  it("reads a file with ordinary headings exactly as before", () => {
    const text = "Date,Description,Amount\n07/01/2026,DEPOSIT,100.00\n07/02/2026,FEE,-5.00\n";
    const { csv, columns, rows } = read(text);
    expect(csv.preambleRows).toBe(0);
    expect(csv.headerless).toBe(false);
    expect(columns).toMatchObject(detectStatementColumns(["date", "description", "amount"]).columns);
    expect(rows.map((r) => r.amount_minor)).toEqual([10_000, -500]);
    expect(statementCsvNote(csv)).toBeNull();
  });

  it("finds a check number and a running balance a bank names its own way, and names a blank heading", () => {
    const text = [
      "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #,",
      "DEBIT,07/05/2026,CHECK 1042,-120.00,CHECK_PAID,880.00,1042,",
      "CREDIT,07/03/2026,DEPOSIT,500.00,ACH_CREDIT,1000.00,,",
      "DEBIT,07/02/2026,FEE,-15.00,FEE_TRANSACTION,500.00,,",
    ].join("\n");
    const { csv, columns, rows } = read(text);
    expect(csv.headers.at(-1)).toBe("column 8");
    expect(columns).toMatchObject({ date: "posting date", description: "description", amount: "amount", balance: "balance", reference: "check or slip #" });
    expect(rows[0]).toMatchObject({ reference: "1042", running_balance_minor: 88_000, amount_minor: -12_000 });
  });

  it("sets aside a title and a summary above the headings", () => {
    const text = [
      "Example Bank Account Statement",
      "Account,Example Checking ****1234",
      "Period,07/01/2026 to 07/31/2026",
      "",
      "Date,Description,Debit,Credit,Balance",
      "07/01/2026,OPENING DEPOSIT,,1000.00,1000.00",
      "07/02/2026,RENT,400.00,,600.00",
      "07/09/2026,REFUND,,25.50,625.50",
    ].join("\n");
    const { csv, columns, rows } = read(text);
    expect(csv.preambleRows).toBe(3);
    expect(columns).toMatchObject({ date: "date", moneyOut: "debit", moneyIn: "credit", balance: "balance" });
    expect(rows.map((r) => r.amount_minor)).toEqual([100_000, -40_000, 2_550]);
    expect(statementCsvNote(csv)).toBe("3 rows above the headings set aside.");
  });

  it("reads a file with no headings by what each column holds, and never takes the balance for the money", () => {
    const text = [
      "07/01/2026,OPENING DEPOSIT,1000.00,1000.00",
      "07/02/2026,RENT,-400.00,600.00",
      "07/05/2026,COFFEE SHOP,-4.50,595.50",
      "07/09/2026,REFUND,25.50,621.00",
      "07/12/2026,TRANSFER,-100.00,521.00",
    ].join("\n");
    const { csv, columns, rows } = read(text);
    expect(csv.headerless).toBe(true);
    expect(columns).toMatchObject({ date: "column 1", description: "column 2", amount: "column 3", balance: "column 4" });
    expect(rows.map((r) => r.amount_minor)).toEqual([100_000, -40_000, -450, 2_550, -10_000]);
    expect(statementCsvNote(csv)).toBe("The file has no headings, so its columns were read by what they hold.");
  });

  it("finds the running balance in a file listed newest first", () => {
    const text = [
      "07/12/2026,TRANSFER,-100.00,521.00",
      "07/09/2026,REFUND,25.50,621.00",
      "07/05/2026,COFFEE SHOP,-4.50,595.50",
      "07/02/2026,RENT,-400.00,600.00",
      "07/01/2026,OPENING DEPOSIT,1000.00,1000.00",
    ].join("\n");
    expect(read(text).columns).toMatchObject({ amount: "column 3", balance: "column 4" });
  });

  it("takes a row of words just above the first dated row as the headings, in any language", () => {
    const text = [
      "Ngày,Mô tả,Số tiền,Số dư",
      "01/07/2026,Nộp tiền,1000.00,1000.00",
      "02/07/2026,Tiền thuê,-400.00,600.00",
      "15/07/2026,Phí,-4.50,595.50",
      "20/07/2026,Hoàn tiền,25.50,621.00",
    ].join("\n");
    const { csv, columns, rows } = read(text);
    expect(csv.headerless).toBe(false);
    expect(columns).toMatchObject({ date: "ngày", description: "mô tả", amount: "số tiền", balance: "số dư" });
    expect(rows[2]).toMatchObject({ txn_date: "2026-07-15", amount_minor: -450 });
  });

  it("splits money out and money in when neither column carries a sign", () => {
    const text = [
      "07/01/2026,DEPOSIT,,1000.00",
      "07/02/2026,RENT,400.00,",
      "07/03/2026,FEE,4.50,",
      "07/09/2026,REFUND,,25.50",
    ].join("\n");
    const { columns, rows } = read(text);
    expect(columns).toMatchObject({ moneyOut: "column 3", moneyIn: "column 4" });
    expect(rows.map((r) => r.amount_minor)).toEqual([100_000, -40_000, -450, 2_550]);
  });

  it("reads a column of bare whole numbers beside the amounts as the check number", () => {
    const text = [
      "07/01/2026,1042,PAYMENT TO EXAMPLE VENDOR,-120.00",
      "07/02/2026,1043,PAYMENT TO EXAMPLE SUPPLIER,-80.25",
      "07/03/2026,1044,PAYMENT TO EXAMPLE LANDLORD,-900.00",
    ].join("\n");
    const { columns, rows } = read(text);
    expect(columns).toMatchObject({ reference: "column 2", amount: "column 4", description: "column 3" });
    expect(rows[0]).toMatchObject({ reference: "1042", amount_minor: -12_000 });
  });

  it("reads a European export: semicolons, day-first dotted dates and decimal commas", () => {
    const text = [
      "Datum;Beschreibung;Betrag;Saldo",
      "01.07.2026;Einzahlung;1.000,00;1.000,00",
      "02.07.2026;Miete;-400,00;600,00",
      "05.07.2026;Kaffee;-4,50;595,50",
      "09.07.2026;Erstattung;25,50;621,00",
    ].join("\n");
    expect(sniffDelimiter(text)).toBe(";");
    const { columns, rows } = read(text);
    expect(columns).toMatchObject({ date: "datum", description: "beschreibung", amount: "betrag", balance: "saldo" });
    expect(rows.map((r) => [r.txn_date, r.amount_minor])).toEqual([
      ["2026-07-01", 100_000],
      ["2026-07-02", -40_000],
      ["2026-07-05", -450],
      ["2026-07-09", 2_550],
    ]);
  });

  it("keeps a comma file a comma file, even with semicolons inside quoted descriptions", () => {
    expect(sniffDelimiter('Date,Description,Amount\n07/01/2026,"A; B; C",10.00\n07/02/2026,"D; E",5.00\n')).toBe(",");
  });

  it("does not take a transaction id for the description", () => {
    const csv = readStatementCsv("Transaction ID,Posted,Amount\nA1,07/01/2026,10.00\nA2,07/02/2026,-2.00\n");
    expect(guessStatementColumns(csv.headers, csv.records)).toMatchObject({ date: "posted", amount: "amount", description: null });
  });
});
