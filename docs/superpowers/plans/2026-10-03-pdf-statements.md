# PDF bank statements on Import statement (1.78) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A bank statement in PDF can be chosen on Banking › Import statement; OneBook reads its period, balances and lines the way the client's prototype does, shows whether it proves itself, and hands the lines to Review import.

**Architecture:** A pure TypeScript port of the prototype's reader (`src/p44.html`) turns pdf.js glyphs into statements in integer cents. pdf.js 6 (`pdfjs-dist`, legacy build) is bundled with OneBook and runs in the browser in OneBook's own worker; Node runs the same build for the tests. The import dialog gains a PDF branch; everything after it — Review import, rules, posting — is unchanged.

**Tech Stack:** Next.js 16 (App Router, Turbopack), React 19, Ant Design 6, TypeScript, Vitest, `pdfjs-dist` 6.3.289, `jspdf` (already a dependency, used by the tests to print PDFs), Playwright (parity test).

**Spec:** `docs/superpowers/specs/2026-10-03-pdf-statements-design.md`

## Global Constraints

- US English UI. Money in integer minor units. Nothing posts without a person's click.
- No real statement, bank name, account number or figure in the repository: fixtures are invented ("Example Bank", accounts ending 1111 and 2222). The prototype file stays outside the repository.
- `pdfjs-dist` is pinned at exactly `6.3.289` and comes from OneBook's own bundle (its `legacy/build`), never a CDN.
- OneBook departs from the prototype's reader in exactly four places, each marked `OneBook:` in `lib/domain/pdf-statement.ts`: a figure with two decimals is never a date; "Statement date: November 30, 2026" is read with its whole month name; a line dated a day that does not exist is skipped and counted; a date joined to the words after it is read as the date and the words.
- Two identical lines in one imported file are two lines; the first keeps the duplicate key it always had.
- Run everything from `ctyhp-accounting/`. Never pipe test output through `head`/`tail`; read the pass/fail lines.
- Write any file holding a backslash (regular expressions, the parity script) with the Write or Edit tool — never a bash heredoc or `python -c`, which eat backslashes.
- Stage files by name; never `git add -A`. Write commit messages with `printf` in Git Bash to `../.superpowers/sdd/commit-msg.txt` (never PowerShell — it writes a BOM), check with `od -c ../.superpowers/sdd/commit-msg.txt | head -1` that the first bytes are not `357 273 277`, then `git commit -F ../.superpowers/sdd/commit-msg.txt`. No Co-Authored-By trailer.

Every new file's code below was run before this plan was written: the reader against the prototype's own `p44` code on all sixteen scenarios (11 agree, 5 depart on purpose), all sixteen as real PDFs through pdf.js, `tsc --noEmit`, `eslint` and the tests — 83 passed.

---

### Task 1: The statement reader

**Files:**
- Create: `tests/fixtures/pdf-statements.ts`
- Create: `tests/unit/pdf-statement.test.ts`
- Create: `lib/domain/pdf-statement.ts`

**Interfaces:**
- Consumes: `StatementLine` from `lib/domain/statement-import.ts` (existing).
- Produces: `PdfGlyph`, `PdfCell`, `PdfRow`, `PdfStatementLine`, `PdfStatement`; `moneyMinor(text): number | null`; `readPeriod(joined): { from: string; to: string }`; `rowsFromGlyphs(glyphs): PdfRow[]`; `readPdfStatements(glyphs): PdfStatement[]`; `statementProof(s): { linesMinor: number; differenceMinor: number | null }`; `toStatementLines(s): StatementLine[]`. From the fixture: `PdfScenario`, `ExpectedStatement`, `PDF_SCENARIOS`, `glyphsOf(scenario): PdfGlyph[]`.

- [ ] **Step 1: Write the scenarios.** Create `tests/fixtures/pdf-statements.ts`:

```ts
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
```

- [ ] **Step 2: Write the failing test.** Create `tests/unit/pdf-statement.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  moneyMinor,
  readPdfStatements,
  readPeriod,
  rowsFromGlyphs,
  statementProof,
  toStatementLines,
  type PdfStatement,
} from "@/lib/domain/pdf-statement";
import { PDF_SCENARIOS, glyphsOf } from "../fixtures/pdf-statements";

const compact = (s: PdfStatement) => ({
  account: s.accountNumber,
  from: s.from,
  to: s.to,
  opening: s.openingMinor,
  closing: s.closingMinor,
  skipped: s.skipped,
  lines: s.lines.map((l) => [l.date, l.amountMinor, l.description, l.checkNumber, l.balanceMinor]),
});

describe("readPdfStatements", () => {
  it.each(PDF_SCENARIOS.map((s) => [s.name, s] as const))("%s", (_name, scenario) => {
    const statements = readPdfStatements(glyphsOf(scenario));
    expect(statements.map(compact)).toEqual(scenario.expected);
    for (const s of statements) expect(statementProof(s).differenceMinor).toBe(0);
  });

  it("reads nothing out of no glyphs", () => {
    expect(readPdfStatements([])).toEqual([]);
  });
});

describe("moneyMinor", () => {
  it.each([
    ["1,234.56", 123456],
    ["$1,234.56", 123456],
    ["(12.50)", -1250],
    ["-40.00", -4000],
    ["40.00-", -4000],
    ["0.00", 0],
    ["-0.00", 0],
    ["1101", null],
    ["12.5", null],
    ["", null],
  ] as const)("%s", (text, minor) => {
    expect(moneyMinor(text)).toBe(minor);
  });
});

describe("readPeriod", () => {
  it.each([
    ["Statement period Jan 1 - Jan 31, 2026", { from: "2026-01-01", to: "2026-01-31" }],
    ["Statement period Dec 15, 2025 - Jan 14, 2026", { from: "2025-12-15", to: "2026-01-14" }],
    ["Statement period Dec 15 - Jan 14, 2026", { from: "2025-12-15", to: "2026-01-14" }],
    ["Statement period: 01/01/2026 - 01/31/2026", { from: "2026-01-01", to: "2026-01-31" }],
    ["September 30, 2026\nBeginning balance on 9/1\nEnding balance on 9/30", { from: "2026-09-01", to: "2026-09-30" }],
    ["Statement date: November 30, 2026", { from: "", to: "2026-11-30" }],
    ["As of Nov 30, 2026", { from: "", to: "2026-11-30" }],
    ["Statement date: 11/30/2026", { from: "", to: "2026-11-30" }],
    ["No dates here", { from: "", to: "" }],
  ] as const)("%s", (text, period) => {
    expect(readPeriod(text)).toEqual(period);
  });
});

describe("rowsFromGlyphs", () => {
  it("reads each page top to bottom, one row per baseline, left to right, without blank pieces", () => {
    const rows = rowsFromGlyphs([
      { page: 2, x: 40, y: 760, text: "second page" },
      { page: 1, x: 300, y: 700.4, text: "right" },
      { page: 1, x: 40, y: 699.6, text: "left" },
      { page: 1, x: 40, y: 760, text: "top" },
      { page: 1, x: 90, y: 760, text: "  " },
    ]);
    expect(rows.map((r) => r.text)).toEqual(["top", "left right", "second page"]);
  });

  it("reads a date joined to the words after it as the date and the words", () => {
    const [row] = rowsFromGlyphs([{ page: 1, x: 40, y: 700, text: "03/14 EXAMPLE CLIENT DEPOSIT" }]);
    expect(row.cells.map((c) => c.text)).toEqual(["03/14", "EXAMPLE CLIENT DEPOSIT"]);
  });

  it("does not split a figure or words that only look like they start with a date", () => {
    const [row] = rowsFromGlyphs([
      { page: 1, x: 40, y: 700, text: "75.00 EXAMPLE" },
      { page: 1, x: 200, y: 700, text: "Total 3/4" },
    ]);
    expect(row.cells.map((c) => c.text)).toEqual(["75.00 EXAMPLE", "Total 3/4"]);
  });
});

describe("toStatementLines", () => {
  it("hands Import statement the lines, the cheque number as the reference", () => {
    const [statement] = readPdfStatements(glyphsOf(PDF_SCENARIOS.find((s) => s.name === "chequesRestated")!));
    expect(toStatementLines(statement)[0]).toEqual({
      txn_date: "2026-05-04",
      description: "Check 2001",
      reference: "2001",
      amount_minor: -4500,
      running_balance_minor: 75500,
      raw_line: "05/04 Check 2001 45.00 755.00",
      external_id: null,
    });
  });
});
```

- [ ] **Step 3: Run it to see it fail.**

Run: `npx vitest run tests/unit/pdf-statement.test.ts`
Expected: FAIL — `Cannot find package '@/lib/domain/pdf-statement'` (or "Failed to resolve import").

- [ ] **Step 4: Write the reader.** Create `lib/domain/pdf-statement.ts`:

