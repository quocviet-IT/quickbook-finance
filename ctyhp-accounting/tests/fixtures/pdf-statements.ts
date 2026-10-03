/**
 * Invented bank statements for the PDF statement reader, laid out as the glyphs
 * pdf.js returns: each row is [y, [x, text], ...], pages top to bottom, y
 * counted up from the foot of a 792-point page. Each one exercises a rule of
 * the client's prototype (Accounting System 2.28, src/p44.html).
 *
 * `expected` is what OneBook reads. It was taken from running the reader and
 * checked line for line against the prototype's own code on the same glyphs:
 * they agree everywhere except the scenarios carrying `prototypeDiffers`,
 * where OneBook deliberately does not repeat a prototype defect. Every
 * scenario proves: opening + the lines = closing.
 *
 * No real bank, account or figure: "Example Bank", accounts ending 1111/2222.
 */
import type { PdfGlyph } from "@/lib/domain/pdf-statement";

export type ScenarioCell = [x: number, text: string];
export type ScenarioRow = [y: number, ...cells: ScenarioCell[]];
/** [date, amountMinor, description, checkNumber, balanceMinor] */
export type ExpectedLine = [string, number, string, string | null, number | null];
export interface ExpectedStatement {
  account: string | null;
  from: string | null;
  to: string | null;
  opening: number | null;
  closing: number | null;
  lines: ExpectedLine[];
  skipped: number;
}
export interface PdfScenario {
  name: string;
  pages: ScenarioRow[][];
  expected: ExpectedStatement[];
  /** Why the prototype reads this one differently, when it does. */
  prototypeDiffers?: string;
}

export function glyphsOf(scenario: PdfScenario): PdfGlyph[] {
  return scenario.pages.flatMap((rows, p) =>
    rows.flatMap(([y, ...cells]) => cells.map(([x, text]) => ({ page: p + 1, x, y, text }))),
  );
}

