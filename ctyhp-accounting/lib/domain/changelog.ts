/**
 * What changed, release by release.
 *
 * Written by hand when work ships, in the words of the screen rather than of
 * the commit. It exists because of one report: staff opened a page they use
 * every day, found a control somewhere else, and thought the software had
 * broken. A list of commit subjects would not have helped them.
 *
 * Typed data rather than prose so a test can prove every screen it names still
 * exists — a changelog that links to a renamed page is worse than one that
 * links to nothing.
 */

export type ChangeKind = "added" | "changed" | "fixed";

export const CHANGE_KIND_LABEL: Record<ChangeKind, string> = {
  added: "Added",
  changed: "Changed",
  fixed: "Fixed",
};

export interface ChangeEntry {
  kind: ChangeKind;
  /** What a user notices, in the words they would use for it. */
  title: string;
  /** Why it changed, or what to do differently now. */
  detail?: string;
  /** The screen it happened on. Proven to exist by a test. */
  route?: string;
}

export interface Release {
  version: string;
  /** YYYY-MM-DD. */
  date: string;
  /** One line: what this release is about. */
  headline: string;
  changes: ChangeEntry[];
}

/** Newest first. That is the order they are read in, so it is the order stored. */
export const RELEASES: Release[] = [
  {
    version: "1.37",
    date: "2026-08-19",
    headline: "Company Settings reads properly again, and the three sample companies are gone.",
    changes: [
      {
        kind: "fixed",
        title: "Company Settings was breaking its own values apart",
        detail:
          "The settings were laid out in two columns with the label beside " +
          "the value, and the labels here are long — \"Employer " +
          "Identification Number\" is twenty-nine characters. That left the " +
          "values almost no room, so they wrapped inside themselves: the " +
          "masked EIN came out one digit per line, the time zone split as " +
          "\"America/New_Yo\" and \"rk\". Each label now sits above its " +
          "value, and the inventory policy — which is several paragraphs of " +
          "accounting standard, not a one-line fact — has its own place " +
          "below rather than a cell in the grid.",
        route: "/settings/company",
      },
      {
        kind: "changed",
        title: "The three sample companies were removed",
        detail:
          "North Star Bridal, Harbor Gems Trading and Cascade Precious " +
          "Metals were demonstration books and are gone from the company " +
          "switcher. Your own companies are untouched.",
        route: "/settings/companies",
      },
    ],
  },
  {
    version: "1.36",
    date: "2026-08-19",
    headline: "The dark navigation is readable, and the theme control is one button instead of three.",
    changes: [
      {
        kind: "fixed",
        title: "The sidebar menu was too dim to read in dark",
        detail:
          "Every menu item that was not the page you were on came out a " +
          "dark grey on a near-black sidebar. The sidebar is dark in both " +
          "themes, so its text should never have changed with the theme in " +
          "the first place; it now reads the same in dark as it always has " +
          "in light.",
        route: "/dashboard",
      },
      {
        kind: "changed",
        title: "The theme control is one button",
        detail:
          "It was three buttons sitting permanently in the top bar, which " +
          "was already carrying the company switcher, search, New " +
          "transaction, approvals and your account. It is now a single " +
          "icon showing the theme you are in — a sun or a moon — that " +
          "opens the three choices when you click it, with a line " +
          "separating it from the controls beside it.",
        route: "/dashboard",
      },
    ],
  },
  {
    version: "1.35",
    date: "2026-08-19",
    headline: "One Book now has a dark theme, and follows your computer unless you tell it otherwise.",
    changes: [
      {
        kind: "added",
        title: "A dark theme for the whole app",
        detail:
          "Three buttons at the top right: light, dark, or match your " +
          "computer. Matching your computer is the default and it keeps " +
          "matching — if your machine turns dark in the evening, so does " +
          "One Book. Choose light or dark yourself and that choice wins " +
          "until you change it, on this computer. The page never flashes " +
          "white on its way to dark, whichever you pick.",
        route: "/dashboard",
      },
      {
        kind: "changed",
        title: "Every colour in the app now comes from one place",
        detail:
          "Nothing you should notice, and the reason the dark theme is " +
          "possible at all: the app's colours were spread across 309 " +
          "hand-written values in two stylesheets and are now defined once " +
          "each. The light theme was held to exactly what it looked like " +
          "before, screen by screen, with one deliberate exception — 19 " +
          "shades that differed by a byte or two and not to the eye were " +
          "collapsed onto the colour they were imitating.",
        route: "/dashboard",
      },
    ],
  },
  {
    version: "1.34",
    date: "2026-08-17",
    headline:
      "Every company's books are snapshotted on a schedule, and a snapshot can be restored into a new company that proves itself.",
    changes: [
      {
        kind: "added",
        title: "Backups",
        detail:
          "Settings gained a Backups screen: a nightly snapshot of this " +
          "company's books, taken automatically and kept for thirty " +
          "changes. A night the books did not move is recorded as Skipped " +
          "rather than stored again. Each stored snapshot can be downloaded " +
          "as the same portable archive the export button produces. " +
          "Attachments — document scans and other uploaded files — are " +
          "listed in a snapshot but their contents are not part of it.",
        route: "/settings/backups",
      },
      {
        kind: "added",
        title: "Restore a snapshot as a new company",
        detail:
          "A stored snapshot can be loaded into a brand-new company beside " +
          "the running books — nothing in the source company changes. When " +
          "the restore finishes, the copy's trial balance, receivables, " +
          "payables and journal line count are checked against the " +
          "snapshot's own figures, and any difference is named rather than " +
          "summarized. The copy carries vendor tax profiles — taxpayer " +
          "identification numbers included — the same as every other table " +
          "in the books, so it is a company like any other and deserves the " +
          "same care over who can open it. The person who runs the restore " +
          "is the copy's only user; the snapshot's user list and role " +
          "assignments are deliberately not carried over.",
        route: "/settings/backups",
      },
      {
        kind: "fixed",
        title:
          "A large export could repeat or drop a row; two exports of the same books now come back identical",
        detail:
          "Company data export — the same reader a Backups snapshot runs — " +
          "reads a big table a page at a time, and without a fixed reading " +
          "order Postgres does not promise page two agrees with page one: a " +
          "table past a thousand rows could have a row repeated or a row " +
          "left out without either export saying so. Every exported table " +
          "now has a declared order, so a paged read is complete, and " +
          "exporting the same books twice — nothing changed in between — " +
          "gives back two identical files. That sameness is what lets a " +
          "Backups snapshot prove a restore came back whole.",
        route: "/settings/company",
      },
      {
        kind: "added",
        title: "A snapshot now carries the transactions import register",
        detail:
          "The general-ledger and bank-transaction import register is part " +
          "of the company export and every Backups snapshot from now on, " +
          "the same as every other table in the books.",
        route: "/settings/backups",
      },
      {
        kind: "fixed",
        title: "Restoring a snapshot taken before this could fail on its bank transactions",
        detail:
          "A bank transaction that names which import brought it in could " +
          "point at an import record the snapshot never carried, and the " +
          "restore refused the whole company over it. A restore now sets " +
          "that link null when its snapshot predates it, and says so on the " +
          "result — which rows, which link, and why — rather than either " +
          "failing the restore or dropping the loss without a word.",
        route: "/settings/backups",
      },
    ],
  },
  {
    version: "1.33",
    date: "2026-08-18",
    headline: "Bank Transactions: the search box suggests as you type, and the filter bar is laid out in two clear rows.",
    changes: [
      {
        kind: "added",
        title: "The search box suggests what is actually there",
        detail:
          "Start typing and a list drops down of descriptions and " +
          "references that really are in the list you are looking at, each " +
          "with the number of lines behind it. Pick one and it fills the " +
          "box. Nothing is ever suggested that would leave you with an " +
          "empty table, because the suggestions come from the lines already " +
          "narrowed by the account, status and posted-to filters. " +
          "Descriptions shared by several lines come first — those are the " +
          "ones that narrow anything; a wire description carries its own " +
          "date and time and belongs to one line only.",
        route: "/banking",
      },
      {
        kind: "changed",
        title: "The filter bar is two rows instead of three ragged ones",
        detail:
          "Which lines you are looking at — account, status, posted to — is " +
          "the first row. Finding one within them is the second: search, " +
          "and an Amount button holding the exact and min/max boxes that " +
          "used to sit out in the open. The Amount button carries a small " +
          "count when it is filtering. The result count no longer floats in " +
          "the middle of the bar, and the whole thing is shorter than it " +
          "was.",
        route: "/banking",
      },
    ],
  },
  {
    version: "1.32",
    date: "2026-08-18",
    headline: "The Documents & Attachments heading no longer breaks apart on a long bank description.",
    changes: [
      {
        kind: "fixed",
        title: "A long transaction description broke the attachments heading",
        detail:
          "Opening the paperclip on a bank line whose description is a full " +
          "wire message left the heading in pieces — the words " +
          '"Documents", "&" and "Attachments" split across three lines with ' +
          "the transaction text printed over the top of them. The " +
          "description now sits on its own line under the heading, cut to " +
          "the width of the panel, and hovering it shows the whole thing. " +
          "This affects every screen with a paperclip, not only Banking.",
        route: "/banking",
      },
    ],
  },
  {
    version: "1.31",
    date: "2026-08-18",
    headline: "The General Ledger report now has the same draggable column edges as Bank Transactions.",
    changes: [
      {
        kind: "added",
        title: "Resize the General Ledger columns",
        detail:
          "Drag the line between two column headings to make a column wider " +
          "or narrower — Memo especially, which holds the whole bank " +
          "description and used to take whatever room was left after the " +
          "other six columns. Narrow it and Debit, Credit and the running " +
          "balance come into view instead of sitting off the right-hand " +
          "edge. Widen it and the report scrolls sideways so you can read a " +
          "long memo in full. Only the column you drag changes width; the " +
          "others stay exactly where they were. Your widths are remembered " +
          "on this computer.",
        route: "/reports/general-ledger",
      },
    ],
  },
  {
    version: "1.30",
    date: "2026-08-18",
    headline: "A bank transaction delete that fails now leaves the books untouched.",
    changes: [
      {
        kind: "fixed",
        title: "Deleting a categorized bank transaction is now all or nothing",
        detail:
          "Deleting a categorized line does two things: it voids the journal " +
          "entry the categorizing posted, then removes the line. Until now " +
          "those were two separate steps, and if the second was refused — a " +
          "closed period, someone else editing the same line at that moment " +
          "— the first had already happened: the entry stayed voided and the " +
          "line came back as awaiting review. The message said so and asked " +
          "you to press Delete again, but the books had still moved after a " +
          "delete that failed. Both steps now happen together, so a refusal " +
          "leaves the entry posted and the line exactly where it was. " +
          "Nothing changes when the delete succeeds, and every refusal still " +
          "names its own reason.",
        route: "/banking",
      },
    ],
  },
  {
    version: "1.29",
    date: "2026-08-18",
    headline: "Drag the edge of a column heading on Bank Transactions to make that column narrower or wider.",
    changes: [
      {
        kind: "added",
        title: "Resize a Bank Transactions column, the way a spreadsheet does",
        detail:
          "Put the pointer on the line between two column headings and it " +
          "turns into a resize cursor; drag it left or right and only that " +
          "column changes width. Description is the one this is for — it " +
          "used to stretch to fit the longest bank description in the " +
          "account, which pushed Amount, Category and Status off the right " +
          "of the screen. Narrow it and they come back: the table itself " +
          "gets narrower, so there is less to scroll past, not just a " +
          "smaller column. Your widths are remembered on this computer and " +
          "are still there the next time you sign in. Dragging the heading " +
          "itself still moves the column, as it did before — the edge " +
          "resizes, the middle moves.",
        route: "/banking",
      },
      {
        kind: "changed",
        title: "Long descriptions and references are now cut to their column",
        detail:
          "A description or a reference longer than its column ends in an " +
          "ellipsis, and hovering shows the whole thing. Before this, a " +
          "36-character payment reference wrapped onto three lines and made " +
          "every row in the table taller.",
        route: "/banking",
      },
    ],
  },
  {
    version: "1.28",
    date: "2026-08-17",
    headline: "Drag a column header on Bank Transactions to put it wherever you can see it.",
    changes: [
      {
        kind: "added",
        title: "Drag and drop to reorder Bank Transactions columns",
        detail:
          "Press and drag any column heading — Date, Description, Account " +
          "source, Reference, Amount, Category, Match, or Status — to put " +
          "it next to whatever you are comparing it against, the way a " +
          "spreadsheet does. Every row's data moves with its column, so an " +
          "amount can never land under the wrong heading. The " +
          "row-selection checkbox and the Delete/attachment buttons at the " +
          "right edge cannot be dragged and cannot be dropped on — only " +
          "the eight data columns reorder. The order lasts for the " +
          "current session only and resets the next time you sign in.",
        route: "/banking",
      },
    ],
  },
  {
    version: "1.27",
    date: "2026-08-17",
    headline: "Delete now works on a categorized Bank Transaction, not only an unreviewed one.",
    changes: [
      {
        kind: "changed",
        title: "Delete a categorized bank transaction",
        detail:
          "Correction to a same-day decision: Delete used to appear only on " +
          "a line still awaiting review, because categorizing posts a " +
          "journal entry and a posted line could not be removed. On a " +
          "company where every line had already been categorized, that " +
          "left no row with a Delete button at all. Delete now appears on " +
          "every row; on a categorized line it voids the journal entry " +
          "categorizing it posted, then deletes the line — one confirmed " +
          "click, with both effects named before anything happens and the " +
          "entry's own number when one is known. Where the books genuinely " +
          "refuse — a closed period, a line settled against an invoice or " +
          "bill, a line matched by a transactions import or by something " +
          "else — the button stays visible but disabled, with the real " +
          "reason in its tooltip instead of a hidden control or a generic " +
          "failure after the click.",
        route: "/banking",
      },
    ],
  },
  {
    version: "1.26",
    date: "2026-08-17",
    headline: "Select transactions on Bank Transactions and set their Category or Account all at once.",
    changes: [
      {
        kind: "added",
        title: "Select bank transactions and batch-assign Category or Account",
        detail:
          "A checkbox on each row and a Select all in the header (Select " +
          "all covers the current page after filters, not every page). With " +
          "one or more rows selected, Set Category and Set Account post the " +
          "same account against every selected line that is still awaiting " +
          "review. A row already matched or settled is left untouched and " +
          "counted separately — the confirmation states how many rows will " +
          "change and how many will be skipped and why before anything " +
          "saves, and the result afterward names successes, failures, and " +
          "skips, with the real reason behind each failure rather than a " +
          "generic error.",
        route: "/banking",
      },
    ],
  },
  {
    version: "1.25",
    date: "2026-08-17",
    headline:
      "The page-size bug fixed on Bank Transactions last release was also hiding on nine other screens — now fixed there too.",
    changes: [
      {
        kind: "fixed",
        title: "The page size you chose on the General Ledger report was ignored",
        detail:
          "Same bug as Bank Transactions in 1.23, on the report where a long " +
          "run of activity matters most: picking 100 rows a page moved the " +
          "dropdown but the table kept showing 50. All the size-changer " +
          "choices now take effect.",
        route: "/reports/general-ledger",
      },
      {
        kind: "fixed",
        title: "The page size you chose on Fixed Assets was ignored",
        detail:
          "Both the asset register and the depreciation-schedule dialog you " +
          "open from it kept the dropdown and the table out of sync the same " +
          "way Bank Transactions did.",
        route: "/fixed-assets",
      },
      {
        kind: "fixed",
        title: "The page size you chose on the Fixed Assets report was ignored",
        detail: "Both the asset register and the depreciation views on this report.",
        route: "/reports/fixed-assets",
      },
      {
        kind: "fixed",
        title: "The page size you chose on Recurring was ignored",
        detail: "Both the schedule list and its occurrence history below it.",
        route: "/recurring",
      },
      {
        kind: "fixed",
        title: "The page size you chose on the Transactions report was ignored",
        route: "/reports/transactions",
      },
      {
        kind: "fixed",
        title: "The page size you chose on Pay Bills was ignored",
        route: "/pay-bills",
      },
      {
        kind: "fixed",
        title: "The page size you chose on the Audit Trail was ignored",
        route: "/settings/audit",
      },
      {
        kind: "fixed",
        title: "The page size you chose on Approvals was ignored",
        detail: "The Decided list, which is the one that grows.",
        route: "/approvals",
      },
      {
        kind: "fixed",
        title: "The page size you chose on Payments was ignored",
        route: "/payments",
      },
    ],
  },
  {
    version: "1.24",
    date: "2026-08-17",
    headline: "Bank Transactions and the General Ledger can now be searched by keyword and filtered by amount.",
    changes: [
      {
        kind: "added",
        title: "Search and amount filters on Bank Transactions",
        detail:
          "A search box and three amount fields — Exact amount, Min amount, " +
          "and Max amount — sit beside the account, status, and posted-to " +
          "filters. Search matches Description and Reference. The amount " +
          "fields match a transaction's size regardless of whether it was " +
          "money in or money out — typing 1250 finds a $1,250.00 line " +
          "whichever direction it moved, the same way the amount reads on a " +
          "printed statement. All four filters combine, and clearing them " +
          "returns the list to what it showed before.",
        route: "/banking",
      },
      {
        kind: "added",
        title: "Search and amount filters on the General Ledger report",
        detail:
          "The same search and amount filters are now available when " +
          "reviewing an account's activity: search matches Entry number, " +
          "Memo, and Source, and the amount fields match whichever of Debit " +
          "or Credit a line carries. Filtering only changes which lines are " +
          "shown — the Opening, Closing, and each line's running balance " +
          "stay exactly as posted.",
        route: "/reports/general-ledger",
      },
    ],
  },
  {
    version: "1.23",
    date: "2026-08-17",
    headline: "Choosing 100 rows a page on Bank Transactions now actually shows 100 rows.",
    changes: [
      {
        kind: "fixed",
        title: "The page size you chose on Bank Transactions was ignored",
        detail:
          "Picking 50 or 100 rows a page moved the dropdown but left the " +
          "table showing 25 — the size you picked was thrown away on the " +
          "next redraw. All three sizes now take effect, the page count " +
          "recalculates, and if the size you picked would leave you past the " +
          "last page, you land on the last valid page instead of an empty " +
          "one.",
        route: "/banking",
      },
    ],
  },
  {
    version: "1.22",
    date: "2026-08-17",
    headline: "The dashboard could fail to load; that is fixed.",
    changes: [
      {
        kind: "fixed",
        title: "The dashboard could crash instead of loading",
        detail:
          "The income and expense trend chart could fail to render for a " +
          "company whose six-, three-, or twelve-month window landed on " +
          "certain totals, taking the whole dashboard down with it — the " +
          "page showed its \"could not load\" screen instead of your numbers. " +
          "The chart's axis labels are fixed; nothing about your figures was " +
          "ever wrong.",
        route: "/dashboard",
      },
    ],
  },
  {
    version: "1.21",
    date: "2026-08-15",
    headline:
      "The Profit and Loss can be read one month or one quarter at a time, and each line can show its share of income.",
    changes: [
      {
        kind: "added",
        title: "Profit and Loss columns by month or by quarter",
        detail:
          "Profit and loss columns now offers By month and By quarter beside " +
          "One period and Two periods, laying the range out with one column per " +
          "period and a Total at the right — the way a month that lost money, " +
          "or a cost that has been climbing all year, actually shows up. Only " +
          "the first and last column are ever partial, when the range picked " +
          "does not start or end on a period boundary; every column between " +
          "them is a whole month or quarter. A range that would need more than " +
          "24 columns is refused rather than fetched — the screen says how " +
          "many columns it would be and offers to narrow the range or show it " +
          "by quarter instead, and never switches that for you on its own.",
        route: "/reports",
      },
      {
        kind: "added",
        title: "% of Income on the Profit and Loss",
        detail:
          "A switch beside the column choice adds each line's share of that " +
          "column's Total Income — Other Income is not part of it, which the " +
          "column's tooltip says. It is on by default for one or two periods " +
          "and off by default for a month-by-month or quarter-by-quarter view, " +
          "where a percent beside every column would double an already wide " +
          "table, but it is never disabled there: turn it on and it stays on. " +
          "The Total column's percentage is worked out from the Total column's " +
          "own income, not averaged from the periods beside it — averaging " +
          "percentages across columns of different sizes is not the same " +
          "number as the percentage of the total, and would have been wrong. " +
          "The exported file carries the same percentages the screen shows.",
        route: "/reports",
      },
      {
        kind: "fixed",
        title: "The Balance Sheet Trend's exported figures were 100 times too large",
        detail:
          "Its PDF and Excel export skipped the conversion from the ledger's " +
          "internal cents to dollars, so every figure in the file read 100 " +
          "times the real balance — $1,000 exported as $100,000. The on-screen " +
          "table was correct the entire time, which is exactly why nothing " +
          "gave it away. If you have already sent one of these exported files " +
          "to a bank, an accountant, or anyone else, resend it — the export is " +
          "now correct.",
        route: "/reports",
      },
      {
        kind: "fixed",
        title: "AR and AP Aging summary exports were also 100 times too large",
        detail:
          "The same missing conversion was hiding in the aging summary " +
          "grid's export: every party's column and the Total column both came " +
          "out 100 times the real balance, on both the AR Aging and AP Aging " +
          "pages. The on-screen grid was correct throughout. Resend any aging " +
          "summary file already sent out.",
        route: "/reports/ar-aging",
      },
      {
        kind: "fixed",
        title: "General Ledger Posting export was 100 times too large",
        detail:
          "The same bug, one more place it was hiding: the Amount column in " +
          "the General Ledger Posting export skipped the same conversion the " +
          "on-screen table applied. Resend any exported file from this report; " +
          "the screen itself was never wrong.",
        route: "/reports/gl-posting",
      },
      {
        kind: "fixed",
        title: "Transaction List export no longer assumes every currency has two decimal places",
        detail:
          "The Transaction List export divided every amount by a fixed 100 " +
          "instead of by the company's own currency scale. That happened to " +
          "read correctly for a two-decimal currency like USD, but would have " +
          "silently misreported a currency with a different number of decimal " +
          "places — VND, for one, uses none. Nothing to resend for a " +
          "USD company; caught and fixed alongside the others above.",
        route: "/reports/transactions",
      },
    ],
  },
  {
    version: "1.20",
    date: "2026-08-15",
    headline:
      "The journal reaches every entry and says when it cannot, a long note no longer pushes the buttons off the screen, and a re-imported file stops losing rows.",
    changes: [
      {
        kind: "fixed",
        title: "Importing the same file again no longer drops rows without saying so",
        detail:
          "The check for what had already been brought across only read the "
          + "first thousand bank lines, and reported nothing when it stopped "
          + "there. Anything past that was offered again, refused on the way in, "
          + "and left out of the books — the screen promising a number of rows "
          + "and fewer arriving. If you have imported the same file twice, it is "
          + "worth checking the account totals against where they came from.",
        route: "/settings/import",
      },
      {
        kind: "fixed",
        title: "Journal Entries can reach an entry from any year, and says how many it is not showing",
        detail:
          "The list read the newest thousand entries and behaved as though that "
          + "were all of them, so an entry from an earlier year could not be "
          + "found however far you paged. It now says \"showing the 1,000 most "
          + "recent of 7,533\" when it is holding back, and a date range beside "
          + "the New Journal Entry button narrows the list to reach the rest.",
        route: "/journal",
      },
      {
        kind: "changed",
        title: "A report column is headed with the period it covers",
        detail:
          "Profit and loss columns said Current and Prior, which tells you only "
          + "which came first. They now carry the period itself — 2024, Aug 2026, "
          + "Q1 2026 — so the figures can be read without holding the dates from "
          + "the subtitle in your head, and a printed page still says what it is. "
          + "The exported file takes the same headings.",
        route: "/reports",
      },
      {
        kind: "fixed",
        title: "A long note no longer pushes the buttons off the side of the screen",
        detail:
          "A memo, a description or a reason has no length limit, and one long "
          + "enough was deciding how wide its whole table had to be — leaving the "
          + "amounts on the general ledger, and the Reverse button on Journal "
          + "Entries, reachable only by scrolling sideways on a page that gives "
          + "no sign it scrolls. Those columns are now cut to fit; hover to read "
          + "the whole of one. The same is done on approvals, stock movements, "
          + "users, vendor tax history and the purchase order screens.",
        route: "/journal",
      },
    ],
  },
  {
    version: "1.19",
    date: "2026-08-15",
    headline:
      "A report can be read on its own now, the general ledger fits the page, and a comparison covers the period it says it does.",
    changes: [
      {
        kind: "fixed",
        title: "A comparison covers the period named at the top of it",
        detail:
          "The prior column was worked out by counting back the same number of "
          + "days, which is not the same as the period before. Comparing 2024 "
          + "reached back into 2022, because 2024 is a leap year and the count "
          + "ran a day past the start of 2023. Comparing 2025 began the prior "
          + "column on 2 January, so anything posted on New Year's Day was "
          + "missing from it. A month is now compared with the month before, a "
          + "quarter with the quarter before and a year with the year before. "
          + "Figures in a comparison column will change, because they were "
          + "wrong.",
        route: "/reports",
      },
      {
        kind: "added",
        title: "A balance sheet or profit and loss on its own, with no comparison",
        detail:
          "Both reports offer One period beside the column choices. The prior "
          + "column and the two variance columns go with it, the heading drops "
          + "the word Comparison, and the exported file matches what is on "
          + "screen. Two periods is still what you get unless you ask "
          + "otherwise, so a link somebody saved still shows what it showed.",
        route: "/reports",
      },
      {
        kind: "fixed",
        title: "The general ledger keeps its amounts on the screen",
        detail:
          "Debit, Credit and Running sat off the right-hand edge, reachable "
          + "only by a scrollbar at the foot of a page thousands of lines long, "
          + "and zooming out did not help. A bank memo carries the whole wire "
          + "description, and it was deciding how wide the table had to be. The "
          + "memo is now cut to its column and the amounts stay where they can "
          + "be read.",
        route: "/reports/general-ledger",
      },
      {
        kind: "added",
        title: "Hover a memo to read all of it, and the ledger turns pages",
        detail:
          "The full memo opens beside the pointer, wrapped so a long wire "
          + "description is readable. The ledger now shows fifty lines to a "
          + "page with the count beside it, rather than every line at once. The "
          + "running balance is worked out over the whole date range, so it "
          + "carries on from page to page rather than starting again.",
        route: "/reports/general-ledger",
      },
    ],
  },
  {
    version: "1.18",
    date: "2026-08-13",
    headline: "There is now a page that says whether One Book is working, so nobody has to ring and ask.",
    changes: [
      {
        kind: "added",
        title: "A page at /status that answers: is it One Book, or is it me",
        detail:
          "Open it and it says whether the database and the sign-in service are "
          + "answering. It works while signed out and while One Book itself is "
          + "having trouble, because those are the moments you would look. "
          + "Until now the only way to find out was to telephone somebody.",
        // No route: the changelog's route check only knows the pages inside the
        // main application, and this one deliberately sits outside it so it can
        // still load when the rest cannot.
      },
    ],
  },
  {
    version: "1.17",
    date: "2026-08-11",
    headline: "An overdue total no longer relies on being red, and the sidebar shows what you are pointing at.",
    changes: [
      {
        kind: "changed",
        title: "An overdue total carries a warning mark, not only a red figure",
        detail:
          "The overdue figures on Pay Bills, the cash flow forecast and the customer credit "
          + "report now show a warning mark beside the amount. A figure that is only red says "
          + "nothing to a reader who cannot pick that red out, and nothing at all once the "
          + "page is printed.",
        route: "/pay-bills",
      },
      {
        kind: "fixed",
        title: "The sidebar shows which item the pointer is on",
        detail:
          "The highlight under the pointer was very nearly the same shade as the sidebar "
          + "behind it, so on most screens there was nothing to see. It is clearly lighter now.",
        route: "/dashboard",
      },
      {
        kind: "changed",
        title: "A few greys, reds and greens shifted by a shade",
        detail:
          "Colour is now set in one place instead of being written out screen by screen, "
          + "which had left three different reds and four different greens all meaning the "
          + "same thing. Nothing moved and nothing reads differently — a handful of shades "
          + "are a step lighter or darker, most visibly on table column headings.",
      },
    ],
  },
  {
    version: "1.16",
    date: "2026-08-08",
    headline: "Typing a word finds the account even when your chart calls it something else.",
    changes: [
      {
        kind: "added",
        title: "The account search understands words that mean the same thing",
        detail:
          "Type “wages” and it finds “Payroll Liabilities”; type “fee” and it finds “Bank "
          + "Service Charges”. A chart imported from another product uses that product’s "
          + "wording, and nobody tries three spellings before deciding the search is broken. "
          + "When a word other than the one you typed found the account, the list says which.",
        route: "/banking",
      },
      {
        kind: "added",
        title: "The list says what each account is, and which side it sits on",
        detail:
          "Every suggestion now shows its type and whether it is a debit or a credit account, "
          + "so you can see what choosing it will do before you choose it.",
        route: "/banking",
      },
      {
        kind: "changed",
        title: "The closest answer comes first",
        detail:
          "An exact account code beats everything — it can only mean one account. Then the "
          + "chart’s own wording, then a word that means the same. Typing “sales” reaches Sales "
          + "Revenue before Sales Tax Payable.",
        route: "/banking",
      },
    ],
  },
  {
    version: "1.15",
    date: "2026-08-08",
    headline: "Categorising a bank line now means posting it, and the column says what was posted.",
    changes: [
      {
        kind: "changed",
        title: "The Category column names an account, and choosing one posts to the ledger",
        detail:
          "It used to hold a free-form label — a word you had to invent first, saved beside the "
          + "line and posted nowhere. Nobody had invented one, so it was an empty dropdown and "
          + "there was no way to categorise anything. Type a word now and every account whose "
          + "code or name contains it is offered; choosing one posts the entry, and the line "
          + "becomes matched.",
        route: "/banking",
      },
      {
        kind: "fixed",
        title: "A line already in the books is not asked to be categorised again",
        detail:
          "“Uncategorized” sat beside “Matched” on lines that were already posted. Each now "
          + "shows the account its entry went to, and its entry number. A line settled against "
          + "an invoice says so rather than offering a control that would refuse.",
        route: "/banking",
      },
      {
        kind: "added",
        title: "Change what a line was categorised as",
        detail:
          "Change voids the entry and hands the line back to the review queue, so a wrong "
          + "account is a correction rather than something to live with. Only entries this "
          + "column made — an import batch and an invoice settlement own their own.",
        route: "/banking",
      },
      {
        kind: "changed",
        title: "Filter the queue by the account lines were posted to",
        detail:
          "The old filter listed labels nobody had made. It now lists the accounts these lines "
          + "actually went to, and “Not categorised yet” finds the ones still awaiting review.",
        route: "/banking",
      },
    ],
  },
  {
    version: "1.14",
    date: "2026-08-08",
    headline: "Check how a chart of accounts file's types were read before the import settles them.",
    changes: [
      {
        kind: "added",
        title: "Review the account types before the import is finalised",
        detail:
          "Importing a chart of accounts translates each type word — QuickBooks writes “Other "
          + "Current Asset”, and which One Book type that becomes decides where the money sits "
          + "on the balance sheet for every transaction afterwards. The preview now lists each "
          + "word in your file with what it was read as and how many accounts carry it, and lets "
          + "you change any of them. Grouped by word, because ninety-five accounts are usually a "
          + "dozen words.",
        route: "/settings/import",
      },
      {
        kind: "changed",
        title: "A type nothing here matches is offered a choice rather than only refused",
        detail:
          "It was reported row by row as “no equivalent here — map it by hand”, which meant "
          + "editing the file. You can now say what it means in the same panel.",
        route: "/settings/import",
      },
    ],
  },
  {
    version: "1.13",
    date: "2026-08-08",
    headline: "Scanning an uploaded document looks in the company you are working in.",
    changes: [
      {
        kind: "fixed",
        title: "A document uploaded outside the first company is scanned straight away again",
        detail:
          "The scan that runs on upload was looking for the file in the first company’s books "
          + "whichever company you were in, so outside it the file sat unscanned until the "
          + "overnight job caught up — and the Rescan button failed outright. Both now look "
          + "where the file actually is.",
      },
    ],
  },
  {
    version: "1.12",
    date: "2026-08-08",
    headline: "A QuickBooks account list reads correctly, and the ledger tab answers a missing account where it finds it.",
    changes: [
      {
        kind: "fixed",
        title: "A QuickBooks chart of accounts no longer reads the number as the name",
        detail:
          "“Account #” was being matched to the account name, leaving the code column empty "
          + "— on the first file most migrations start with. The “#” is now read as the word "
          + "“number”, so the code lands in the code column and the name in the name column.",
        route: "/settings/import",
      },
      {
        kind: "added",
        title: "The general ledger tab offers the same picker the transactions tab does",
        detail:
          "It listed the account names it could not find and sent you to another screen to create "
          + "them. It now lets you point each name at an account you already have, or create it "
          + "there with the type you choose — which is the only remedy available when the file "
          + "is a customer’s export you cannot edit.",
        route: "/settings/import",
      },
    ],
  },
  {
    version: "1.11",
    date: "2026-08-08",
    headline: "You can see which rows an import leaves out, and check the money before it posts.",
    changes: [
      {
        kind: "added",
        title: "Download the rows an import will leave out",
        detail:
          "The preview said “100 row(s) will be left out” and stopped there. There is now a "
          + "button beside that count: it writes a CSV with your file’s own columns, the line "
          + "number, and the reason each row was left out — so it opens beside the original and "
          + "can be corrected against it.",
        route: "/settings/import",
      },
      {
        kind: "fixed",
        title: "A row is reported by its line in the file",
        detail:
          "The preview said “Row 543” for what a spreadsheet shows as line 544, because it "
          + "counted rows it had parsed rather than lines in the file — and drifted further "
          + "after every blank line. It now names the line you would scroll to.",
        route: "/settings/import",
      },
      {
        kind: "added",
        title: "Money in and money out, not only the net",
        detail:
          "A transactions preview now shows both, and so does the box that asks you to confirm. A "
          + "single net figure hides a sign column read the wrong way round; two figures do not. "
          + "If every row in a file moves money the same way, it says so before you import.",
        route: "/settings/import",
      },
    ],
  },
  {
    version: "1.10",
    date: "2026-08-08",
    headline: "An imported chart of accounts is classified the way a hand-typed one always was.",
    changes: [
      {
        kind: "fixed",
        title: "Imported accounts no longer arrive unclassified",
        detail:
          "An account you type in gets its cash-flow role from its type. One arriving through an "
          + "import did not — so a chart brought across from Wave landed with 54 of its 95 "
          + "accounts unclassified, and an unclassified account holds the Cash Flow Statement in "
          + "review. The import now applies the same answer, and says how many it set.",
        route: "/settings/import",
      },
      {
        kind: "added",
        title: "Classify the accounts an earlier import left behind",
        detail:
          "Chart of accounts offers to fix charts imported before that change. It shows exactly "
          + "what it will set before it sets anything, never touches an account somebody has "
          + "already classified, and leaves generic current assets and liabilities alone — "
          + "whether a loan is operating or financing is a policy, not a default.",
        route: "/accounts",
      },
      {
        kind: "changed",
        title: "An imported bank account is given the kind its name states",
        detail:
          "A bank account called “Northern Savings” arrives as a savings account rather than "
          + "as “unclassified” on the bank setup screen. Only what the name plainly settles; "
          + "anything else is still left for you.",
        route: "/accounts",
      },
    ],
  },
  {
    version: "1.9",
    date: "2026-08-08",
    headline: "The import says what it needs the moment it reads your file, and lets you answer it there.",
    changes: [
      {
        kind: "added",
        title: "A pre-flight check, before you agree a single column",
        detail:
          "Choose a file and the screen immediately says what this company is missing: which "
          + "account names it cannot find, and which banks have no record under Banking. Both "
          + "used to appear as red panels under the preview, after seven columns had been "
          + "mapped — the same complaint was raised twice, once for each.",
        route: "/settings/import",
      },
      {
        kind: "added",
        title: "Point a name in the file at an account you already have",
        detail:
          "Every unresolved name gets a picker. Choose the account it means and the import reads "
          + "it that way — no editing the file, which matters when the file is a customer's "
          + "export you are not allowed to change. It is also the answer when a name belongs to "
          + "two accounts: say which, rather than deactivating one of them.",
        route: "/settings/import",
      },
      {
        kind: "added",
        title: "Create an account, or declare a bank, without leaving the screen",
        detail:
          "If the name really is an account nobody has yet, create it here — you choose the type, "
          + "because a transaction row cannot tell anyone what kind of account it is. A bank the "
          + "file uses can be added to Banking in the same place, instead of eight trips to "
          + "another screen and back.",
        route: "/settings/import",
      },
    ],
  },
  {
    version: "1.8",
    date: "2026-08-08",
    headline: "Switching an account off now settles which of two same-named accounts an import means.",
    changes: [
      {
        kind: "fixed",
        title: "Making a duplicate account inactive now unblocks the import",
        detail:
          "An import refuses a name that two accounts answer to, and told you to write the "
          + "account code in the file. That is no help when the file is a customer's export you "
          + "cannot edit — so people did the sensible thing and made the duplicate inactive in "
          + "the chart of accounts. Nothing happened: only archived accounts were being left out "
          + "of the search. One live account of that name is now taken as the answer.",
        route: "/settings/import",
      },
      {
        kind: "changed",
        title: "The refusal names both ways out",
        detail:
          "Write the code in the file, or set the account you do not use to Inactive. It used to "
          + "offer only the first, which is the one you cannot always do.",
        route: "/settings/import",
      },
    ],
  },
  {
    version: "1.7",
    date: "2026-08-08",
    headline: "A statement import can be taken back, and a stray bank line can be deleted.",
    changes: [
      {
        kind: "added",
        title: "Undo a statement import",
        detail:
          "Banking now lists the statements imported into this company, and offers Undo beside "
          + "each one. It removes every line that import brought in. There was no way back "
          + "before: a statement import posts nothing to the ledger, so there was no entry to "
          + "void and no button of any kind — importing a file into the wrong bank account "
          + "meant asking somebody to clear it out of the database.",
        route: "/banking",
      },
      {
        kind: "added",
        title: "Delete a single bank transaction",
        detail:
          "A line that should never have been there can be removed on its own, with a reason "
          + "that is kept in the audit log.",
        route: "/banking",
      },
      {
        kind: "changed",
        title: "Neither will remove a line the ledger points at",
        detail:
          "Once a bank line has been matched, an entry cites it, and deleting it would leave "
          + "that entry pointing at a transaction that no longer exists. Undo says how many "
          + "lines are matched and stays shut until they are unmatched, rather than failing "
          + "when pressed.",
        route: "/banking",
      },
    ],
  },
  {
    version: "1.6",
    date: "2026-08-07",
    headline: "A transactions import is recorded, can be undone, and does what its preview said.",
    changes: [
      {
        kind: "added",
        title: "Transactions imports are recorded, and can be undone",
        detail:
          "Every import now appears in a list under the preview — the file, how many rows, over " +
          "what dates and by whom — with an Undo beside it, the same as the general ledger has " +
          "had. Undo voids the entries it posted and removes its bank lines, which frees the " +
          "file to be imported again once it is corrected. Reversing one used to mean asking " +
          "somebody to clear it out of the database by hand.",
        route: "/settings/import",
      },
      {
        kind: "fixed",
        title: "Two identical rows in one file are both imported",
        detail:
          "A bank can charge the same fee twice on the same day, and the second row was being " +
          "dropped without a word — the preview promised 1,467 rows and 1,466 arrived. Both are " +
          "kept now, and both are still recognised if the file is loaded again.",
        route: "/settings/import",
      },
      {
        kind: "fixed",
        title: "The transactions import no longer claims it posts nothing",
        detail:
          "The box that asks you to confirm said “Lists only. Nothing is posted to the ledger.” " +
          "That was true of the other tabs and untrue of this one: every row posts an entry. It " +
          "now says so.",
        route: "/settings/import",
      },
      {
        kind: "fixed",
        title: "A green preview no longer turns into a refusal at import time",
        detail:
          "The preview screen and the import were each working out for themselves which account " +
          "a name referred to, and on a chart holding two accounts with the same name they " +
          "reached different answers — so the preview passed and the import then failed on an " +
          "account it had never looked at. There is one answer now, and the screen reads it.",
        route: "/settings/import",
      },
      {
        kind: "changed",
        title: "A name that belongs to two accounts is refused rather than picked",
        detail:
          "A chart brought over from another system can easily hold both “1000 Cash on Hand” and " +
          "“140 Cash on Hand”. Which one a row means is a question only you can answer, so the " +
          "import stops and names both, instead of choosing one — and which one it chose used to " +
          "decide whether the money landed in a bank account or a current asset.",
        route: "/settings/import",
      },
      {
        kind: "fixed",
        title: "The advice about account codes now shows a form that works",
        detail:
          "The warning suggested writing “1000 Cash on Hand”, which the chart does not recognise. " +
          "It now shows the two forms that do: the code on its own, or the code and name joined " +
          "by a spaced hyphen.",
        route: "/settings/import",
      },
    ],
  },
  {
    version: "1.5",
    date: "2026-08-07",
    headline: "The guide walks through a transactions import too, step by step.",
    changes: [
      {
        kind: "added",
        title: "A guided walk-through for importing transactions",
        detail:
          "Open Guide on the import screen and read “Bring across a list of transactions you " +
          "have already categorized”. It starts with what has to exist before you begin, and " +
          "shows a picture of each step — the same shape as the general ledger walk-through.",
        route: "/settings/import",
      },
      {
        kind: "changed",
        title: "The assistant's briefing no longer grows without limit",
        detail:
          "A screen with several workflows was starting to carry more context than it should in " +
          "front of every question. It is now budgeted, and says plainly when there is more in " +
          "the Guide than it listed.",
      },
    ],
  },
  {
    version: "1.4",
    date: "2026-08-07",
    headline: "The import screen says what is actually wrong with a file.",
    changes: [
      {
        kind: "fixed",
        title: "A row with no money is no longer called a problem",
        detail:
          "A waived fee is written as 0.00. The screen used to list every one of them in red and " +
          "tell you to map a column you had already mapped — 100 of them on one file, when " +
          "only one row was genuinely wrong. They are now counted on their own and left out " +
          "quietly.",
        route: "/settings/import",
      },
      {
        kind: "fixed",
        title: "An account name is read the same way everywhere",
        detail:
          "Wave writes “Payroll – Salary & Wages” with an en dash. The " +
          "transactions tab compared it letter for letter and refused a file the import itself " +
          "would have accepted.",
        route: "/settings/import",
      },
      {
        kind: "fixed",
        title: "The total on the transactions tab is called what it is",
        detail:
          "It reads “Net of these transactions”. It was labelled “Opening " +
          "balances in the file”, which made a perfectly ordinary net look like a balance " +
          "nobody recognised.",
        route: "/settings/import",
      },
      {
        kind: "changed",
        title: "Every tab says what has to exist before you start",
        detail:
          "The chart of accounts, the bank accounts, and whether re-importing is safe — " +
          "said before you map a column rather than discovered as a red panel afterwards.",
        route: "/settings/import",
      },
      {
        kind: "changed",
        title: "Fewer warnings over a file that is in the right place",
        detail:
          "A categorized export no longer triggers “this file may not belong in this tab” " +
          "on the tab that reads it, and the note about saved reports only appears before a file " +
          "is chosen.",
        route: "/settings/import",
      },
      {
        kind: "added",
        title: "A warning when a name means two different accounts",
        detail:
          "This chart holds two accounts called Cash on Hand and two called Cost of Goods Sold. " +
          "A file naming one of them is asking for either, so the screen says so and suggests " +
          "using the account code.",
        route: "/settings/import",
      },
      {
        kind: "changed",
        title: "An account that is not a bank is told apart from one Banking has not seen",
        detail:
          "Only one of those can be fixed under Banking. The other needs the account's type " +
          "changed, and saying which saves a trip to a screen that would never list it.",
        route: "/settings/import",
      },
    ],
  },
  {
    version: "1.3",
    date: "2026-08-07",
    headline: "Delete a payment outright, not only void it.",
    changes: [
      {
        kind: "added",
        title: "Delete a payment",
        detail:
          "In the ⋯ menu on Payments. Voiding keeps the receipt and its details; deleting " +
          "removes it. It is voided first, so the invoices it paid get their balances back and " +
          "every rule that refuses a void refuses this too — a refund taken out of it, a " +
          "matched bank line, a closed period. Administrators only, and it asks why.",
        route: "/payments",
      },
      {
        kind: "changed",
        title: "A deleted receipt still leaves a trail",
        detail:
          "Its number is written to the document number report so the sequence still adds up, " +
          "and the audit log keeps what was deleted and who deleted it.",
        route: "/reports/number-sequence",
      },
    ],
  },
  {
    version: "1.2",
    date: "2026-08-07",
    headline: "Narrow the transaction list to what you are actually reviewing.",
    changes: [
      {
        kind: "added",
        title: "Filters on the transaction list",
        detail:
          "By customer or vendor, by account, by document type, and by any words in the " +
          "description or the number. The figures across the top and the PDF and Excel exports " +
          "all follow what you have filtered to.",
        route: "/reports/transactions",
      },
      {
        kind: "changed",
        title: "Filtering by account finds split transactions too",
        detail:
          "An entry touching several accounts shows as “— Split —” in the " +
          "Account Type column. Filtering by an account still finds it, because the filter " +
          "looks at every line of the entry rather than at that label.",
        route: "/reports/transactions",
      },
    ],
  },
  {
    version: "1.1",
    date: "2026-08-07",
    headline: "Bring a company's books across from QuickBooks or Wave, and keep the reports.",
    changes: [
      {
        kind: "added",
        title: "A General ledger tab that reads a whole export in one go",
        detail:
          "An Account Transactions report from Wave holds every account already. Drop the file " +
          "in and One Book posts one journal entry per date, or only the closing balances if " +
          "that is all you want. An import can be undone from the same tab.",
        route: "/settings/import",
      },
      {
        kind: "added",
        title: "A Transactions tab for a categorized export",
        detail:
          "For a file where each row already names both the bank and the account it belongs " +
          "to. Each row becomes one entry and one matched bank line, so connecting a bank feed " +
          "later cannot count the same money twice.",
        route: "/settings/import",
      },
      {
        kind: "added",
        title: "Saved Reports: keep a report from another system",
        detail:
          "A Profit and Loss or a bank statement you only want to keep a copy of. Saved " +
          "reports are stored as they arrived and affect no balance at all.",
        route: "/reports/saved",
      },
      {
        kind: "added",
        title: "Create a company without leaving the application",
        route: "/settings/companies",
      },
      {
        kind: "added",
        title: "A category of your own on a bank transaction",
        detail: "A free-text label for sorting the list. It does not post anything.",
        route: "/banking",
      },
      {
        kind: "changed",
        title: "The guide now shows a picture of every import step",
        detail:
          "Open Guide and read \"Bring a company's books across\". It starts with what to " +
          "settle before you begin, because parts of an import cannot be undone once a period " +
          "is closed.",
      },
      {
        kind: "changed",
        title: "The Companies list no longer shows the key and the schema",
        detail: "They are how the system addresses a company, not anything to act on.",
        route: "/settings/companies",
      },
      {
        kind: "fixed",
        title: "A feedback screenshot is stored again",
        detail:
          "A report filed from any company but the first lost its screenshot without saying " +
          "so. Screenshots taken before this release could not be recovered.",
      },
      {
        kind: "fixed",
        title: "Correcting a company's name now reaches the company switcher",
        detail:
          "The name was held in two places and only one of them changed, so the books and the " +
          "top of the screen disagreed.",
        route: "/settings/company",
      },
    ],
  },
  {
    version: "1.0",
    date: "2026-08-04",
    headline: "The first release: a double-entry ledger with the documents that post to it.",
    changes: [
      {
        kind: "added",
        title: "Sales, purchases, banking, inventory, payroll taxes and the reports over them",
        detail:
          "Every figure comes from the ledger, control accounts reconcile to their subledgers, " +
          "and a period can be closed against those checks.",
      },
    ],
  },
];

export const APP_VERSION = RELEASES[0].version;

/**
 * Compare two versions by their parts.
 *
 * `"1.10" < "1.9"` is true of strings and false of releases. Getting this wrong
 * would quietly stop the panel appearing, and the day it happened nobody would
 * think to look here.
 */
export function compareVersions(a: string, b: string): number {
  const left = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const right = b.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * The releases a reader has not seen yet.
 *
 * A version we do not publish tells us nothing about what they have read, so
 * they are shown everything rather than nothing — the cost of being wrong that
 * way is a minute of reading.
 */
export function releasesSince(seen: string | null): Release[] {
  if (!seen) return RELEASES;
  if (!RELEASES.some((release) => release.version === seen)) return RELEASES;
  return RELEASES.filter((release) => compareVersions(release.version, seen) > 0);
}