```ts
/**
 * Reading a bank statement out of a PDF — a port of the client's prototype,
 * Accounting System 2.28 (`src/p44.html`: pdfRowsFrom, readPeriod,
 * headerShape, readStatementRows, splitByAccount and the PDF branch of
 * readStatementFile), in integer cents.
 *
 * Pure: the browser turns the file into glyphs (lib/client/pdf-text.ts) and
 * this turns the glyphs into statements. It departs from the prototype in
 * three places, each marked "OneBook:" where it happens:
 *   1. a figure with two decimals is never a date (the prototype reads 75.00 as
 *      month 75, day 00, and loses a cheque in a grid);
 *   2. "Statement date: November 30, 2026" is read with its whole month name;
 *   3. a line dated a day that does not exist is skipped and counted.
 */
import type { StatementLine } from "./statement-import";

export interface PdfGlyph {
  page: number;
  x: number;
  y: number;
  text: string;
}
export interface PdfCell {
  x: number;
  text: string;
}
export interface PdfRow {
  cells: PdfCell[];
  text: string;
}
export interface PdfStatementLine {
  /** ISO date. */
  date: string;
  /** The words of the row, at most 90 characters. */
  description: string;
  checkNumber: string | null;
  /** Positive is money in. */
  amountMinor: number;
  balanceMinor: number | null;
  /** The row as printed. */
  raw: string;
}
export interface PdfStatement {
  /** Digits only, when the PDF names an account number. */
  accountNumber: string | null;
  from: string | null;
  to: string | null;
  openingMinor: number | null;
  closingMinor: number | null;
  lines: PdfStatementLine[];
  /** Dated rows whose date does not exist. */
  skipped: number;
}

/* ---------- money ---------- */
/* A figure has two decimal places. A cheque number does not, which is how the
   two are told apart without being told which column is which. */
const STMT_MONEY = /\(?-?\$?\d{1,3}(?:,\d{3})+\.\d\d\)?-?|\(?-?\$?\d+\.\d\d\)?-?/g;
const MONEY_CELL = /^\(?-?\$?[\d,]*\d\.\d\d\)?-?$/;

/** A printed figure in cents: `(1.00)`, `-1.00` and `1.00-` are negative. Null when it is not a figure. */
export function moneyMinor(text: string): number | null {
  let s = String(text).replace(/[$,\s]/g, "");
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/-$/.test(s)) {
    negative = true;
    s = s.slice(0, -1);
  }
  if (/^-/.test(s)) {
    negative = true;
    s = s.slice(1);
  }
  const m = /^(\d+)\.(\d\d)$/.exec(s);
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number(m[2]);
  return negative && cents !== 0 ? -cents : cents;
}

function moneyIn(text: string): number[] {
  const out: number[] = [];
  for (const match of String(text).match(STMT_MONEY) ?? []) {
    const value = moneyMinor(match);
    if (value !== null) out.push(value);
  }
  return out;
}

function isMoneyCell(text: string): boolean {
  const t = String(text).trim();
  return MONEY_CELL.test(t) && moneyMinor(t) !== null;
}

/* ---------- dates ---------- */
const MONTHS = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ");
const pad2 = (n: number) => String(n).padStart(2, "0");

function monthNo(word: string): number {
  return MONTHS.indexOf(String(word).slice(0, 3).toLowerCase()) + 1;
}

function isDateCell(text: string): boolean {
  const t = String(text).trim();
  // OneBook: 75.00 is a figure, not month 75 day 00.
  return /^\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?$/.test(t) && !/^\d{1,2}\.\d\d$/.test(t);
}

function isRealDate(iso: string): boolean {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** The period a statement names; empty strings when it names none. */
export function readPeriod(joined: string): { from: string; to: string } {
  let m = joined.match(
    /([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s*(\d{4})?\s*(?:-|–|to|through)\s*([A-Za-z]{3,9})?\.?\s*(\d{1,2}),?\s+(\d{4})/,
  );
  if (m) {
    const y = Number(m[6]);
    const m2 = monthNo(m[4] || m[1]);
    const m1 = monthNo(m[1]);
    if (m2) {
      // A period running Dec 15 - Jan 14, 2026 opened in the year before.
      const y1 = m[3] ? Number(m[3]) : m1 && m1 > m2 ? y - 1 : y;
      return { from: `${y1}-${pad2(m1 || m2)}-${pad2(Number(m[2]))}`, to: `${y}-${pad2(m2)}-${pad2(Number(m[5]))}` };
    }
  }
  m = joined.match(/(\d{1,2})[/.](\d{1,2})[/.](\d{4})\s*(?:-|–|to|through)\s*(\d{1,2})[/.](\d{1,2})[/.](\d{4})/);
  if (m) {
    return { from: `${m[3]}-${pad2(Number(m[1]))}-${pad2(Number(m[2]))}`, to: `${m[6]}-${pad2(Number(m[4]))}-${pad2(Number(m[5]))}` };
  }
  const yr = joined.match(/([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})/);
  const ob = joined.match(/(?:beginning|opening)\s+balance\s+on\s+(\d{1,2})\/(\d{1,2})/i);
  const cb = joined.match(/ending\s+balance\s+on\s+(\d{1,2})\/(\d{1,2})/i);
  if (yr && cb) {
    const y = Number(yr[3]);
    const to = `${y}-${pad2(Number(cb[1]))}-${pad2(Number(cb[2]))}`;
    const from = ob ? `${Number(ob[1]) > Number(cb[1]) ? y - 1 : y}-${pad2(Number(ob[1]))}-${pad2(Number(ob[2]))}` : "";
    return { from, to };
  }
  // OneBook: the gap before the month is matched lazily, so "November" is read whole, not as "ber".
  m = joined.match(/(?:as of|statement date|closing date|ending)\D{0,12}?([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/i);
  if (m && monthNo(m[1])) return { from: "", to: `${m[3]}-${pad2(monthNo(m[1]))}-${pad2(Number(m[2]))}` };
  m = joined.match(/(?:as of|statement date|closing date)\D{0,12}(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/i);
  if (m) return { from: "", to: `${m[3]}-${pad2(Number(m[1]))}-${pad2(Number(m[2]))}` };
  return { from: "", to: "" };
}

/* ---------- rows ---------- */
/**
 * OneBook: pdf.js joins a date to the words printed just after it ("07/02/2026
 * EXAMPLE DEPOSIT") when the gap is narrow, and the prototype then misses the
 * whole line. Such a cell is read as the date and the words, as printed.
 */
function splitLeadingDate(cell: PdfCell): PdfCell[] {
  const m = /^(\S+)\s+(\S.*)$/.exec(cell.text);
  if (!m || !isDateCell(m[1])) return [cell];
  return [
    { x: cell.x, text: m[1] },
    { x: cell.x + 0.01, text: m[2] },
  ];
}

/** A PDF holds glyphs at coordinates, not rows: everything on one baseline is one row, read left to right. */
export function rowsFromGlyphs(glyphs: readonly PdfGlyph[]): PdfRow[] {
  const pages = [...new Set(glyphs.map((g) => g.page))].sort((a, b) => a - b);
  const rows: PdfRow[] = [];
  for (const page of pages) {
    const byLine = new Map<number, PdfCell[]>();
    for (const g of glyphs) {
      const text = String(g.text ?? "").trim();
      if (g.page !== page || !text) continue;
      const key = Math.round(g.y / 3);
      const line = byLine.get(key) ?? [];
      line.push({ x: g.x, text });
      byLine.set(key, line);
    }
    for (const key of [...byLine.keys()].sort((a, b) => b - a)) {
      const cells = byLine.get(key)!.sort((a, b) => a.x - b.x).flatMap(splitLeadingDate);
      rows.push({ cells, text: cells.map((c) => c.text).join(" ") });
    }
  }
  return rows;
}

/* ---------- the figures a statement is built around ---------- */
const CLOSE_LBL = /(ending|closing|new|final)\s+balance|balance\s+(at\s+)?(close|end)\b|closing\s+(ledger|book)/i;
const OPEN_LBL = /(beginning|opening|previous|starting|prior)\s+balance|balance\s+(brought\s+)?forward|opening\s+ledger/i;

/** The figure against a label: on its row, or the first one on the next two rows when the bank wrapped it. */
function labelledFigure(rows: readonly PdfRow[], i: number, label: RegExp): number | null {
  const here = moneyIn(rows[i].text.replace(label, ""));
  if (here.length) return here[here.length - 1];
  for (let j = i + 1; j < Math.min(i + 3, rows.length); j++) {
    const next = moneyIn(rows[j].text);
    if (next.length) return next[0];
  }
  return null;
}

/* ---------- sections and their headings ---------- */
const SKIP_HEADING =
  /daily\s+(\w+\s+)?balances?\b|ending\s+balance\s*$|check\s+images?|balance\s+summary|interest\s+summary|account\s+summary|card\s+summary|how to (balance|reconcile)/i;
const DEBIT_HEADING = /withdraw|debit|^checks?\b|fees?\b|charges?\b|payments? (made|out)/i;
const CREDIT_HEADING = /deposit|credit|additions?|payments? (in|received)/i;

interface Heading {
  dates: number;
  dateX: number | null;
  debit?: number;
  credit?: number;
  amount?: number;
  balance?: number;
  balanceOnly: boolean;
  check: boolean;
}
type MoneyColumn = "debit" | "credit" | "amount" | "balance";

/** A heading split over lines ("Deposits/" over "Credits") is read down each column, not across the page. */
function foldHeading(cells: readonly PdfCell[], above: readonly PdfRow[]): PdfCell[] {
  const cols = cells.map((c) => ({ x: c.x, parts: [c.text] }));
  const near = (c: PdfCell) => {
    let best: (typeof cols)[number] | null = null;
    let bd = 34;
    for (const k of cols) {
      const d = Math.abs(k.x - c.x);
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    return best;
  };
  for (const r of above) {
    // Only a line of several cells that each sit over a column is the top of a wrapped heading.
    if (r.cells.length < 2) continue;
    if (!r.cells.every((c) => near(c) !== null)) continue;
    for (const c of r.cells) near(c)!.parts.unshift(c.text);
  }
  return cols.map((k) => ({ x: k.x, text: k.parts.join(" ") }));
}

function headerShape(cells: readonly PdfCell[], prev: PdfRow | null, prev2: PdfRow | null): Heading | null {
  // A heading names columns; it never holds a figure or a date.
  if (!cells.length) return null;
  if (cells.some((c) => isMoneyCell(c.text) || isDateCell(c.text))) return null;
  const h: Heading = { dates: 0, dateX: null, balanceOnly: false, check: false };
  const above = [prev, prev2].filter(
    (r): r is PdfRow =>
      r !== null && r.cells.length > 0 && r.cells.every((c) => !isMoneyCell(c.text) && !isDateCell(c.text) && c.text.length < 26),
  );
  const merged = foldHeading(cells, above);
  for (const c of merged) {
    const s = c.text.toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
    if (!s) continue;
    if (s === "date" || s === "dates") {
      h.dates++;
      if (h.dateX === null) h.dateX = c.x;
      continue;
    }
    if (/^(debits?|withdrawals?|payments?|money out|paid out|charges?|checks and debits|withdrawals debits?)$/.test(s)) h.debit = c.x;
    else if (/^(credits?|deposits?|money in|paid in|additions?|deposits and credits|deposits credits?)$/.test(s)) h.credit = c.x;
    else if (/^amount( usd| \$)?$/.test(s)) h.amount = c.x;
    else if (/^((ending )?(daily )?balance|running balance|ledger balance|closing balance|balance usd)$/.test(s)) h.balance = c.x;
  }
  if (!h.dates && prev) {
    // "DATE" above "PAID": a line of nothing but Date names the date column of the heading under it.
    const only = prev.cells.filter((c) => /^dates?$/i.test(c.text.replace(/[^A-Za-z]/g, "")));
    if (only.length && only.length === prev.cells.length) {
      h.dates = only.length;
      h.dateX = only[0].x;
    }
  }
  if (!h.dates) return null;
  if (h.debit === undefined && h.credit === undefined && h.amount === undefined && h.balance === undefined) return null;
  h.balanceOnly = h.debit === undefined && h.credit === undefined && h.amount === undefined;
  h.check = /che?c?k/i.test(merged.map((c) => c.text).join(" "));
  return h;
}

function nearestCol(x: number, h: Heading): MoneyColumn | null {
  let best: MoneyColumn | null = null;
  let bd = 70;
  for (const k of ["debit", "credit", "amount", "balance"] as const) {
    const at = h[k];
    if (at === undefined) continue;
    const d = Math.abs(x - at);
    if (d < bd) {
      bd = d;
      best = k;
    }
  }
  return best;
}

const PRINTED_SIGN = /^[-(]|-$|\)$/;

/* ---------- the lines ---------- */
interface ReadLine extends PdfStatementLine {
  section: number;
}

/**
 * One statement's rows. Whether a figure is money in or out is answered by the
 * running balance where there is one, by the sign the bank printed, by the
 * column it sits under, and failing all three by the heading above the table.
 */
function readStatementRows(rows: readonly PdfRow[]) {
  const per = readPeriod(rows.map((r) => r.text).join("\n"));

  let opening: number | null = null;
  let closing: number | null = null;
  rows.forEach((r, i) => {
    if (closing === null && CLOSE_LBL.test(r.text)) closing = labelledFigure(rows, i, CLOSE_LBL);
    if (opening === null && OPEN_LBL.test(r.text)) opening = labelledFigure(rows, i, OPEN_LBL);
  });

  const lines: ReadLine[] = [];
  let skipped = 0;
  let sec: Heading | null = null;
  let secSign = 0;
  let prev: number | null = opening;
  let sawBal = false;
  let skipping = false;
  let prevRow: PdfRow | null = null;
  let prevRow2: PdfRow | null = null;
  let secNo = 0;

  const push = (dateCell: string, cells: readonly PdfCell[], amount: number, bal: number | null, wantCheck: boolean, raw: string) => {
    const dm = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?/.exec(dateCell);
    if (!dm) return;
    let y = dm[3] ? Number(dm[3].length === 2 ? `20${dm[3]}` : dm[3]) : per.to ? Number(per.to.slice(0, 4)) : 0;
    const mo = Number(dm[1]);
    const da = Number(dm[2]);
    if (!dm[3] && per.to) {
      // A line dated 12/28 on a January statement belongs to the December before.
      const pm = Number(per.to.slice(5, 7));
      if (mo > pm + 1 || (mo === 12 && pm === 1)) y -= 1;
    }
    if (!y || !mo || !da) return;
    const date = `${y}-${pad2(mo)}-${pad2(da)}`;
    // OneBook: a day that does not exist is not turned into one that does.
    if (!isRealDate(date)) {
      skipped += 1;
      return;
    }
    const words = cells.filter((c) => !isMoneyCell(c.text) && !isDateCell(c.text)).map((c) => c.text);
    const text = words.join(" ");
    let check = "";
    const named = text.match(/che?c?k\s*(?:no\.?|number|#)?\s*:?\s*(\d{2,7})/i);
    if (named) check = named[1];
    else if (wantCheck) check = words.find((w) => /^\d{2,7}$/.test(w)) ?? "";
    lines.push({
      section: secNo,
      date,
      amountMinor: amount,
      description: text.replace(/\s{2,}/g, " ").trim().slice(0, 90),
      checkNumber: check || null,
      balanceMinor: bal,
      raw,
    });
  };

  for (const r of rows) {
    const t = r.text.trim();
    const h = headerShape(r.cells, prevRow, prevRow2);
    if (h) {
      prevRow2 = prevRow;
      prevRow = r;
      secNo++;
      // A grid of balances is not activity, and a table under a heading we were told to ignore stays ignored.
      sec = skipping || (h.balanceOnly && h.dates > 1) ? null : h;
      continue;
    }
    const current: Heading | null = sec;
    const atDate =
      current && current.dateX !== null
        ? (r.cells.find((c) => isDateCell(c.text) && Math.abs(c.x - (current.dateX as number)) < 70) ?? null)
        : null;
    const first = r.cells.length ? r.cells[0].text : "";
    const dated = isDateCell(first) || atDate !== null;

    if (!dated) {
      if (SKIP_HEADING.test(t)) {
        skipping = true;
        sec = null;
        prevRow2 = prevRow;
        prevRow = r;
        continue;
      }
      if (/^total\b/i.test(t)) {
        sec = null;
        prevRow2 = prevRow;
        prevRow = r;
        continue;
      }
      if (t.length && t.length < 60 && !moneyIn(t).length) {
        if (DEBIT_HEADING.test(t)) {
          secSign = -1;
          skipping = false;
        } else if (CREDIT_HEADING.test(t)) {
          secSign = 1;
          skipping = false;
        } else if (/^transactions?\s+(history|detail|activity)/i.test(t)) {
          // A summary we were told to ignore ends where the next table of activity announces itself.
          skipping = false;
        }
      }
      prevRow2 = prevRow;
      prevRow = r;
      continue;
    }
    prevRow2 = prevRow;
    prevRow = r;
    if (!current) continue;

    // A grid puts several entries on one row; a list puts one.
    if (current.dates > 1) {
      let seg: { date: string; cells: PdfCell[] } | null = null;
      const segs: { date: string; cells: PdfCell[] }[] = [];
      for (const c of r.cells) {
        if (isDateCell(c.text)) {
          seg = { date: c.text, cells: [] };
          segs.push(seg);
          continue;
        }
        if (seg) seg.cells.push(c);
      }
      for (const g of segs) {
        const money = g.cells.filter((c) => isMoneyCell(c.text));
        if (money.length !== 1) continue;
        let v = moneyMinor(money[0].text) as number;
        const signed = PRINTED_SIGN.test(money[0].text.replace(/[$\s]/g, ""));
        if (!signed && secSign) v = secSign * Math.abs(v);
        if (v === 0) continue;
        push(g.date, g.cells, v, null, current.check, [g.date, ...g.cells.map((c) => c.text)].join(" "));
      }
      continue;
    }

    const dateCell = isDateCell(first) ? first : (atDate as PdfCell).text;
    const nums = r.cells.filter((c) => isMoneyCell(c.text)).map((c) => ({ x: c.x, v: moneyMinor(c.text) as number, s: c.text }));
    if (!nums.length) continue;

    let bal: number | null = null;
    let rest = nums.slice();
    if (current.balance !== undefined) {
      // Nearest to the balance column is not enough: a withdrawals column can sit close to it.
      let at = -1;
      let bd = 70;
      nums.forEach((n, k) => {
        if (nearestCol(n.x, current) !== "balance") return;
        const d = Math.abs(n.x - (current.balance as number));
        if (d < bd) {
          bd = d;
          at = k;
        }
      });
      if (at >= 0) {
        bal = nums[at].v;
        rest = nums.filter((_, k) => k !== at);
      }
    }

    let amount: number | null = null;
    const cand = rest.length ? rest[rest.length - 1] : null;
    if (bal !== null && prev !== null) {
      const delta = bal - prev;
      if (cand && Math.abs(delta) === Math.abs(cand.v)) amount = delta;
      else if (!cand) amount = delta;
    }
    if (amount === null && cand) {
      if (PRINTED_SIGN.test(cand.s.replace(/[$\s]/g, ""))) amount = cand.v;
      else if (current.debit !== undefined && current.credit !== undefined) {
        const col = nearestCol(cand.x, current);
        if (col === "debit") amount = -Math.abs(cand.v);
        else if (col === "credit") amount = Math.abs(cand.v);
      }
      if (amount === null && secSign) amount = secSign * Math.abs(cand.v);
    }
    if (amount === null || amount === 0) continue;

    push(dateCell, r.cells, amount, bal, current.check, r.text);
    if (bal !== null) {
      prev = bal;
      sawBal = true;
    }
  }

  // A section that restates lines already read (a statement listing its cheques twice) goes.
  const seen = new Map<string, number>();
  const bySection = new Map<number, ReadLine[]>();
  for (const l of lines) bySection.set(l.section, [...(bySection.get(l.section) ?? []), l]);
  const dropped = new Set<number>();
  [...bySection.keys()]
    .sort((a, b) => a - b)
    .forEach((section, k) => {
      const group = bySection.get(section)!;
      const keyOf = (l: ReadLine) => `${l.date}|${Math.abs(l.amountMinor)}`;
      if (k && group.length >= 2) {
        let dup = 0;
        const used = new Map<string, number>();
        for (const l of group) {
          const key = keyOf(l);
          if ((seen.get(key) ?? 0) - (used.get(key) ?? 0) > 0) {
            dup++;
            used.set(key, (used.get(key) ?? 0) + 1);
          }
        }
        if (dup / group.length >= 0.8) {
          dropped.add(section);
          return;
        }
      }
      for (const l of group) seen.set(keyOf(l), (seen.get(keyOf(l)) ?? 0) + 1);
    });
  const kept = lines.filter((l) => !dropped.has(l.section));

  // With no printed total at either end, the bank's own running balance stands in. Never the books.
  if (closing === null && sawBal) closing = [...kept].reverse().find((l) => l.balanceMinor !== null)?.balanceMinor ?? null;
  if (opening === null && sawBal) {
    const firstWithBalance = kept.find((l) => l.balanceMinor !== null);
    if (firstWithBalance) opening = (firstWithBalance.balanceMinor as number) - firstWithBalance.amountMinor;
  }
  let to = per.to;
  if (!to && kept.length) to = kept.map((l) => l.date).sort()[kept.length - 1];
  return { from: per.from, to, opening: opening as number | null, closing: closing as number | null, lines: kept, skipped };
}

/** A combined statement is cut at each "Account number:" line; the same account named twice is one account. */
function splitByAccount(rows: readonly PdfRow[]): { account: string; rows: PdfRow[] }[] {
  const marks: { at: number; account: string }[] = [];
  rows.forEach((r, i) => {
    const m = r.text.match(/account\s*(?:number|no\.?|#)\s*:\s*([\dXx*-]{4,})/i);
    if (m) marks.push({ at: i, account: m[1].replace(/[^0-9]/g, "") });
  });
  if (marks.length < 2) return [{ account: marks.length ? marks[0].account : "", rows: [...rows] }];
  const cut: typeof marks = [];
  for (const m of marks) {
    if (cut.length && cut[cut.length - 1].account === m.account) continue;
    cut.push(m);
  }
  if (cut.length < 2) return [{ account: cut[0].account, rows: [...rows] }];
  return cut.map((m, k) => ({ account: m.account, rows: rows.slice(m.at, k + 1 < cut.length ? cut[k + 1].at : rows.length) }));
}

/** Every statement in a PDF's glyphs: one per account it names. */
export function readPdfStatements(glyphs: readonly PdfGlyph[]): PdfStatement[] {
  const rows = rowsFromGlyphs(glyphs);
  if (!rows.length) return [];
  const year = rows
    .map((r) => r.text)
    .join(" ")
    .match(/[A-Za-z]{3,9}\s+\d{1,2},\s*(\d{4})/);
  return splitByAccount(rows).map((part) => {
    const s = readStatementRows(part.rows);
    let { from, to } = s;
    if (!to && year && part.rows.length) {
      // A section that names no year of its own borrows the document's.
      const alt = readPeriod(`${part.rows.map((r) => r.text).join("\n")}\nJan 1, ${year[1]}`);
      if (alt.to) {
        to = alt.to;
        from = alt.from;
      }
    }
    return {
      accountNumber: part.account || null,
      from: from || null,
      to: to || null,
      openingMinor: s.opening,
      closingMinor: s.closing,
      lines: s.lines.map((l) => ({
        date: l.date,
        description: l.description,
        checkNumber: l.checkNumber,
        amountMinor: l.amountMinor,
        balanceMinor: l.balanceMinor,
        raw: l.raw,
      })),
      skipped: s.skipped,
    };
  });
}

/** Opening + the lines read, against the printed closing balance. The difference is null when a balance is missing. */
export function statementProof(s: PdfStatement): { linesMinor: number; differenceMinor: number | null } {
  const linesMinor = s.lines.reduce((sum, l) => sum + l.amountMinor, 0);
  const differenceMinor = s.openingMinor !== null && s.closingMinor !== null ? s.closingMinor - (s.openingMinor + linesMinor) : null;
  return { linesMinor, differenceMinor };
}

/** The lines as Import statement takes them. */
export function toStatementLines(s: PdfStatement): StatementLine[] {
  return s.lines.map((l) => ({
    txn_date: l.date,
    description: l.description,
    reference: l.checkNumber,
    amount_minor: l.amountMinor,
    running_balance_minor: l.balanceMinor,
    raw_line: l.raw,
    external_id: null,
  }));
}
```