export const PDF_SCENARIOS: PdfScenario[] = [
  {
    name: "debitCreditColumns",
    pages: [
      [
        [760, [40, "Example Bank"]],
        [748, [40, "Account number: 0000-1111"]],
        [736, [40, "Statement period Jan 1 - Jan 31, 2026"]],
        [720, [40, "Beginning balance"], [500, "1,000.00"]],
        [708, [40, "Ending balance"], [500, "1,180.00"]],
        [690, [40, "Transaction history"]],
        [678, [40, "Date"], [90, "Description"], [330, "Withdrawals"], [410, "Deposits"], [500, "Balance"]],
        [666, [40, "01/05"], [90, "ACME RENT"], [330, "250.00"], [500, "750.00"]],
        [654, [40, "01/12"], [90, "CARD PURCHASE EXAMPLE STORE"], [330, "70.00"], [500, "680.00"]],
        [642, [40, "01/20"], [90, "DEPOSIT 0042"], [410, "500.00"], [500, "1,180.00"]],
        [630, [40, "Total"], [330, "320.00"], [410, "500.00"]],
      ],
    ],
    expected: [
      {
        account: "00001111", from: "2026-01-01", to: "2026-01-31", opening: 100000, closing: 118000, skipped: 0,
        lines: [
          ["2026-01-05",-25000,"ACME RENT",null,75000],
          ["2026-01-12",-7000,"CARD PURCHASE EXAMPLE STORE",null,68000],
          ["2026-01-20",50000,"DEPOSIT 0042",null,118000],
        ],
      },
    ],
  },
  {
    name: "signedAmount",
    pages: [
      [
        [760, [40, "Example Bank"]],
        [748, [40, "Statement period: 01/01/2026 - 01/31/2026"]],
        [730, [40, "Beginning balance"]],
        [718, [40, "$2,000.00"]],
        [706, [40, "Ending balance"]],
        [694, [40, "$1,697.50"]],
        [682, [40, "Transaction detail"]],
        [670, [40, "Date"], [90, "Description"], [420, "Amount"]],
        [658, [40, "01/03"], [90, "ONLINE PAYMENT EXAMPLE UTILITY"], [420, "-250.00"]],
        [646, [40, "01/09"], [90, "SERVICE FEE"], [420, "(12.50)"]],
        [634, [40, "01/15"], [90, "WIRE TRANSFER OUT"], [420, "40.00-"]],
        [622, [40, "01/21"], [90, "MOBILE DEPOSIT"], [420, "0.00"]],
      ],
    ],
    expected: [
      {
        account: null, from: "2026-01-01", to: "2026-01-31", opening: 200000, closing: 169750, skipped: 0,
        lines: [
          ["2026-01-03",-25000,"ONLINE PAYMENT EXAMPLE UTILITY",null,null],
          ["2026-01-09",-1250,"SERVICE FEE",null,null],
          ["2026-01-15",-4000,"WIRE TRANSFER OUT",null,null],
        ],
      },
    ],
  },
  {
    name: "sectionSigns",
    pages: [
      [
        [760, [40, "Example Bank"]],
        [748, [40, "Statement Period: Feb 1, 2026 through Feb 28, 2026"]],
        [730, [40, "Opening balance"], [500, "500.00"]],
        [718, [40, "Closing balance"], [500, "845.00"]],
        [700, [40, "Deposits and other credits"]],
        [688, [40, "Date"], [90, "Description"], [420, "Amount"]],
        [676, [40, "02/02"], [90, "CUSTOMER PAYMENT EXAMPLE CO"], [420, "400.00"]],
        [664, [40, "02/16"], [90, "INTEREST PAID"], [420, "0.25"]],
        [652, [40, "Total deposits and other credits"], [420, "400.25"]],
        [634, [40, "Withdrawals and other debits"]],
        [622, [40, "Date"], [90, "Description"], [420, "Amount"]],
        [610, [40, "02/10"], [90, "EXAMPLE INSURANCE"], [420, "55.25"]],
        [598, [40, "Total withdrawals and other debits"], [420, "55.25"]],
      ],
    ],
    expected: [
      {
        account: null, from: "2026-02-01", to: "2026-02-28", opening: 50000, closing: 84500, skipped: 0,
        lines: [
          ["2026-02-02",40000,"CUSTOMER PAYMENT EXAMPLE CO",null,null],
          ["2026-02-16",25,"INTEREST PAID",null,null],
          ["2026-02-10",-5525,"EXAMPLE INSURANCE",null,null],
        ],
      },
    ],
  },
  {
    name: "wrappedHeadingAndDailyBalances",
    pages: [
      [
        [760, [40, "Example Bank"]],
        [748, [40, "March 1, 2026 - March 31, 2026"]],
        [730, [40, "Beginning balance on 3/1"], [500, "3,000.00"]],
        [718, [40, "Ending balance on 3/31"], [500, "2,640.00"]],
        [700, [40, "Transaction history"]],
        [688, [330, "Withdrawals/"], [410, "Deposits/"], [500, "Ending daily"]],
        [676, [40, "Date"], [90, "Description"], [330, "Debits"], [410, "Credits"], [500, "balance"]],
        [664, [40, "3/4"], [90, "EXAMPLE PAYROLL"], [330, "1,200.00"]],
        [652, [40, "3/4"], [90, "EXAMPLE CLIENT DEPOSIT"], [410, "900.00"], [500, "2,700.00"]],
        [640, [40, "3/18"], [90, "CHECK 1043"], [330, "60.00"], [500, "2,640.00"]],
        [622, [40, "Daily ending balance"]],
        [610, [40, "Date"], [120, "Balance"], [250, "Date"], [330, "Balance"]],
        [598, [40, "3/4"], [120, "2,700.00"], [250, "3/18"], [330, "2,640.00"]],
      ],
    ],
    expected: [
      {
        account: null, from: "2026-03-01", to: "2026-03-31", opening: 300000, closing: 264000, skipped: 0,
        lines: [
          ["2026-03-04",-120000,"EXAMPLE PAYROLL",null,null],
          ["2026-03-04",90000,"EXAMPLE CLIENT DEPOSIT",null,270000],
          ["2026-03-18",-6000,"CHECK 1043","1043",264000],
        ],
      },
    ],
  },
  {
    name: "chequeGrid",
    prototypeDiffers: "the prototype reads 75.00 as a date and loses cheque 1102",
    pages: [
      [
        [760, [40, "Example Bank"]],
        [748, [40, "Statement period Apr 1 - Apr 30, 2026"]],
        [730, [40, "Previous balance"], [500, "1,500.00"]],
        [718, [40, "New balance"], [500, "1,155.00"]],
        [700, [40, "Checks paid"]],
        [688, [40, "Date"], [90, "Check No."], [160, "Amount"], [260, "Date"], [310, "Check No."], [380, "Amount"]],
        [676, [40, "04/06"], [90, "1101"], [160, "120.00"], [260, "04/14"], [310, "1102"], [380, "75.00"]],
        [664, [40, "04/22"], [90, "1103"], [160, "150.00"]],
        [646, [40, "Total checks paid"], [160, "345.00"]],
      ],
    ],
    expected: [
      {
        account: null, from: "2026-04-01", to: "2026-04-30", opening: 150000, closing: 115500, skipped: 0,
        lines: [
          ["2026-04-06",-12000,"1101","1101",null],
          ["2026-04-14",-7500,"1102","1102",null],
          ["2026-04-22",-15000,"1103","1103",null],
        ],
      },
    ],
  },
  {
    name: "chequesRestated",
    prototypeDiffers: "the prototype reads 45.00 as a date, so the restated cheques are only partly recognised and one is counted twice",
    pages: [
      [
        [760, [40, "Example Bank"]],
        [748, [40, "Statement period May 1 - May 31, 2026"]],
        [730, [40, "Beginning balance"], [500, "800.00"]],
        [718, [40, "Ending balance"], [500, "1,005.00"]],
        [700, [40, "Transaction history"]],
        [688, [40, "Date"], [90, "Description"], [330, "Withdrawals"], [410, "Deposits"], [500, "Balance"]],
        [676, [40, "05/04"], [90, "Check 2001"], [330, "45.00"], [500, "755.00"]],
        [664, [40, "05/11"], [90, "Check 2002"], [330, "150.00"], [500, "605.00"]],
        [652, [40, "05/19"], [90, "EXAMPLE CLIENT DEPOSIT"], [410, "400.00"], [500, "1,005.00"]],
        [634, [40, "Checks paid"]],
        [622, [40, "Date"], [90, "Check No."], [160, "Amount"], [260, "Date"], [310, "Check No."], [380, "Amount"]],
        [610, [40, "05/04"], [90, "2001"], [160, "45.00"], [260, "05/11"], [310, "2002"], [380, "150.00"]],
      ],
    ],
    expected: [
      {
        account: null, from: "2026-05-01", to: "2026-05-31", opening: 80000, closing: 100500, skipped: 0,
        lines: [
          ["2026-05-04",-4500,"Check 2001","2001",75500],
          ["2026-05-11",-15000,"Check 2002","2002",60500],
          ["2026-05-19",40000,"EXAMPLE CLIENT DEPOSIT",null,100500],
        ],
      },
    ],
  },
  {
    name: "balanceColumnNear",
    pages: [
      [
        [760, [40, "Example Bank"]],
        [748, [40, "Statement period Jun 1 - Jun 30, 2026"]],
        [730, [40, "Beginning balance on 6/1"], [497, "2,500.00"]],
        [718, [40, "Ending balance on 6/30"], [497, "2,195.00"]],
        [700, [40, "Transaction history"]],
        [688, [40, "Date"], [90, "Description"], [330, "Deposits"], [440, "Withdrawals"], [497, "Balance"]],
        [676, [40, "6/3"], [90, "EXAMPLE SUPPLIES"], [440, "180.00"]],
        [664, [40, "6/3"], [90, "EXAMPLE FREIGHT"], [440, "125.00"], [497, "2,195.00"]],
      ],
    ],
    expected: [
      {
        account: null, from: "2026-06-01", to: "2026-06-30", opening: 250000, closing: 219500, skipped: 0,
        lines: [
          ["2026-06-03",-18000,"EXAMPLE SUPPLIES",null,null],
          ["2026-06-03",-12500,"EXAMPLE FREIGHT",null,219500],
        ],
      },
    ],
  },
  {
    name: "decemberOnJanuary",
    pages: [
      [
        [760, [40, "Example Bank"]],
        [748, [40, "Statement period Dec 15, 2025 - Jan 14, 2026"]],
        [730, [40, "Beginning balance"], [500, "700.00"]],
        [718, [40, "Ending balance"], [500, "615.00"]],
        [700, [40, "Transaction history"]],
        [688, [40, "Date"], [90, "Description"], [420, "Amount"], [500, "Balance"]],
        [676, [40, "12/28"], [90, "EXAMPLE TELECOM"], [420, "-85.00"], [500, "615.00"]],
        [664, [40, "01/03"], [90, "EXAMPLE REFUND"], [420, "30.00"], [500, "645.00"]],
        [652, [40, "01/09"], [90, "EXAMPLE SOFTWARE"], [420, "-30.00"], [500, "615.00"]],
      ],
    ],
    expected: [
      {
        account: null, from: "2025-12-15", to: "2026-01-14", opening: 70000, closing: 61500, skipped: 0,
        lines: [
          ["2025-12-28",-8500,"EXAMPLE TELECOM",null,61500],
          ["2026-01-03",3000,"EXAMPLE REFUND",null,64500],
          ["2026-01-09",-3000,"EXAMPLE SOFTWARE",null,61500],
        ],
      },
    ],
  },
  {
    name: "missingTotals",
    pages: [
      [
        [760, [40, "Example Bank"]],
        [748, [40, "Account activity"]],
        [730, [40, "Date"], [90, "Description"], [330, "Withdrawals"], [410, "Deposits"], [500, "Balance"]],
        [718, [40, "07/02/2026"], [90, "EXAMPLE DEPOSIT"], [410, "300.00"], [500, "1,300.00"]],
        [706, [40, "07/09/2026"], [90, "EXAMPLE UTILITY"], [330, "120.00"], [500, "1,180.00"]],
      ],
    ],
    expected: [
      {
        account: null, from: null, to: "2026-07-09", opening: 100000, closing: 118000, skipped: 0,
        lines: [
          ["2026-07-02",30000,"EXAMPLE DEPOSIT",null,130000],
          ["2026-07-09",-12000,"EXAMPLE UTILITY",null,118000],
        ],
      },
    ],
  },
  {
    name: "combinedAccounts",
    pages: [
      [
        [760, [40, "Example Bank"]],
        [748, [40, "Account number: 0000-1111"]],
        [736, [40, "Statement period Aug 1 - Aug 31, 2026"]],
        [718, [40, "Beginning balance"], [500, "100.00"]],
        [706, [40, "Ending balance"], [500, "150.00"]],
        [694, [40, "Transaction history"]],
        [682, [40, "Date"], [90, "Description"], [330, "Withdrawals"], [410, "Deposits"], [500, "Balance"]],
        [670, [40, "08/10"], [90, "EXAMPLE DEPOSIT"], [410, "50.00"], [500, "150.00"]],
      ],
      [
        [760, [40, "Account number: 0000-1111"]],
        [730, [40, "Account number: 0000-2222"]],
        [718, [40, "Statement period Aug 1 - Aug 31, 2026"]],
        [700, [40, "Beginning balance"], [500, "2,000.00"]],
        [688, [40, "Ending balance"], [500, "1,900.00"]],
        [676, [40, "Transaction history"]],
        [664, [40, "Date"], [90, "Description"], [330, "Withdrawals"], [410, "Deposits"], [500, "Balance"]],
        [652, [40, "08/20"], [90, "EXAMPLE TRANSFER OUT"], [330, "100.00"], [500, "1,900.00"]],
      ],
    ],
    expected: [
      {
        account: "00001111", from: "2026-08-01", to: "2026-08-31", opening: 10000, closing: 15000, skipped: 0,
        lines: [
          ["2026-08-10",5000,"EXAMPLE DEPOSIT",null,15000],
        ],
      },
      {
        account: "00002222", from: "2026-08-01", to: "2026-08-31", opening: 200000, closing: 190000, skipped: 0,
        lines: [
          ["2026-08-20",-10000,"EXAMPLE TRANSFER OUT",null,190000],
        ],
      },
    ],
  },
  {
    name: "impossibleDate",
    prototypeDiffers: "the prototype keeps 02/30 as the date 2026-02-30",
    pages: [
      [
        [760, [40, "Example Bank"]],
        [748, [40, "Statement period Feb 1 - Feb 28, 2026"]],
        [730, [40, "Beginning balance"], [500, "400.00"]],
        [718, [40, "Ending balance"], [500, "390.00"]],
        [700, [40, "Transaction history"]],
        [688, [40, "Date"], [90, "Description"], [420, "Amount"]],
        [676, [40, "02/27"], [90, "EXAMPLE FEE"], [420, "-10.00"]],
        [664, [40, "02/30"], [90, "MISPRINTED LINE"], [420, "-5.00"]],
      ],
    ],
    expected: [
      {
        account: null, from: "2026-02-01", to: "2026-02-28", opening: 40000, closing: 39000, skipped: 1,
        lines: [
          ["2026-02-27",-1000,"EXAMPLE FEE",null,null],
        ],
      },
    ],
  },
  {
    name: "endingBalanceOn",
    pages: [
      [
        [760, [40, "Example Bank"]],
        [748, [40, "September 30, 2026"]],
        [730, [40, "Beginning balance on 9/1"], [500, "1,000.00"]],
        [718, [40, "Ending balance on 9/30"], [500, "1,025.00"]],
        [700, [40, "Transaction history"]],
        [688, [40, "Date"], [90, "Description"], [420, "Amount"], [500, "Balance"]],
        [676, [40, "9/15"], [90, "EXAMPLE INTEREST"], [420, "25.00"], [500, "1,025.00"]],
      ],
    ],
    expected: [
      {
        account: null, from: "2026-09-01", to: "2026-09-30", opening: 100000, closing: 102500, skipped: 0,
        lines: [
          ["2026-09-15",2500,"EXAMPLE INTEREST",null,102500],
        ],
      },
    ],
  },
  {
    name: "datePaidHeading",
    pages: [
      [
        [760, [40, "Example Bank"]],
        [748, [40, "Statement period Oct 1 - Oct 31, 2026"]],
        [730, [40, "Beginning balance"], [500, "900.00"]],
        [718, [40, "Ending balance"], [500, "735.00"]],
        [700, [40, "CHECKS PAID"]],
        [688, [300, "DATE"]],
        [676, [40, "CHECK NO."], [120, "DESCRIPTION"], [300, "PAID"], [420, "AMOUNT"]],
        [664, [40, "3001"], [120, "EXAMPLE PAYEE"], [300, "10/06"], [420, "165.00"]],
      ],
    ],
    expected: [
      {
        account: null, from: "2026-10-01", to: "2026-10-31", opening: 90000, closing: 73500, skipped: 0,
        lines: [
          ["2026-10-06",-16500,"3001 EXAMPLE PAYEE","3001",null],
        ],
      },
    ],
  },
  {
    name: "statementDate",
    prototypeDiffers: "the prototype reads \"November\" as \"ber\", finds no period, and loses the line",
    pages: [
      [
        [760, [40, "Example Bank"]],
        [748, [40, "Statement date: November 30, 2026"]],
        [730, [40, "Previous balance"], [500, "50.00"]],
        [718, [40, "New balance"], [500, "75.00"]],
        [700, [40, "Deposits"]],
        [688, [40, "Date"], [90, "Description"], [420, "Amount"]],
        [676, [40, "11/12"], [90, "EXAMPLE CASH DEPOSIT"], [420, "25.00"]],
      ],
    ],
    expected: [
      {
        account: null, from: null, to: "2026-11-30", opening: 5000, closing: 7500, skipped: 0,
        lines: [
          ["2026-11-12",2500,"EXAMPLE CASH DEPOSIT",null,null],
        ],
      },
    ],
  },
  {
    name: "dateJoinedToWords",
    prototypeDiffers: "the prototype does not read a date joined to the words after it",
    pages: [
      [
        [760, [40, "Example Bank"]],
        [748, [40, "Statement period Mar 1 - Mar 31, 2027"]],
        [730, [40, "Beginning balance"], [500, "300.00"]],
        [718, [40, "Ending balance"], [500, "420.00"]],
        [700, [40, "Transaction history"]],
        [688, [40, "Date"], [90, "Description"], [330, "Withdrawals"], [410, "Deposits"], [500, "Balance"]],
        [676, [40, "03/14 EXAMPLE CLIENT DEPOSIT"], [410, "120.00"], [500, "420.00"]],
      ],
    ],
    expected: [
      {
        account: null, from: "2027-03-01", to: "2027-03-31", opening: 30000, closing: 42000, skipped: 0,
        lines: [
          ["2027-03-14",12000,"EXAMPLE CLIENT DEPOSIT",null,42000],
        ],
      },
    ],
  },
  {
    name: "signPriority",
    pages: [
      [
        [760, [40, "Example Bank"]],
        [748, [40, "Statement period Apr 1 - Apr 30, 2027"]],
        [730, [40, "Beginning balance"], [500, "1,000.00"]],
        [718, [40, "Ending balance"], [500, "880.00"]],
        [700, [40, "Deposits and credits"]],
        [688, [40, "Date"], [90, "Description"], [330, "Withdrawals"], [410, "Deposits"], [500, "Balance"]],
        [676, [40, "04/02"], [90, "EXAMPLE MISALIGNED"], [410, "100.00"], [500, "900.00"]],
        [664, [40, "04/09"], [90, "EXAMPLE PRINTED SIGN"], [410, "-50.00"]],
        [652, [40, "04/16"], [90, "EXAMPLE COLUMN"], [330, "20.00"]],
        [640, [40, "04/23"], [90, "EXAMPLE SECTION"], [250, "50.00"], [500, "880.00"]],
      ],
    ],
    expected: [
      {
        account: null, from: "2027-04-01", to: "2027-04-30", opening: 100000, closing: 88000, skipped: 0,
        lines: [
          ["2027-04-02",-10000,"EXAMPLE MISALIGNED",null,90000],
          ["2027-04-09",-5000,"EXAMPLE PRINTED SIGN",null,null],
          ["2027-04-16",-2000,"EXAMPLE COLUMN",null,null],
          ["2027-04-23",5000,"EXAMPLE SECTION",null,88000],
        ],
      },
    ],
  },
  {
    name: "summaryFeesAndPayments",
    pages: [
      [
        [760, [40, "Example Bank"]],
        [748, [40, "Statement period May 1 - May 31, 2027"]],
        [730, [40, "Beginning balance"], [500, "600.00"]],
        [718, [40, "Ending balance"], [500, "668.00"]],
        [700, [40, "Account summary"]],
        [688, [40, "Date"], [90, "Description"], [420, "Amount"]],
        [676, [40, "05/31"], [90, "Interest earned this period"], [420, "1.00"]],
        [658, [40, "Payments received"]],
        [646, [40, "Date"], [90, "Description"], [420, "Amount"]],
        [634, [40, "05/06"], [90, "EXAMPLE CUSTOMER"], [420, "80.00"]],
        [616, [40, "Fees"]],
        [604, [40, "Date"], [90, "Description"], [420, "Amount"]],
        [592, [40, "05/20"], [90, "MONTHLY MAINTENANCE"], [420, "12.00"]],
      ],
    ],
    expected: [
      {
        account: null, from: "2027-05-01", to: "2027-05-31", opening: 60000, closing: 66800, skipped: 0,
        lines: [
          ["2027-05-06",8000,"EXAMPLE CUSTOMER",null,null],
          ["2027-05-20",-1200,"MONTHLY MAINTENANCE",null,null],
        ],
      },
    ],
  },
  {
    name: "repeatedLines",
    pages: [
      [
        [760, [40, "Example Bank"]],
        [748, [40, "Statement period Dec 1 - Dec 31, 2026"]],
        [730, [40, "Beginning balance"], [500, "100.00"]],
        [718, [40, "Ending balance"], [500, "90.00"]],
        [700, [40, "Transaction history"]],
        [688, [40, "Date"], [90, "Description"], [420, "Amount"], [500, "Balance"]],
        [676, [40, "12/05"], [90, "SERVICE FEE"], [420, "-5.00"], [500, "95.00"]],
        [664, [40, "12/05"], [90, "SERVICE FEE"], [420, "-5.00"], [500, "90.00"]],
      ],
    ],
    expected: [
      {
        account: null, from: "2026-12-01", to: "2026-12-31", opening: 10000, closing: 9000, skipped: 0,
        lines: [
          ["2026-12-05",-500,"SERVICE FEE",null,9500],
          ["2026-12-05",-500,"SERVICE FEE",null,9000],
        ],
      },
    ],
  },
];