- [ ] **Step 5: Run the test.**

Run: `npx vitest run tests/unit/pdf-statement.test.ts`
Expected: PASS — 1 file, 40 tests (16 scenarios, the empty case, 10 money forms, 9 period forms, 3 row cases, the line mapping).

- [ ] **Step 6: Typecheck and lint.**

Run: `npm run typecheck` then `npx eslint lib/domain/pdf-statement.ts tests/unit/pdf-statement.test.ts tests/fixtures/pdf-statements.ts`
Expected: no type errors; eslint prints nothing.

- [ ] **Step 7: Commit.**

```bash
git add lib/domain/pdf-statement.ts tests/fixtures/pdf-statements.ts tests/unit/pdf-statement.test.ts
printf 'feat(statements): read a bank statement out of a PDF'"'"'s glyphs\n\nA port of the prototype'"'"'s statement reader (p44) in integer cents, with sixteen\ninvented statements. Four prototype defects are not repeated.\n' > ../.superpowers/sdd/commit-msg.txt
od -c ../.superpowers/sdd/commit-msg.txt | head -1
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 2: Reading the PDF file

**Files:**
- Modify: `package.json`, `package-lock.json` (add `pdfjs-dist` 6.3.289, exact)
- Create: `lib/domain/pdf-glyphs.ts`
- Create: `tests/unit/pdf-glyphs.test.ts`

**Interfaces:**
- Consumes: `PdfGlyph`, `readPdfStatements`, `statementProof` (Task 1); `PdfScenario`, `PDF_SCENARIOS` (Task 1's fixture).
- Produces: `PdfDocumentLike`; `glyphsFromDocument(doc: PdfDocumentLike): Promise<PdfGlyph[]>`; `type PdfReadFailure = "password" | "unreadable"`; `pdfFailure(error: unknown): PdfReadFailure`.

- [ ] **Step 1: Add pdf.js.**

Run: `npm install --save-exact --no-audit --no-fund pdfjs-dist@6.3.289`
Expected: `package.json` gains `"pdfjs-dist": "6.3.289"` under `dependencies` (no caret).

- [ ] **Step 2: Write the failing test.** Create `tests/unit/pdf-glyphs.test.ts`:

```ts
import { jsPDF } from "jspdf";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { glyphsFromDocument, pdfFailure, type PdfReadFailure } from "@/lib/domain/pdf-glyphs";
import { readPdfStatements, statementProof, type PdfGlyph } from "@/lib/domain/pdf-statement";
import { PDF_SCENARIOS, type PdfScenario } from "../fixtures/pdf-statements";

/** The scenario printed as a real PDF: every cell where its glyph sits, on a letter page. */
function pdfOf(scenario: PdfScenario): Uint8Array {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  doc.setFontSize(9);
  scenario.pages.forEach((rows, p) => {
    if (p) doc.addPage();
    for (const [y, ...cells] of rows) for (const [x, text] of cells) doc.text(text, x, 792 - y);
  });
  return new Uint8Array(doc.output("arraybuffer"));
}

async function open(data: Uint8Array): Promise<{ glyphs: PdfGlyph[] } | { failure: PdfReadFailure }> {
  const task = getDocument({ data, verbosity: 0 });
  try {
    return { glyphs: await glyphsFromDocument(await task.promise) };
  } catch (error) {
    return { failure: pdfFailure(error) };
  } finally {
    await task.destroy();
  }
}

describe("a PDF statement read end to end through pdf.js", () => {
  it.each(PDF_SCENARIOS.map((s) => [s.name, s] as const))(
    "%s",
    async (_name, scenario) => {
      const read = await open(pdfOf(scenario));
      if (!("glyphs" in read)) throw new Error(`could not open: ${read.failure}`);
      const statements = readPdfStatements(read.glyphs);
      expect(statements.map((s) => s.lines.length)).toEqual(scenario.expected.map((e) => e.lines.length));
      for (const s of statements) expect(statementProof(s).differenceMinor).toBe(0);
    },
    20_000,
  );

  it("finds no text in a PDF that is only a picture", async () => {
    const doc = new jsPDF({ unit: "pt", format: "letter" });
    doc.rect(40, 40, 200, 100, "F");
    expect(await open(new Uint8Array(doc.output("arraybuffer")))).toEqual({ glyphs: [] });
  }, 20_000);

  it("says a locked PDF wants a password", async () => {
    const doc = new jsPDF({
      unit: "pt",
      format: "letter",
      encryption: { userPassword: "example", ownerPassword: "example", userPermissions: ["print"] },
    });
    doc.text("Example Bank", 40, 40);
    expect(await open(new Uint8Array(doc.output("arraybuffer")))).toEqual({ failure: "password" });
  }, 20_000);

  it("says a file that is not a PDF cannot be read", async () => {
    expect(await open(new Uint8Array([1, 2, 3, 4]))).toEqual({ failure: "unreadable" });
  }, 20_000);
});

describe("pdfFailure", () => {
  it("tells a password from anything else", () => {
    expect(pdfFailure({ name: "PasswordException" })).toBe("password");
    expect(pdfFailure(new Error("broken"))).toBe("unreadable");
    expect(pdfFailure("broken")).toBe("unreadable");
  });
});
```

- [ ] **Step 3: Run it to see it fail.**

Run: `npx vitest run tests/unit/pdf-glyphs.test.ts`
Expected: FAIL — `@/lib/domain/pdf-glyphs` cannot be resolved.

- [ ] **Step 4: Write it.** Create `lib/domain/pdf-glyphs.ts`:

```ts
/**
 * The text of a PDF as glyphs, for the statement reader (pdf-statement.ts).
 *
 * It takes the document pdf.js has already opened — in the browser
 * (lib/client/pdf-text.ts) or in Node for the tests — so it holds no pdf.js
 * import of its own.
 */
import type { PdfGlyph } from "./pdf-statement";

/** The part of pdf.js's PDFDocumentProxy this needs. */
export interface PdfDocumentLike {
  numPages: number;
  getPage(pageNumber: number): Promise<{ getTextContent(): Promise<{ items: readonly unknown[] }> }>;
}

/** Every piece of text on every page, with where it sits on the page; blank pieces are left out. */
export async function glyphsFromDocument(doc: PdfDocumentLike): Promise<PdfGlyph[]> {
  const glyphs: PdfGlyph[] = [];
  for (let page = 1; page <= doc.numPages; page++) {
    const content = await (await doc.getPage(page)).getTextContent();
    for (const item of content.items) {
      const { str, transform } = item as { str?: unknown; transform?: unknown };
      const text = typeof str === "string" ? str.trim() : "";
      if (!text || !Array.isArray(transform)) continue;
      glyphs.push({ page, x: Number(transform[4]), y: Number(transform[5]), text });
    }
  }
  return glyphs;
}

export type PdfReadFailure = "password" | "unreadable";

/** Why pdf.js could not open a file: it wants a password, or it cannot read the file at all. */
export function pdfFailure(error: unknown): PdfReadFailure {
  const name = typeof error === "object" && error !== null && "name" in error ? String((error as { name: unknown }).name) : "";
  return name === "PasswordException" ? "password" : "unreadable";
}
```

- [ ] **Step 5: Run the test.**

Run: `npx vitest run tests/unit/pdf-glyphs.test.ts`
Expected: PASS — 1 file, 20 tests (every scenario printed as a PDF and read back proves; a picture-only PDF has no glyphs; a locked PDF says `password`; four stray bytes say `unreadable`; `pdfFailure`).

- [ ] **Step 6: Typecheck and lint.**

Run: `npm run typecheck` then `npx eslint lib/domain/pdf-glyphs.ts tests/unit/pdf-glyphs.test.ts`
Expected: no type errors; eslint prints nothing.

- [ ] **Step 7: Commit.**

```bash
git add package.json package-lock.json lib/domain/pdf-glyphs.ts tests/unit/pdf-glyphs.test.ts
printf 'feat(statements): the text of a PDF as glyphs, through pdf.js 6\n\nEvery scenario printed as a real PDF and read back proves itself; a scan, a\nlocked file and a broken one each say which they are.\n' > ../.superpowers/sdd/commit-msg.txt
od -c ../.superpowers/sdd/commit-msg.txt | head -1
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 3: Two identical lines in one file are two lines

Today `importStatement` keys each line on bank account, date, amount, description and reference, and the database keeps one row per key (`on conflict (bank_account_id, raw_hash) do nothing` in `acc_import_bank_statement`), so a second identical line in the same file — two $5.00 fees on one day — is silently counted as skipped. This applies to every format.

**Files:**
- Modify: `lib/domain/banking-import.ts` (the `statementLineHash` function and its comment, lines 11–24)
- Modify: `lib/services/banking.ts` (the import at line 10; the payload in `importStatement`)
- Create: `tests/unit/statement-line-hashes.test.ts`

**Interfaces:**
- Produces: `statementLineHash(bankAccountId, line, occurrence = 1): string` (unchanged for `occurrence` 1); `interface StatementLineKey`; `statementLineHashes(bankAccountId, lines): string[]`.

- [ ] **Step 1: Write the failing test.** Create `tests/unit/statement-line-hashes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { statementLineHash, statementLineHashes } from "@/lib/domain/banking-import";

const fee = { txn_date: "2026-12-05", amount_minor: -500, description: "SERVICE FEE", reference: null };

describe("statementLineHashes", () => {
  it("keeps the first line's key as it always was, and gives a repeat in the same file its own", () => {
    const [first, second] = statementLineHashes("acct-1", [fee, { ...fee }]);
    expect(first).toBe(statementLineHash("acct-1", fee));
    expect(second).toBe(statementLineHash("acct-1", fee, 2));
    expect(second).not.toBe(first);
  });

  it("gives the same keys to the same file read twice, so a second import adds nothing", () => {
    const lines = [fee, { ...fee }, { ...fee, amount_minor: -700 }];
    expect(statementLineHashes("acct-1", lines)).toEqual(statementLineHashes("acct-1", lines));
  });

  it("leaves different lines, and lines carrying the bank's own id, as they were", () => {
    const other = { ...fee, description: "WIRE FEE" };
    const withId = { ...fee, external_id: "2026120501" };
    expect(statementLineHashes("acct-1", [fee, other, withId, { ...withId }])).toEqual([
      statementLineHash("acct-1", fee),
      statementLineHash("acct-1", other),
      statementLineHash("acct-1", withId),
      statementLineHash("acct-1", withId),
    ]);
  });
});
```

- [ ] **Step 2: Run it to see it fail.**

Run: `npx vitest run tests/unit/statement-line-hashes.test.ts`
Expected: FAIL — `statementLineHashes is not a function` (or not exported).

- [ ] **Step 3: Count repeats.** In `lib/domain/banking-import.ts`, replace

```ts
 * have been, so it still meets the lines imported before.
 */
export function statementLineHash(
  bankAccountId: string,
  line: { txn_date: string; amount_minor: number; description: string; reference: string | null; external_id?: string | null },
): string {
  return line.external_id
    ? statementRowHash([bankAccountId, "fitid", line.external_id])
    : statementRowHash([bankAccountId, line.txn_date, line.amount_minor, line.description, line.reference]);
}
```

with

```ts
 * have been, so it still meets the lines imported before. The n-th identical
 * line of one file (n ≥ 2) adds its `occurrence`: two $5.00 fees on one day are
 * two lines, and the first keeps the key it always had.
 */
export function statementLineHash(
  bankAccountId: string,
  line: StatementLineKey,
  occurrence = 1,
): string {
  if (line.external_id) return statementRowHash([bankAccountId, "fitid", line.external_id]);
  const parts = [bankAccountId, line.txn_date, line.amount_minor, line.description, line.reference];
  return statementRowHash(occurrence > 1 ? [...parts, `#${occurrence}`] : parts);
}

export interface StatementLineKey {
  txn_date: string;
  amount_minor: number;
  description: string;
  reference: string | null;
  external_id?: string | null;
}

/** The duplicate keys of one file's lines, in file order, each repeat of an identical line counted. */
export function statementLineHashes(bankAccountId: string, lines: readonly StatementLineKey[]): string[] {
  const seen = new Map<string, number>();
  return lines.map((line) => {
    if (line.external_id) return statementLineHash(bankAccountId, line);
    const key = JSON.stringify([line.txn_date, line.amount_minor, line.description, line.reference]);
    const occurrence = (seen.get(key) ?? 0) + 1;
    seen.set(key, occurrence);
    return statementLineHash(bankAccountId, line, occurrence);
  });
}
```

- [ ] **Step 4: Use it on import.** In `lib/services/banking.ts`, change the import `import { statementLineHash } from "@/lib/domain/banking-import";` to `import { statementLineHashes } from "@/lib/domain/banking-import";`, and in `importStatement` replace

```ts
  const payload = rows.map((r) => ({
    txn_date: r.txn_date,
    description: r.description,
    reference: r.reference,
    amount_minor: r.amount_minor,
    running_balance_minor: r.running_balance_minor,
    raw_line: r.raw_line,
    raw_hash: statementLineHash(bankAccountId, r),
    source: "file_upload",
  }));
```

with

```ts
  const hashes = statementLineHashes(bankAccountId, rows);
  const payload = rows.map((r, i) => ({
    txn_date: r.txn_date,
    description: r.description,
    reference: r.reference,
    amount_minor: r.amount_minor,
    running_balance_minor: r.running_balance_minor,
    raw_line: r.raw_line,
    raw_hash: hashes[i],
    source: "file_upload",
  }));
```

- [ ] **Step 5: Run the tests.**

Run: `npx vitest run tests/unit/statement-line-hashes.test.ts tests/unit/statement-files.test.ts`
Expected: PASS — both files (the second already pins `statementLineHash` for single lines and must stay green).

- [ ] **Step 6: Typecheck, lint, every other caller.**

Run: `npm run typecheck` then `npx eslint lib/domain/banking-import.ts lib/services/banking.ts tests/unit/statement-line-hashes.test.ts`, then `grep -rn "statementLineHash" lib app` — every caller other than `statementLineHashes` itself still passes one line and no occurrence.
Expected: no type errors; eslint prints nothing.

- [ ] **Step 7: Commit.**

```bash
git add lib/domain/banking-import.ts lib/services/banking.ts tests/unit/statement-line-hashes.test.ts
printf 'fix(banking): two identical lines in one statement are two lines\n\nThe n-th identical line of a file adds its occurrence to the duplicate key;\nthe first keeps the key it always had, so earlier imports still recognise\nthemselves and importing the same file again still adds nothing.\n' > ../.superpowers/sdd/commit-msg.txt
od -c ../.superpowers/sdd/commit-msg.txt | head -1
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 4: PDF on Import statement

**Files:**
- Modify: `lib/domain/statement-files.ts` (`StatementFormat` and `detectStatementFormat`)
- Modify: `tests/unit/statement-files.test.ts` (two expectations, lines 52 and 58)
- Create: `lib/domain/pdf-statement-view.ts`, `tests/unit/pdf-statement-view.test.ts`
- Create: `lib/client/pdf-text.ts`
- Replace: `app/(app)/banking/ImportStatementModal.tsx`
- Modify: `app/(app)/banking/BankingClient.tsx` (the `bankAccount` prop of `<ImportStatementModal>`, around line 907)

**Interfaces:**
- Consumes: Task 1's `readPdfStatements`, `toStatementLines`, `statementProof`, `PdfStatement`, `PdfGlyph`; Task 2's `glyphsFromDocument`, `pdfFailure`, `PdfReadFailure`; `formatMoney(minor, currencyCode, decimals)` from `lib/format.ts`; `accountNumberDiffers` from `lib/domain/statement-files.ts`.
- Produces: `PDF_MESSAGES`, `periodLabel`, `statementLabel`, `pickStatement`, `summarizeStatement`, `skippedNote`, `StatementSummary` (view); `readPdfGlyphs(data: ArrayBuffer): Promise<{ glyphs: PdfGlyph[] } | { failure: PdfReadFailure }>` (client); `ImportStatementModalProps.bankAccount.currencyCode: string`.

- [ ] **Step 1: Let a PDF through.** In `tests/unit/statement-files.test.ts`, change the two expectations that a PDF is unsupported:

```ts
    expect(detectStatementFormat("sept.pdf", "")).toEqual({ format: "pdf" });
```

```ts
    expect(detectStatementFormat("download", "%PDF-1.7")).toEqual({ format: "pdf" });
```

Run: `npx vitest run tests/unit/statement-files.test.ts` — Expected: FAIL on those two.

Then in `lib/domain/statement-files.ts` replace

```ts
export type StatementFormat = "csv" | "ofx" | "qif";

export const UNSUPPORTED_STATEMENT = "Save the statement as CSV from your bank, or download it as OFX or QFX.";

export function detectStatementFormat(fileName: string, text: string): { format: StatementFormat } | { unsupported: string } {
  const extension = fileName.toLowerCase().split(".").pop() ?? "";
  if (["ofx", "qfx", "qbo"].includes(extension)) return { format: "ofx" };
  if (extension === "qif") return { format: "qif" };
  if (["pdf", "xls", "xlsx", "xlsm", "numbers"].includes(extension)) return { unsupported: UNSUPPORTED_STATEMENT };
  if (text.startsWith("%PDF")) return { unsupported: UNSUPPORTED_STATEMENT };
```

with

```ts
export type StatementFormat = "csv" | "ofx" | "qif" | "pdf";

export const UNSUPPORTED_STATEMENT = "Save the statement as CSV from your bank, or download it as OFX or QFX.";

/** A PDF is read by its layout (pdf-statement.ts); a spreadsheet is not read at all. */
export function detectStatementFormat(fileName: string, text: string): { format: StatementFormat } | { unsupported: string } {
  const extension = fileName.toLowerCase().split(".").pop() ?? "";
  if (["ofx", "qfx", "qbo"].includes(extension)) return { format: "ofx" };
  if (extension === "qif") return { format: "qif" };
  if (extension === "pdf") return { format: "pdf" };
  if (["xls", "xlsx", "xlsm", "numbers"].includes(extension)) return { unsupported: UNSUPPORTED_STATEMENT };
  if (text.startsWith("%PDF")) return { format: "pdf" };
```

Run: `npx vitest run tests/unit/statement-files.test.ts` — Expected: PASS.

- [ ] **Step 2: Write the failing view test.** Create `tests/unit/pdf-statement-view.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { PdfStatement, PdfStatementLine } from "@/lib/domain/pdf-statement";
import { periodLabel, pickStatement, skippedNote, statementLabel, summarizeStatement } from "@/lib/domain/pdf-statement-view";
import { formatMoney } from "@/lib/format";

const usd = (minor: number) => formatMoney(minor, "USD", 2);
const line = (amountMinor: number): PdfStatementLine => ({
  date: "2026-01-05",
  description: "EXAMPLE",
  checkNumber: null,
  amountMinor,
  balanceMinor: null,
  raw: "01/05 EXAMPLE",
});
const statement = (over: Partial<PdfStatement> = {}): PdfStatement => ({
  accountNumber: "00001111",
  from: "2026-01-01",
  to: "2026-01-31",
  openingMinor: 100000,
  closingMinor: 118000,
  lines: [line(-25000), line(-7000), line(50000)],
  skipped: 0,
  ...over,
});

describe("periodLabel", () => {
  it("names the period as a person writes it", () => {
    expect(periodLabel("2026-01-01", "2026-01-31")).toBe("Jan 1 – Jan 31, 2026");
    expect(periodLabel("2025-12-15", "2026-01-14")).toBe("Dec 15, 2025 – Jan 14, 2026");
    expect(periodLabel(null, "2026-11-30")).toBe("closing Nov 30, 2026");
    expect(periodLabel(null, null)).toBe("no period printed");
  });
});

describe("statementLabel", () => {
  it("offers each statement of a combined PDF by account, period and lines", () => {
    expect(statementLabel(statement())).toBe("Account ending 1111 · Jan 1 – Jan 31, 2026 · 3 lines");
    expect(statementLabel(statement({ accountNumber: null, lines: [line(100)] }))).toBe(
      "Account not named · Jan 1 – Jan 31, 2026 · 1 line",
    );
  });
});

describe("pickStatement", () => {
  const both = [statement({ accountNumber: "00001111" }), statement({ accountNumber: "00002222" })];
  it("chooses the statement whose last four match the bank account", () => {
    expect(pickStatement(both, "••••2222")).toBe(1);
  });
  it("falls back to the first when nothing matches or the account has no number", () => {
    expect(pickStatement(both, "••••9999")).toBe(0);
    expect(pickStatement(both, null)).toBe(0);
  });
});

describe("summarizeStatement", () => {
  it("says a statement proves when opening plus the lines is the closing balance", () => {
    const summary = summarizeStatement(statement(), usd);
    expect(summary).toEqual({
      moneyIn: { count: 1, minor: 50000 },
      moneyOut: { count: 2, minor: 32000 },
      proves: true,
      proof: "Opening $1,000.00 + lines $180.00 = $1,180.00, the closing balance on the statement.",
    });
  });

  it("writes money going out as a minus", () => {
    const summary = summarizeStatement(statement({ closingMinor: 68000, lines: [line(-32000)] }), usd);
    expect(summary.proof).toBe("Opening $1,000.00 − lines $320.00 = $680.00, the closing balance on the statement.");
  });

  it("says by how much a statement is out", () => {
    const summary = summarizeStatement(statement({ closingMinor: 120000 }), usd);
    expect(summary.proves).toBe(false);
    expect(summary.proof).toBe(
      "Out by $20.00: opening $1,000.00 + lines $180.00 comes to $1,180.00, and the statement closes at $1,200.00. " +
        "A line may not have been read — check before importing.",
    );
  });

  it("says a statement without its balances cannot prove itself", () => {
    const summary = summarizeStatement(statement({ openingMinor: null }), usd);
    expect(summary.proves).toBe(false);
    expect(summary.proof).toBe("The statement shows no opening or closing balance, so it cannot prove itself.");
  });
});

describe("skippedNote", () => {
  it("counts the lines left out", () => {
    expect(skippedNote(1)).toBe("1 line dated a day that does not exist was left out.");
    expect(skippedNote(2)).toBe("2 lines dated a day that does not exist were left out.");
  });
});
```

Run: `npx vitest run tests/unit/pdf-statement-view.test.ts` — Expected: FAIL, `@/lib/domain/pdf-statement-view` cannot be resolved.

- [ ] **Step 3: Write the view.** Create `lib/domain/pdf-statement-view.ts`:

```ts
/**
 * What Import statement says about a PDF statement before it is imported:
 * which statement, its figures, and whether it proves itself. Pure, so the
 * wording is tested where it is written.
 */
import { statementProof, type PdfStatement } from "./pdf-statement";

export const PDF_MESSAGES = {
  scanned:
    "This PDF holds no text — it looks like a scanned image. Download the statement from online banking as a PDF, or as CSV, OFX or QFX.",
  password: "This PDF is locked with a password. Open it, save a copy without the password, and choose that copy.",
  unreadable: "This PDF could not be read.",
  noLines: "No dated amounts could be read out of this PDF.",
  cents: "A PDF statement can be read only into an account kept in a currency with two decimal places.",
} as const;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortDate(iso: string, withYear: boolean): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}${withYear ? `, ${y}` : ""}`;
}

/** "Jan 1 – Jan 31, 2026", "Dec 15, 2025 – Jan 14, 2026", "closing Nov 30, 2026" or "no period printed". */
export function periodLabel(from: string | null, to: string | null): string {
  if (from && to) return `${shortDate(from, from.slice(0, 4) !== to.slice(0, 4))} – ${shortDate(to, true)}`;
  if (to) return `closing ${shortDate(to, true)}`;
  return "no period printed";
}

/** How a PDF that holds several statements offers each: "Account ending 1111 · Jan 1 – Jan 31, 2026 · 3 lines". */
export function statementLabel(s: PdfStatement): string {
  const account = s.accountNumber ? `Account ending ${s.accountNumber.slice(-4)}` : "Account not named";
  return `${account} · ${periodLabel(s.from, s.to)} · ${s.lines.length} line${s.lines.length === 1 ? "" : "s"}`;
}

/** The statement for the bank account being imported into: the one whose last four digits match, else the first. */
export function pickStatement(statements: readonly PdfStatement[], maskedNumber: string | null): number {
  const last4 = (maskedNumber ?? "").replace(/\D/g, "").slice(-4);
  if (last4.length < 4) return 0;
  const at = statements.findIndex((s) => (s.accountNumber ?? "").slice(-4) === last4);
  return at < 0 ? 0 : at;
}

export interface StatementSummary {
  moneyIn: { count: number; minor: number };
  /** The total paid out, as a positive amount. */
  moneyOut: { count: number; minor: number };
  proves: boolean;
  /** The one sentence under the figures. */
  proof: string;
}

/** The figures Import statement shows for a PDF, and its proof sentence. `money` formats minor units for the account. */
export function summarizeStatement(s: PdfStatement, money: (minor: number) => string): StatementSummary {
  const moneyIn = s.lines.filter((l) => l.amountMinor > 0);
  const moneyOut = s.lines.filter((l) => l.amountMinor < 0);
  const { linesMinor, differenceMinor } = statementProof(s);
  const lines = `${linesMinor < 0 ? "−" : "+"} lines ${money(Math.abs(linesMinor))}`;
  let proof: string;
  if (differenceMinor === null || s.openingMinor === null || s.closingMinor === null) {
    proof = "The statement shows no opening or closing balance, so it cannot prove itself.";
  } else if (differenceMinor === 0) {
    proof = `Opening ${money(s.openingMinor)} ${lines} = ${money(s.closingMinor)}, the closing balance on the statement.`;
  } else {
    proof =
      `Out by ${money(Math.abs(differenceMinor))}: opening ${money(s.openingMinor)} ${lines} comes to ` +
      `${money(s.openingMinor + linesMinor)}, and the statement closes at ${money(s.closingMinor)}. ` +
      "A line may not have been read — check before importing.";
  }
  return {
    moneyIn: { count: moneyIn.length, minor: moneyIn.reduce((sum, l) => sum + l.amountMinor, 0) },
    moneyOut: { count: moneyOut.length, minor: -moneyOut.reduce((sum, l) => sum + l.amountMinor, 0) },
    proves: differenceMinor === 0,
    proof,
  };
}

/** Said under the figures when a printed date does not exist. */
export function skippedNote(count: number): string {
  return count === 1
    ? "1 line dated a day that does not exist was left out."
    : `${count} lines dated a day that does not exist were left out.`;
}
```

Run: `npx vitest run tests/unit/pdf-statement-view.test.ts` — Expected: PASS, 1 file, 9 tests.

- [ ] **Step 4: Read a PDF in the browser.** Create `lib/client/pdf-text.ts`:

```ts
/**
 * A PDF's text, read in the browser, for Import statement.
 *
 * pdf.js comes from OneBook's own bundle the first time a PDF is chosen — not
 * from a CDN at run time, as the prototype fetched version 3.11.174. Its worker
 * is pdf.js's own self-contained module, which the build copies next to the app
 * and pdf.js starts itself. Version 6 compiles no script out of a PDF: the font
 * path behind CVE-2024-4367, which 3.11.174 carries, is gone. The file never
 * leaves the browser; only the lines read are sent.
 */
import type { PdfGlyph } from "@/lib/domain/pdf-statement";
import { glyphsFromDocument, pdfFailure, type PdfReadFailure } from "@/lib/domain/pdf-glyphs";

export async function readPdfGlyphs(data: ArrayBuffer): Promise<{ glyphs: PdfGlyph[] } | { failure: PdfReadFailure }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
  }
  const task = pdfjs.getDocument({ data: new Uint8Array(data), verbosity: 0 });
  try {
    return { glyphs: await glyphsFromDocument(await task.promise) };
  } catch (error) {
    return { failure: pdfFailure(error) };
  } finally {
    await task.destroy();
  }
}
```

The worker is pdf.js's own `legacy/build/pdf.worker.min.mjs`, a self-contained module: Turbopack copies a `new URL("…", import.meta.url)` target as it is, so a hand-written worker entry that imports pdf.js would be copied unbundled and fail in the browser — tried while planning, and why pdf.js's file is pointed at directly.

- [ ] **Step 5: The dialog.** Replace the whole of `app/(app)/banking/ImportStatementModal.tsx` with:

```tsx
"use client";
import { useMemo, useRef, useState } from "react";
import { Alert, Button, Checkbox, Modal, Select, Space, Spin, Typography, Upload } from "antd";
import { InboxOutlined } from "@ant-design/icons";
import { parseCsv } from "@/lib/csv";
import {
  describeStatementParse,
  detectDateOrder,
  detectStatementColumns,
  parseStatementRows,
  statementColumnsComplete,
  type DateOrder,
  type StatementColumnMap,
  type StatementLine,
  type StatementParseResult,
} from "@/lib/domain/statement-import";
import {
  accountNumberDiffers,
  detectStatementFormat,
  parseOfx,
  parseQif,
  type StatementFileResult,
} from "@/lib/domain/statement-files";
import { readPdfStatements, toStatementLines, type PdfStatement } from "@/lib/domain/pdf-statement";
import {
  PDF_MESSAGES,
  periodLabel,
  pickStatement,
  skippedNote,
  statementLabel,
  summarizeStatement,
} from "@/lib/domain/pdf-statement-view";
import { formatMoney } from "@/lib/format";

/**
 * The statement import dialog, in its own file so it is fetched when somebody
 * opens it rather than when they open /banking.
 *
 * It reads the file in the browser — a PDF statement, CSV, OFX, QFX, QBO or QIF
 * — and, for a CSV whose headings it does not know, asks which column is which.
 * A PDF is read by its layout, so it needs no columns; before importing, the
 * dialog shows whether its opening balance plus the lines read comes to its
 * closing balance. The import itself is a server action; Review import opens
 * after it.
 */
export interface ImportStatementModalProps {
  open: boolean;
  bankAccount: { id: string; label: string; maskedNumber: string | null; decimals: number; currencyCode: string };
  importing: boolean;
  onConfirm: (fileName: string, rows: StatementLine[]) => void;
  onCancel: () => void;
}

interface CsvState {
  kind: "csv";
  headers: string[];
  records: Record<string, string>[];
}
type FileState =
  | { kind: "none" }
  | { kind: "reading" }
  | { kind: "unsupported"; message: string }
  | CsvState
  | { kind: "file"; format: "OFX" | "QIF"; result: StatementFileResult }
  | { kind: "pdf"; statements: PdfStatement[] };

interface CsvChoice {
  columns: StatementColumnMap;
  dateOrder: DateOrder;
  flipSigns: boolean;
}

const storageKey = (bankAccountId: string) => `onebook.statement-columns.${bankAccountId}`;
const isPdfFile = (file: File) => /\.pdf$/i.test(file.name) || file.type === "application/pdf";

function rememberedChoice(bankAccountId: string, headers: string[]): CsvChoice | null {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(bankAccountId)) ?? "null") as CsvChoice | null;
    if (!saved) return null;
    const used = Object.values(saved.columns).filter((c): c is string => Boolean(c));
    return used.every((c) => headers.includes(c)) ? saved : null;
  } catch {
    return null;
  }
}

const COLUMN_FIELDS: { key: keyof StatementColumnMap; label: string; required?: boolean }[] = [
  { key: "date", label: "Date", required: true },
  { key: "description", label: "Description" },
  { key: "amount", label: "Amount (one signed column)" },
  { key: "moneyOut", label: "Money out" },
  { key: "moneyIn", label: "Money in" },
  { key: "reference", label: "Reference" },
  { key: "balance", label: "Balance" },
];

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Typography.Text type="secondary" style={{ display: "block", fontSize: 12 }}>
        {label}
      </Typography.Text>
      <Typography.Text strong>{value}</Typography.Text>
    </div>
  );
}

export default function ImportStatementModal({ open, bankAccount, importing, onConfirm, onCancel }: ImportStatementModalProps) {
  const [fileName, setFileName] = useState("");
  const [file, setFile] = useState<FileState>({ kind: "none" });
  const [choice, setChoice] = useState<CsvChoice | null>(null);
  const [showColumns, setShowColumns] = useState(false);
  const [picked, setPicked] = useState(0);
  // A PDF is read asynchronously; choosing another file meanwhile makes the first answer stale.
  const reading = useRef(0);

  async function readPdf(chosen: File, token: number) {
    if (bankAccount.decimals !== 2) {
      setFile({ kind: "unsupported", message: PDF_MESSAGES.cents });
      return;
    }
    setFile({ kind: "reading" });
    const { readPdfGlyphs } = await import("@/lib/client/pdf-text");
    const result = await readPdfGlyphs(await chosen.arrayBuffer());
    if (token !== reading.current) return;
    if ("failure" in result) {
      setFile({ kind: "unsupported", message: PDF_MESSAGES[result.failure] });
      return;
    }
    if (!result.glyphs.length) {
      setFile({ kind: "unsupported", message: PDF_MESSAGES.scanned });
      return;
    }
    const statements = readPdfStatements(result.glyphs).filter((s) => s.lines.length > 0);
    if (!statements.length) {
      setFile({ kind: "unsupported", message: PDF_MESSAGES.noLines });
      return;
    }
    setPicked(pickStatement(statements, bankAccount.maskedNumber));
    setFile({ kind: "pdf", statements });
  }

  function read(chosen: File) {
    const token = ++reading.current;
    setFileName(chosen.name);
    setShowColumns(false);
    setChoice(null);
    if (isPdfFile(chosen)) {
      void readPdf(chosen, token);
      return false;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (token !== reading.current) return;
      const text = String(reader.result ?? "");
      const verdict = detectStatementFormat(chosen.name, text);
      if ("unsupported" in verdict) {
        setFile({ kind: "unsupported", message: verdict.unsupported });
        return;
      }
      if (verdict.format === "pdf") {
        void readPdf(chosen, token);
        return;
      }
      if (verdict.format === "ofx") {
        setFile({ kind: "file", format: "OFX", result: parseOfx(text, bankAccount.decimals) });
        return;
      }
      if (verdict.format === "qif") {
        setFile({ kind: "file", format: "QIF", result: parseQif(text, { decimals: bankAccount.decimals }) });
        return;
      }
      const records = parseCsv(text);
      const headers = records.length ? Object.keys(records[0]) : [];
      const detected = detectStatementColumns(headers);
      const remembered = rememberedChoice(bankAccount.id, headers);
      const next: CsvChoice = remembered ?? {
        columns: detected.columns,
        dateOrder: detectDateOrder(records.map((r) => (detected.columns.date ? r[detected.columns.date] ?? "" : ""))),
        flipSigns: false,
      };
      setFile({ kind: "csv", headers, records });
      setChoice(next);
      setShowColumns(!statementColumnsComplete(next.columns));
    };
    reader.readAsText(chosen);
    return false;
  }

  const parsed: (StatementParseResult & { accountId?: string | null }) | null = useMemo(() => {
    if (file.kind === "file") return file.result;
    if (file.kind === "csv" && choice && statementColumnsComplete(choice.columns)) {
      return parseStatementRows(file.records, {
        decimals: bankAccount.decimals,
        columns: choice.columns,
        dateOrder: choice.dateOrder,
        flipSigns: choice.flipSigns,
      });
    }
    return null;
  }, [file, choice, bankAccount.decimals]);

  const statement = file.kind === "pdf" ? (file.statements[picked] ?? file.statements[0]) : null;
  const rows: StatementLine[] = useMemo(
    () => (statement ? toStatementLines(statement) : (parsed?.rows ?? [])),
    [statement, parsed],
  );
  const money = (minor: number) => formatMoney(minor, bankAccount.currencyCode, bankAccount.decimals);
  const summary = statement ? summarizeStatement(statement, money) : null;
  const fileAccount = file.kind === "file" ? file.result.accountId : (statement?.accountNumber ?? null);
  const wrongAccount = accountNumberDiffers(fileAccount, bankAccount.maskedNumber);

  const okText = !rows.length
    ? "Import"
    : summary
      ? `Import ${rows.length} line${rows.length === 1 ? "" : "s"}${summary.proves ? "" : " anyway"}`
      : `Import ${rows.length} rows`;

  function confirm() {
    if (!rows.length) return;
    if (file.kind === "csv" && choice) {
      try {
        localStorage.setItem(storageKey(bankAccount.id), JSON.stringify(choice));
      } catch {
        // Remembering the columns is a convenience; the import does not need it.
      }
    }
    onConfirm(fileName, rows);
  }

  // Choosing the date column reads that column again for which way round its
  // dates are written; the reader can still override it.
  const setColumn = (key: keyof StatementColumnMap, value: string | null) =>
    setChoice((current) => {
      if (!current) return current;
      const dateOrder =
        key === "date" && value && file.kind === "csv"
          ? detectDateOrder(file.records.map((record) => record[value] ?? ""))
          : current.dateOrder;
      return { ...current, columns: { ...current.columns, [key]: value }, dateOrder };
    });

  return (
    <Modal
      title={`Import a statement into ${bankAccount.label}`}
      open={open}
      onOk={confirm}
      onCancel={onCancel}
      okText={okText}
      okButtonProps={{ disabled: !rows.length, loading: importing }}
      cancelText="Cancel"
      width={720}
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary">
        Choose the file your bank gives you: a PDF statement, a CSV, or a Quicken or QuickBooks download (.ofx, .qfx,
        .qbo, .qif). After the import, Review import proposes an account, a match or a document for every line, and
        nothing is posted until you click Post.
      </Typography.Paragraph>
      <Upload.Dragger
        accept=".pdf,.csv,.txt,.ofx,.qfx,.qbo,.qif,application/pdf"
        beforeUpload={read}
        maxCount={1}
        showUploadList={{ showRemoveIcon: false }}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">Click or drag a statement file here</p>
      </Upload.Dragger>

      {file.kind === "reading" ? (
        <Space style={{ marginTop: 12 }}>
          <Spin size="small" />
          <Typography.Text type="secondary">Reading the PDF…</Typography.Text>
        </Space>
      ) : null}

      {file.kind === "unsupported" ? (
        <Alert style={{ marginTop: 12 }} type="error" showIcon title="This file cannot be read" description={file.message} />
      ) : null}

      {file.kind === "csv" && choice ? (
        <div style={{ marginTop: 12 }}>
          {showColumns ? (
            <Space direction="vertical" size={8} style={{ width: "100%" }}>
              <Typography.Text strong>Choose columns</Typography.Text>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
                {/* A div, not a label: a label forwards the click to the select
                    inside it, which opens the list and closes it again. */}
                {COLUMN_FIELDS.map((field) => (
                  <div key={field.key}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {field.label}
                    </Typography.Text>
                    <Select
                      aria-label={field.label}
                      style={{ width: "100%" }}
                      allowClear={!field.required}
                      placeholder="None"
                      value={choice.columns[field.key] ?? undefined}
                      onChange={(value: string | undefined) => setColumn(field.key, value ?? null)}
                      options={file.headers.map((h) => ({ value: h, label: h }))}
                    />
                  </div>
                ))}
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Dates
                  </Typography.Text>
                  <Select
                    aria-label="Dates"
                    style={{ width: "100%" }}
                    value={choice.dateOrder}
                    onChange={(value: DateOrder) => setChoice({ ...choice, dateOrder: value })}
                    options={[
                      { value: "mdy", label: "Month/Day/Year" },
                      { value: "dmy", label: "Day/Month/Year" },
                    ]}
                  />
                </div>
              </div>
              <Checkbox checked={choice.flipSigns} onChange={(e) => setChoice({ ...choice, flipSigns: e.target.checked })}>
                Flip signs: my file shows payments as positive
              </Checkbox>
              {!statementColumnsComplete(choice.columns) ? (
                <Typography.Text type="danger" style={{ fontSize: 12 }}>
                  Choose the date column, and an amount column or money out and money in.
                </Typography.Text>
              ) : null}
            </Space>
          ) : (
            <Button type="link" style={{ padding: 0 }} onClick={() => setShowColumns(true)}>
              Choose columns
            </Button>
          )}
        </div>
      ) : null}

      {file.kind === "pdf" && file.statements.length > 1 ? (
        <div style={{ marginTop: 12 }}>
          <Typography.Text type="secondary" style={{ display: "block", fontSize: 12 }}>
            This PDF holds {file.statements.length} statements. Import the one for:
          </Typography.Text>
          <Select
            aria-label="Statement"
            style={{ width: "100%" }}
            value={picked}
            onChange={(value: number) => setPicked(value)}
            options={file.statements.map((s, i) => ({ value: i, label: statementLabel(s) }))}
          />
        </div>
      ) : null}

      {wrongAccount ? (
        <Alert
          style={{ marginTop: 12 }}
          type="warning"
          showIcon
          title="This file names a different account"
          description={`The file is for an account ending ${(fileAccount ?? "").slice(-4)}, and you are importing into ${bankAccount.label}. Check before importing.`}
        />
      ) : null}

      {statement && summary ? (
        <div style={{ marginTop: 12 }}>
          <Typography.Paragraph style={{ marginBottom: 8 }}>
            <strong>{fileName}</strong> (PDF): {periodLabel(statement.from, statement.to)}
          </Typography.Paragraph>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
            <Figure label="Opening balance" value={statement.openingMinor === null ? "—" : money(statement.openingMinor)} />
            <Figure label={`Money in · ${summary.moneyIn.count}`} value={money(summary.moneyIn.minor)} />
            <Figure label={`Money out · ${summary.moneyOut.count}`} value={money(summary.moneyOut.minor)} />
            <Figure label="Closing balance" value={statement.closingMinor === null ? "—" : money(statement.closingMinor)} />
          </div>
          <Alert style={{ marginTop: 8 }} type={summary.proves ? "success" : "warning"} showIcon title={summary.proof} />
          {statement.skipped > 0 ? (
            <Typography.Text type="secondary" style={{ display: "block", fontSize: 12, marginTop: 4 }}>
              {skippedNote(statement.skipped)}
            </Typography.Text>
          ) : null}
        </div>
      ) : null}

      {parsed && !statement ? (
        <div style={{ marginTop: 12 }}>
          <Typography.Paragraph style={{ marginBottom: 4 }}>
            <strong>{fileName}</strong>
            {file.kind === "file" ? ` (${file.format})` : " (CSV)"}: {describeStatementParse(parsed)}
          </Typography.Paragraph>
        </div>
      ) : null}

      {rows.length ? (
        <div style={{ marginTop: 4 }}>
          {rows.slice(0, 3).map((row, i) => (
            <Typography.Text key={i} type="secondary" style={{ display: "block", fontSize: 12 }}>
              {row.txn_date} · {row.description} · {(row.amount_minor / 10 ** bankAccount.decimals).toFixed(bankAccount.decimals)}
            </Typography.Text>
          ))}
        </div>
      ) : null}
    </Modal>
  );
}
```

- [ ] **Step 6: Pass the currency.** In `app/(app)/banking/BankingClient.tsx`, in the `bankAccount` prop of `<ImportStatementModal>`, after `decimals: decimalPlaces,` add:

```ts
            currencyCode: selected.currency_code,
```

- [ ] **Step 7: Typecheck, lint, tests.**

Run: `npm run typecheck`, then `npx eslint lib/domain/statement-files.ts lib/domain/pdf-statement-view.ts lib/client/pdf-text.ts "app/(app)/banking/ImportStatementModal.tsx" "app/(app)/banking/BankingClient.tsx" tests/unit/pdf-statement-view.test.ts tests/unit/statement-files.test.ts`, then `npx vitest run tests/unit/pdf-statement.test.ts tests/unit/pdf-glyphs.test.ts tests/unit/pdf-statement-view.test.ts tests/unit/statement-line-hashes.test.ts tests/unit/statement-files.test.ts`
Expected: no type errors; eslint prints nothing; 5 files, 83 tests passed.

- [ ] **Step 8: Build.** The build must succeed and copy pdf.js's worker next to the app.

Run: `npm run build` (from Git Bash; it takes a few minutes — give the Bash call a 600000 ms timeout), then `ls -la .next/static/media | grep pdf.worker`
Expected: the build ends with the route table and no error; `ls` shows `pdf.worker.min.<hash>.mjs` of about 1.3 MB.

- [ ] **Step 9: Commit.**

```bash
git add lib/domain/statement-files.ts tests/unit/statement-files.test.ts lib/domain/pdf-statement-view.ts tests/unit/pdf-statement-view.test.ts lib/client/pdf-text.ts "app/(app)/banking/ImportStatementModal.tsx" "app/(app)/banking/BankingClient.tsx"
printf 'feat(banking): import a PDF statement, and see it prove itself first\n\nImport statement reads a PDF with pdf.js bundled in OneBook, offers each\nstatement of a combined PDF, and shows opening + lines against the closing\nbalance before anything is imported; Import anyway when it does not prove.\n' > ../.superpowers/sdd/commit-msg.txt
od -c ../.superpowers/sdd/commit-msg.txt | head -1
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 5: Proven against the prototype

**Files:**
- Create: `tests/parity/pdf-statement.parity.ts`

**Interfaces:**
- Consumes: `openPrototype(browser, htmlPath)` from `tests/parity/prototype.ts` (existing, Phase 0); `readPdfStatements`, `PdfGlyph` (Task 1); `PDF_SCENARIOS`, `glyphsOf` (Task 1's fixture). Inside the prototype page: its globals `pdfRowsFrom`, `splitByAccount`, `readStatementRows`, `readPeriod`.

- [ ] **Step 1: Write it.** Create `tests/parity/pdf-statement.parity.ts` (with the Write tool — it holds backslashes that must reach the page as written):

```ts
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import type { PdfGlyph } from "@/lib/domain/pdf-statement";
import { readPdfStatements } from "@/lib/domain/pdf-statement";
import { PDF_SCENARIOS, glyphsOf } from "../fixtures/pdf-statements";
import { openPrototype } from "./prototype";

/**
 * The PDF statement reader against the prototype's own (src/p44.html): the same
 * glyphs go through its pdfRowsFrom, splitByAccount and readStatementRows, the
 * way its readStatementFile reads a PDF. The two must agree on every scenario
 * except those carrying `prototypeDiffers`, where OneBook deliberately does not
 * repeat a prototype defect — and there they must differ, or the scenario no
 * longer shows what it says it shows.
 *
 *   PARITY_PROTOTYPE_HTML  the built prototype, accounting-system.html (required)
 *
 * Run: npm run parity
 */
const READ = `(function (glyphs) {
  var pages = {};
  glyphs.forEach(function (g) {
    (pages[g.page] = pages[g.page] || []).push({ str: g.text, transform: [1, 0, 0, 1, g.x, g.y] });
  });
  var rows = [];
  Object.keys(pages).map(Number).sort(function (a, b) { return a - b; }).forEach(function (p) {
    rows = rows.concat(pdfRowsFrom(pages[p]));
  });
  var year = rows.map(function (r) { return r.text; }).join(" ").match(/[A-Za-z]{3,9}\\s+\\d{1,2},\\s*(\\d{4})/);
  var cents = function (v) { return isNaN(v) ? null : Math.round(v * 100); };
  return splitByAccount(rows).map(function (part) {
    var s = readStatementRows(part.rows);
    if (!s.to && year && part.rows.length) {
      var alt = readPeriod(part.rows.map(function (r) { return r.text; }).join("\\n") + "\\nJan 1, " + year[1]);
      if (alt.to) { s.to = alt.to; s.from = alt.from; }
    }
    return {
      account: part.acct || null, from: s.from || null, to: s.to || null,
      opening: cents(s.opening), closing: cents(s.closing),
      lines: s.lines.map(function (l) { return [l.date, cents(l.amount), l.desc, l.check || null, cents(l.bal)]; })
    };
  });
})`;

const onebook = (glyphs: PdfGlyph[]) =>
  readPdfStatements(glyphs).map((s) => ({
    account: s.accountNumber,
    from: s.from,
    to: s.to,
    opening: s.openingMinor,
    closing: s.closingMinor,
    lines: s.lines.map((l) => [l.date, l.amountMinor, l.description, l.checkNumber, l.balanceMinor]),
  }));

describe("PDF statements against the prototype", () => {
  it("reads every scenario as the prototype does, except where OneBook departs on purpose", async () => {
    const htmlPath = process.env.PARITY_PROTOTYPE_HTML?.trim();
    if (!htmlPath) throw new Error("Set PARITY_PROTOTYPE_HTML to the prototype's accounting-system.html");
    const browser = await chromium.launch();
    try {
      const page = await openPrototype(browser, htmlPath);
      let agreed = 0;
      let departed = 0;
      for (const scenario of PDF_SCENARIOS) {
        const glyphs = glyphsOf(scenario);
        const prototype = await page.evaluate(`${READ}(${JSON.stringify(glyphs)})`);
        if (scenario.prototypeDiffers) {
          expect(JSON.stringify(onebook(glyphs)), `${scenario.name}: ${scenario.prototypeDiffers}`).not.toBe(
            JSON.stringify(prototype),
          );
          departed++;
        } else {
          expect(onebook(glyphs), scenario.name).toEqual(prototype);
          agreed++;
        }
      }
      console.log(`parity: PDF statements: ${agreed} agree with the prototype, ${departed} depart on purpose`);
    } finally {
      await browser.close();
    }
  }, 300_000);
});
```

- [ ] **Step 2: Run it against the prototype.**

Run (Git Bash): `PARITY_PROTOTYPE_HTML="C:/Users/pit010/Accounting System 2.28 - source/accounting-system.html" node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.parity.config.ts tests/parity/pdf-statement.parity.ts --reporter=verbose`
Expected: `parity: PDF statements: 11 agree with the prototype, 5 depart on purpose`, and 1 passed.

- [ ] **Step 3: Lint and commit.**

Run: `npx eslint tests/parity/pdf-statement.parity.ts` — Expected: prints nothing.

```bash
git add tests/parity/pdf-statement.parity.ts
printf 'test(parity): the PDF statement reader against the prototype'"'"'s own\n\nSixteen scenarios through the prototype'"'"'s p44 in a headless page: eleven agree\nline for line; the five where OneBook departs on purpose must differ.\n' > ../.superpowers/sdd/commit-msg.txt
od -c ../.superpowers/sdd/commit-msg.txt | head -1
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 6: Changelog 1.78 and the guide

**Files:**
- Modify: `lib/domain/changelog.ts` (a new first entry of `RELEASES`)
- Modify: `lib/domain/system-guide.ts` (the "Bring in the statement" step, around line 289)

- [ ] **Step 1: The release.** In `lib/domain/changelog.ts`, directly after `export const RELEASES: Release[] = [`, insert:

```ts
  {
    version: "1.78",
    date: "2026-10-03",
    headline: "A bank statement in PDF can be imported, and it proves itself before it is.",
    changes: [
      {
        kind: "added",
        title: "PDF statements on Import statement",
        detail:
          "Choose the PDF your bank gives you. OneBook reads its period, its opening and closing balances and every line, and shows whether the opening balance plus the lines comes to the closing balance before anything is imported; if it does not, the button says Import anyway. A PDF that holds several accounts offers each one, and a scanned or password-locked PDF says so. The file never leaves your browser.",
        route: "/banking",
      },
      {
        kind: "fixed",
        title: "Two identical lines in one file are two lines",
        detail:
          "Two $5.00 fees on the same day in one statement used to arrive as one. Every file format now keeps both, and importing the same file again still adds nothing.",
        route: "/banking",
      },
    ],
  },
```

- [ ] **Step 2: The guide.** In `lib/domain/system-guide.ts` replace

```ts
      {
        action: "Bring in the statement",
        control: "Import statement",
        route: "/banking",
        note:
          "Each line is fingerprinted, so importing the same file twice adds " +
          "nothing and two genuinely different lines are never merged.",
      },
```

with

```ts
      {
        action: "Bring in the statement",
        control: "Import statement",
        route: "/banking",
        note:
          "A PDF, CSV, OFX, QFX, QBO or QIF file. Each line is fingerprinted, so importing the same " +
          "file twice adds nothing, and two identical lines in one file are both kept.",
      },
      {
        action: "Check a PDF statement before importing it",
        control: "Import statement",
        route: "/banking",
        note:
          "OneBook reads the period, the opening and closing balances and every line, and shows whether " +
          "the opening balance plus the lines comes to the closing balance. If it does not, a line may not " +
          "have been read: check the statement, then Import anyway or use the bank's CSV. A scanned PDF has " +
          "no text to read.",
      },
```

- [ ] **Step 3: The whole suite.**

Run: `npm run typecheck`, `npm run lint`, then `npm test`
Expected: no type errors; lint 0 errors (warnings that were there before stay); every test file passes — the changelog and guide tests included (`APP_VERSION` is now 1.78). `tests/unit/quality-query-timing.test.ts` measures time and can fail when the machine is busy with the whole suite; if it alone fails, run it on its own (`npx vitest run tests/unit/quality-query-timing.test.ts`) and report both results.

- [ ] **Step 4: Commit.**

```bash
git add lib/domain/changelog.ts lib/domain/system-guide.ts
printf 'docs(changelog): 1.78 PDF statements; guide step for checking one\n' > ../.superpowers/sdd/commit-msg.txt
od -c ../.superpowers/sdd/commit-msg.txt | head -1
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 7: The live check (controller)

No new code.

- [ ] **Step 1:** Build and start the app locally against the live database (as for 1.77), sign in, open the sample company PC-Test.
- [ ] **Step 2:** Print three of the scenarios as PDFs (`debitCreditColumns`, `combinedAccounts`, `repeatedLines`) with the `pdfOf` helper of `tests/unit/pdf-glyphs.test.ts`, into the scratchpad, never the repository.
- [ ] **Step 3:** On Banking, choose PC-Test's sample bank account, Import statement, and choose each PDF: the summary, the proof line, the statement picker (combined), `Import N lines`; import `repeatedLines` and check both $5.00 fees arrive; Review import shows the lines; post one and take it back with Change. Also a locked PDF and a picture-only PDF show their messages.
- [ ] **Step 4:** Screenshots of each, in light and dark, cropped; an approval page beside them. Nothing is pushed until the user approves.
- [ ] **Step 5:** Afterwards, remove what the check imported from PC-Test (void the batch with Undo import) so the sample company is as it was.
