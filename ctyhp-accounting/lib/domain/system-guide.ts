/**
 * The in-app system guide: what each workflow is for, which control performs
 * each step, and where that control lives.
 *
 * Content lives here as typed data rather than prose so a test can prove every
 * route it points at exists. A guide that sends a new user to a page that was
 * renamed is worse than no guide at all.
 */

/**
 * A picture of the step, captured from the running application by
 * `scripts/capture-guide-shots.mjs`.
 *
 * Only ever captured against a sample company: a screenshot of a real screen
 * carries whatever was on it, and these books hold a customer's bank history.
 */
export interface GuideShot {
  /** Path under `public/`, so it is served without a route of its own. */
  src: string;
  /** What the picture shows, for a reader who cannot see it. */
  alt: string;
  /** One line under the image, when the picture needs pointing at. */
  caption?: string;
}

export interface GuideStep {
  /** What the user is trying to achieve. */
  action: string;
  /** The exact on-screen label of the control that does it. */
  control: string;
  /** Page the control is on. Omitted when the step happens where the flow started. */
  route?: string;
  /** What the system does behind the control, or the rule that can block it. */
  note?: string;
  screenshot?: GuideShot;
}

/**
 * Something to settle before the first step, not while recovering from it.
 *
 * Most flows need none. A flow earns one when a step is hard to reverse — an
 * import posts three years of ledger, and a period closed afterwards puts part
 * of it beyond undo.
 */
export interface GuideCaution {
  title: string;
  body: string;
}

export interface GuideFlow {
  id: string;
  title: string;
  /** Why the flow exists, in one sentence a non-accountant can follow. */
  purpose: string;
  /** Where the flow starts. */
  route: string;
  /** Read before step one. */
  cautions?: GuideCaution[];
  steps: GuideStep[];
}

/**
 * The product's version, not the guide's. A person saying "I am on 1.1" means
 * the whole application, so there is one number and the changelog owns it.
 */
export { APP_VERSION as GUIDE_VERSION } from "./changelog";

/** Shown before any workflow: what this build is and is not. */
export const GUIDE_NOTICES = [
  {
    id: "version",
    title: "This is version 1",
    body:
      "Every accounting module is in place and covered by automated tests, but this " +
      "is a first release. Expect rough edges in wording and layout rather than in " +
      "the numbers: the ledger, the reports and the period controls are verified " +
      "against the double-entry rules on every change.",
  },
  {
    id: "test-data",
    title: "The data you see is test data",
    body:
      "Customers, vendors, invoices, bills and balances in this environment were " +
      "created for testing. Nothing here is a real transaction, so explore freely — " +
      "post, void, reconcile, close a period. Do not treat any figure on screen as " +
      "an actual company balance.",
  },
  {
    id: "provenance",
    title: "Built from standard accounting practice, to be tuned to yours",
    body:
      "The workflows follow established US accounting software practice — the same " +
      "ground QuickBooks covers: a double-entry ledger as the single source of " +
      "truth, documents that post to it, control accounts that reconcile, and " +
      "periods that close. Where your way of working differs, that is a change we " +
      "make after this test round: tell us through the Report button and it becomes " +
      "a tracked item.",
  },
  {
    id: "status",
    title: "If something looks broken, One Book will tell you whether it is",
    body:
      "Open /status and it says whether One Book itself is answering: the database, " +
      "the sign-in service and the configuration, each on its own line, with a Check " +
      "again button. It works while you are signed out and while One Book is in " +
      "trouble, because those are the two moments you would go looking. If it says " +
      "One Book is working and a screen still misbehaves, the problem is not with " +
      "One Book — worth knowing before anybody telephones.",
  },
] as const;

export const GUIDE_FLOWS: GuideFlow[] = [
  {
    id: "get-paid",
    title: "Invoice a customer and get paid",
    purpose:
      "Bill a customer for work, then record the money when it arrives, so the " +
      "receivable clears itself.",
    route: "/invoices",
    steps: [
      {
        action: "Create the invoice",
        control: "New invoice",
        route: "/invoices",
        note:
          "Add a line per item or service. Totals and sales tax are calculated on " +
          "the server — a total typed by the browser is never trusted.",
      },
      {
        action: "Send it to the ledger",
        control: "Issue",
        note:
          "Issuing assigns the invoice number and posts the entry: debit Accounts " +
          "Receivable, credit income and sales tax. Until then it is a draft and " +
          "affects nothing.",
      },
      {
        action: "Give the customer a copy",
        control: "Download PDF",
        note:
          "Prints from the issued document, so what the customer receives matches " +
          "what the ledger holds. A draft prints with a DRAFT watermark.",
      },
      {
        action: "Record the money received",
        control: "New payment",
        route: "/payments",
        note:
          "Allocate it against one or more open invoices. The allocation cannot " +
          "exceed the open balance, and the customer and currency must match.",
      },
      {
        action: "Check what is still outstanding",
        control: "AR aging",
        route: "/reports/ar-aging",
        note: "This report ties to the Accounts Receivable control account by design.",
      },
    ],
  },
  {
    id: "correct-a-sale",
    title: "Correct or cancel a sale",
    purpose: "Undo or reduce something already issued, without editing history.",
    route: "/invoices",
    steps: [
      {
        action: "Cancel an invoice that should not exist",
        control: "Void",
        route: "/invoices",
        note:
          "Voiding does not delete anything. The entry is marked void and drops out " +
          "of the reports, which read posted entries only. An invoice with a payment " +
          "applied must have the payment removed first.",
      },
      {
        action: "Reduce what a customer owes",
        control: "New credit memo",
        route: "/credit-memos",
        note: "Apply it to an open invoice, or leave it as a credit for later.",
      },
      {
        action: "Give money back",
        control: "New refund",
        route: "/credit-memos",
        note: "Records the cash going out and clears the credit it came from.",
      },
      {
        action: "Write off what will never be collected",
        control: "Write off",
        route: "/invoices",
        note:
          "A write-off is a controlled action: above the configured threshold it " +
          "needs a second person's approval before it posts.",
      },
    ],
  },
  {
    id: "pay-suppliers",
    title: "Record what you owe and pay it",
    purpose: "Capture supplier bills and expenses, then settle them.",
    route: "/bills",
    steps: [
      {
        action: "Enter a supplier bill",
        control: "New bill",
        route: "/bills",
        note:
          "Duplicate vendor-and-reference combinations are detected, so the same " +
          "invoice cannot be entered twice by two people.",
      },
      {
        action: "Record a direct expense",
        control: "New expense",
        route: "/expenses",
        note:
          "For US reporting, purchase-side tax is part of the cost — there is no " +
          "separate recoverable tax line.",
      },
      {
        action: "Attach the supporting document",
        control: "Attachments",
        note:
          "The file, its checksum and the malware-scan result are recorded with the " +
          "transaction, so the evidence stays with the entry.",
      },
      {
        action: "Pay one or many bills",
        control: "Pay bills",
        route: "/pay-bills",
        note:
          "A payment can never exceed the eligible open balance, and preparing a " +
          "payment can be separated from approving it.",
      },
      {
        action: "See what is due",
        control: "AP aging",
        route: "/reports/ap-aging",
        note: "Ties to the Accounts Payable control account.",
      },
    ],
  },
  {
    id: "purchasing",
    title: "Order stock and receive it",
    purpose:
      "Commit to a purchase, receive what arrives, and let the bill match both.",
    route: "/purchase-orders",
    steps: [
      {
        action: "Raise the order",
        control: "New purchase order",
        route: "/purchase-orders",
      },
      {
        action: "Receive what arrived",
        control: "Receive",
        note:
          "Partial receipts are normal. Stock only enters inventory through a " +
          "receipt against an order, which is what keeps the inventory subledger " +
          "reconcilable.",
      },
      {
        action: "Match the supplier's bill",
        control: "Convert to bill",
        note:
          "Three-way matching compares order, receipt and bill. A quantity or price " +
          "variance outside tolerance raises an exception instead of posting quietly.",
      },
      {
        action: "Find what arrived but was never billed",
        control: "Received not billed",
        route: "/purchase-orders/received-not-billed",
      },
      {
        action: "Check inventory value",
        control: "Inventory valuation",
        route: "/reports/inventory-valuation",
        note: "Valued at weighted average cost.",
      },
    ],
  },
  {
    id: "banking",
    title: "Match the bank and reconcile",
    purpose:
      "Prove that what the ledger says about cash agrees with what the bank says.",
    route: "/banking",
    steps: [
      {
        action: "Bring in the statement",
        control: "Import statement",
        route: "/banking",
        note:
          "Each line is fingerprinted, so importing the same file twice adds " +
          "nothing and two genuinely different lines are never merged.",
      },
      {
        action: "Match lines to the ledger",
        control: "Suggest matches",
        note: "Suggestions are one-to-one and need approval before they take effect.",
      },
      {
        action: "Say which account a line belongs to, for anything the ledger does not already hold",
        control: "Category",
        note:
          "Type a word and the accounts that answer to it are offered, closest first — an " +
          "exact code, then your chart's own wording, then a word that means the same, so " +
          "\"wages\" finds an account called \"Payroll\". Each shows its type and whether it is " +
          "a debit or a credit account. Choosing " +
          "one posts the line: the bank on one side, that account on the other, and the line " +
          "becomes matched. A line already in the books shows the account its entry posted to " +
          "instead of asking again, and Change voids the entry and hands the line back.",
      },
      {
        action: "Reconcile to a statement balance",
        control: "New reconciliation",
        route: "/banking/reconcile",
        note:
          "Completing a session requires either zero unexplained difference or an " +
          "adjustment somebody signs for.",
      },
      {
        action: "Reopen a completed reconciliation",
        control: "Reopen",
        note: "Needs permission and a reason, and the reopen is audited.",
      },
    ],
  },
  {
    id: "period-close",
    title: "Close an accounting period",
    purpose: "Freeze a month so its reports stop moving.",
    route: "/settings/periods",
    steps: [
      {
        action: "Check the books balance",
        control: "Trial Balance",
        route: "/reports",
        note: "Total debits must equal total credits. They always do, or the post was rejected.",
      },
      {
        action: "Close the period",
        control: "Close period",
        route: "/settings/periods",
        note:
          "After closing, the database itself refuses to post or void into that " +
          "period — the block is not just in the interface.",
      },
      {
        action: "Fix something in a closed period",
        control: "Reopen period",
        note:
          "Reopening needs a reason and is audited. The accounting-correct route is " +
          "usually a reversal in the open period rather than a reopen.",
      },
    ],
  },
  {
    id: "sales-tax",
    title: "Handle US sales tax",
    purpose: "Collect the right tax, then report and remit it.",
    route: "/sales-tax",
    steps: [
      {
        action: "Set up agencies and rates",
        control: "New tax code",
        route: "/sales-tax",
        note: "Overlapping or invalid effective periods are rejected.",
      },
      {
        action: "See what is owed",
        control: "Sales tax liability",
        route: "/sales-tax",
        note: "Reconciles to the sales-tax control accounts.",
      },
      {
        action: "Record a remittance",
        control: "Record payment",
        note:
          "A filed period is locked; a later correction becomes a linked adjustment " +
          "rather than an edit.",
      },
    ],
  },
  {
    id: "year-end",
    title: "Prepare vendor 1099 information",
    purpose: "Gather what a 1099 filing needs, for review by a tax professional.",
    route: "/reports/1099",
    steps: [
      {
        action: "Record vendor tax details",
        control: "Tax profile",
        route: "/vendors",
        note:
          "Taxpayer identification numbers are masked on screen and never written " +
          "into audit payloads or reports.",
      },
      {
        action: "Produce the review worksheet",
        control: "1099 review",
        route: "/reports/1099",
        note:
          "This is a review worksheet on a cash basis, not a filing. It must be " +
          "checked by someone qualified before anything is submitted.",
      },
    ],
  },
  {
    id: "governance",
    title: "Control who can do what",
    purpose: "Give people the access their job needs, and no more.",
    route: "/settings/users",
    steps: [
      { action: "Add or suspend a person", control: "New user", route: "/settings/users" },
      {
        action: "Set what each role may do",
        control: "Permissions",
        route: "/settings/permissions",
      },
      {
        action: "Require a second pair of eyes",
        control: "Approvals",
        route: "/settings/approvals",
        note:
          "Configure which actions need approval and above what amount. A person " +
          "cannot approve their own request.",
      },
      {
        action: "See who changed what",
        control: "Audit history",
        route: "/settings/audit",
        note: "Every protected write records the actor, the action and the before and after values.",
      },
    ],
  },
  {
    id: "restore-a-backup",
    title: "Find a backup, and open it as a second company to compare against",
    purpose:
      "Your books are copied on a schedule. When a figure looks wrong, open the copy from before "
      + "it went wrong as a separate company, and read the two side by side.",
    route: "/settings/backups",
    cautions: [
      {
        title: "A snapshot does not include your attachments",
        body:
          "It holds every table in the books — accounts, entries, invoices, bills, customers, "
          + "vendors, vendor tax profiles. It does not hold the files: document scans, bill "
          + "attachments and feedback images live in storage and are not copied. The snapshot "
          + "lists them, so you can tell what was attached, but restoring will not bring the "
          + "files themselves back.",
      },
      {
        title: "The restored copy holds taxpayer identification numbers",
        body:
          "Vendor tax profiles come across with everything else. The copy is a company like any "
          + "other, so anybody you later give access to it can see them. Restore when you need "
          + "to, and delete the copy once the comparison is done.",
      },
      {
        title: "The people are not copied, only the books",
        body:
          "You are the restored company's only user. Nobody else gains access to a set of books "
          + "just because a copy of them was made.",
      },
    ],
    steps: [
      {
        action: "Find the day you want to go back to",
        control: "Backups",
        route: "/settings/backups",
        note:
          "One row per snapshot, newest first. A row saying Skipped means the books had not "
          + "changed since the previous snapshot, so that day's figures are the ones in the row "
          + "above it. Only a Stored row can be downloaded or restored.",
      },
      {
        action: "Take a copy of the file for yourself",
        control: "Download",
        note:
          "A single ZIP holding one CSV per table, plus a manifest listing the row counts and "
          + "the totals recorded when it was taken — the same file Company settings' Export "
          + "button produces. The link is good for five minutes.",
      },
      {
        action: "Open that day's books as a separate company",
        control: "Restore as new company",
        note:
          "Opens a page to name the new company. Confirm with Restore into a new company: it "
          + "creates the company and loads the snapshot into it. The company you are working in "
          + "is not touched, and cannot be — no part of this writes back to it.",
      },
      {
        action: "Check the copy came back whole",
        control: "Control totals",
        note:
          "After loading, the trial balance, the receivable and payable totals and the journal "
          + "line count are recalculated from the restored books and compared with the ones "
          + "recorded in the snapshot. A match is the evidence the copy is faithful. A mismatch "
          + "names the figure and both values rather than failing quietly.",
      },
      {
        action: "Read the two side by side",
        control: "The company switcher",
        note:
          "Switch between the restored copy and the running books and open the same report on "
          + "each. Comparing a balance sheet on both is the fastest way to see which account "
          + "moved and by how much.",
      },
    ],
  },
  {
    id: "import-transactions",
    title: "Bring across a list of transactions you have already categorized",
    purpose:
      "Load an export where every row already says which bank the money moved through and which "
      + "account it belongs to, so each row can be posted as it stands.",
    route: "/settings/import",
    cautions: [
      {
        title: "This is not the same file as a general ledger",
        body:
          "A general ledger has one row per side of a transaction, grouped under each account. " +
          "This tab wants the other shape: one row per transaction, naming both the bank and the " +
          "chart-of-account. If the file is grouped into sections per account, use the General " +
          "ledger tab instead.",
      },
      {
        title: "Every account the file names must already be in the chart of accounts",
        body:
          "A transaction row never creates an account — the same name means different things in " +
          "two charts, and a typo would become a permanent account. The screen lists every name " +
          "it cannot find and keeps the button shut until each one is answered. Answering it " +
          "does not mean editing the file: point the name at an account you already have, or " +
          "create it there with the type you choose.",
      },
      {
        title: "A name two accounts answer to is refused, and the account code is the way out",
        body:
          "An imported chart can easily hold both \"1000 Cash on Hand\" and \"140 Cash on Hand\". " +
          "A row naming only \"Cash on Hand\" is then a question, not a reference — one of those " +
          "is a bank and the other is not — so nothing is imported under it. Two ways to answer " +
          "it. Put the code in the file: either \"1000\" on its own, or \"1000 - Cash on Hand\" " +
          "with the spaced hyphen; \"1000 Cash on Hand\" without the hyphen is not a form the " +
          "chart recognises. Or, when the file is somebody else's export and cannot be edited, " +
          "set the account you do not use to Inactive under Chart of accounts — one live account " +
          "of that name is no longer a question.",
      },
      {
        title: "The bank accounts have to exist under Banking, not only in the chart",
        body:
          "Each row also writes a bank line, and that line is what stops a second import of the " +
          "same file posting the same money twice. An account that is not of a bank or credit " +
          "card type cannot be added there at all — point those rows at the account the money " +
          "really moved through.",
      },
      {
        title: "Every import is recorded, and can be undone",
        body:
          "The list under the preview shows what has been imported: the file, how many rows, over " +
          "what dates, by whom. Undo voids the entries it posted and removes its bank lines, " +
          "which is what frees the file to be imported again once it is corrected. Loading the " +
          "very same file while its import is still live is refused rather than skipped in " +
          "silence — rows from a *different* file that overlap are still recognised and skipped.",
      },
      {
        title: "Rows carrying no money are left out, and that is not a fault",
        body:
          "A waived fee is often written as 0.00. There is nothing to post for those rows. They " +
          "are counted on their own, apart from rows that really do have a problem.",
      },
    ],
    steps: [
      {
        action: "Open the company these transactions belong to, and read what is needed first",
        control: "Transactions",
        route: "/settings/import",
        note:
          "Everything posts into whichever company is open in the switcher. The panel at the top " +
          "of the tab names what has to exist before the file will go in — and once a file is " +
          "chosen, a second panel checks it against this company straight away: which account " +
          "names cannot be found, and which banks have no record. Both can be answered there, " +
          "by pointing a name at an account you already have or by creating what is missing.",
        screenshot: {
          src: "/guide/txn-01-before.png",
          alt: "The Before you start panel on the transactions tab, listing the chart of accounts and Banking as prerequisites",
          caption: "Read this before choosing a file, not after mapping every column.",
        },
      },
      {
        action: "Read what this company is missing, before mapping anything",
        control: "What this file needs",
        note:
          "Choosing the file is enough for this: the screen checks every account name and every " +
          "bank in it against this company straight away. A name the chart does not have can be " +
          "pointed at an account that does exist — which is what a file somebody else exported " +
          "usually needs, since you cannot edit it — or created here, with the type chosen by " +
          "you. A bank with no record can be declared without leaving the screen.",
        screenshot: {
          src: "/guide/txn-02-preflight.png",
          alt: "The panel listing account names the chart cannot find, each with a picker to choose the account it means",
          caption: "Answered here, rather than on two other screens after mapping seven columns.",
        },
      },
      {
        action: "Choose the file, and check the columns One Book proposed",
        control: "Choose a CSV file",
        note:
          "The columns are matched from the file's own headings and can all be changed. Date and " +
          "Chart of account are required. Money is either a signed Amount — positive is money " +
          "into the bank — or a Debit and Credit pair; map one or the other.",
        screenshot: {
          src: "/guide/txn-03-columns.png",
          alt: "The column mapping table with Date, Description, Bank account, Chart of account and Amount matched to the file's headings",
          caption: "Leave Bank account unmapped to post every row to one account chosen above.",
        },
      },
      {
        action: "See what will happen before anything happens",
        control: "See what will happen",
        note:
          "How many rows will be created, how many have a genuine problem, how many carry no " +
          "money, and the net of the transactions — which is a net, not an opening balance.",
        screenshot: {
          src: "/guide/txn-04-preview.png",
          alt: "The figures above the preview: rows to create, rows with problems, rows carrying no money, and the net",
          caption: "Check the net against the report you exported before importing.",
        },
      },
      {
        action: "Read anything the screen refuses to import",
        control: "The panels below the preview",
        note:
          "An account the chart does not have, a bank account Banking has not seen, and a name " +
          "that belongs to two accounts at once each say exactly what to do. None is worth " +
          "working around: the import posts real money.",
        screenshot: {
          src: "/guide/txn-05-empty.png",
          alt: "The note explaining that rows carrying no money are left out and need no fixing",
          caption: "A row worth 0.00 is left out quietly. Only real problems are red.",
        },
      },
      {
        action: "Import, then check the bank",
        control: "Import",
        route: "/banking",
        note:
          "Each row posts one journal entry and one bank line already marked matched, so " +
          "connecting a bank feed for the same account later cannot count the same money twice.",
        screenshot: {
          src: "/guide/txn-04-preview.png",
          alt: "The same figures, which are what the import will have posted once it finishes",
          caption: "What the preview counted is what the import posts.",
        },
      },
      {
        action: "Check it landed, and keep the way back",
        control: "Undo",
        route: "/settings/import",
        note:
          "The import now appears in the list under the preview, with its file name, row count " +
          "and dates. Undo is how a mistaken import is put right: it voids the entries and " +
          "removes the bank lines, leaving the corrected file free to be imported in their place.",
        screenshot: {
          src: "/guide/txn-06-record.png",
          alt: "The register of imports, showing the file, its dates and row count, with an Undo button",
          caption: "Undo voids the entries and removes the bank lines it posted.",
        },
      },
    ],
  },
  {
    id: "import-a-ledger",
    title: "Bring a company's books across from QuickBooks or Wave",
    purpose:
      "Load a general ledger exported from another product so its accounts, its " +
      "history and its balances live in One Book.",
    route: "/settings/import",
    cautions: [
      {
        title: "Check which company you are in first",
        body:
          "An import posts into the company open in the switcher at the top of the " +
          "screen, and it says which one on the button before you press it. There is " +
          "no way to move an import from one company to another afterwards.",
      },
      {
        title: "The chart of accounts must already hold every account the file names",
        body:
          "A ledger row never creates an account: the same name means different " +
          "things in two charts, and a typo would become a permanent account. The " +
          "screen lists every name it cannot find and keeps the button shut until " +
          "each one is answered — and it is answered there, not on another screen: " +
          "point the name at an account you already have, or create it with the type " +
          "you choose. A name two live accounts answer to counts as one it cannot " +
          "find, and the same picker settles that.",
      },
      {
        title: "Undo works only while the period is still open",
        body:
          "An import can be undone from the list at the bottom of the tab, which " +
          "voids every entry it created. An entry dated in a closed period cannot be " +
          "voided at all — the refusal says so in those words — so a mistake there has " +
          "to be corrected with a reversing entry instead. Do not close a period until " +
          "you have checked the import against the report you exported.",
      },
      {
        title: "The same file cannot be imported twice",
        body:
          "One Book remembers the file, not the file name, so a second attempt is " +
          "refused even if you rename it or pick the other mode. That is deliberate: " +
          "a doubled ledger balances perfectly and looks entirely correct.",
      },
      {
        title: "Try it on a sample company before the real books",
        body:
          "A sample company can be thrown away. Load the file there first, read the " +
          "Trial Balance, and only then do it for real.",
      },
    ],
    steps: [
      {
        action: "Open the company these books belong to",
        control: "The company switcher",
        route: "/settings/import",
        note:
          "Everything below posts into whichever company is open here. The import " +
          "button repeats the name so it cannot be missed.",
        screenshot: {
          src: "/guide/import-01-tab.png",
          alt: "The import screen with the General ledger tab selected among the other import tabs",
          caption: "The tab strip. A general ledger has its own tab because it needs no column mapping.",
        },
      },
      {
        action: "Choose the General ledger tab",
        control: "General ledger",
        note:
          "The other tabs read one row per record and ask you to match columns. A " +
          "general ledger is different: every row is one side of a double entry, and " +
          "what it means comes from the account section it sits under, so there is " +
          "nothing to match.",
        screenshot: {
          src: "/guide/import-02-empty.png",
          alt: "The General ledger tab before a file is chosen, showing the drop area",
          caption: "Drop the export here. Nothing is sent until you press Import.",
        },
      },
      {
        action: "Drop the exported file in",
        control: "Drop the Account Transactions export here",
        note:
          "The file is read in your browser. The screen then shows how many accounts, " +
          "dates and lines it found, and the total debits — check those against the " +
          "totals printed at the bottom of the export before going on.",
        screenshot: {
          src: "/guide/import-03-preview.png",
          alt: "The preview showing account count, entry count, line count, total debits and the per-account table",
          caption: "Every account in the file, with its own debits and credits.",
        },
      },
      {
        action: "Read anything the screen refuses to import",
        control: "The red panels",
        note:
          "Three things stop an import before it starts: an account the chart does " +
          "not have, a date whose debits and credits differ, and a disagreement " +
          "between One Book's totals and the file's own. Each names exactly what is " +
          "wrong. None of them is worth working around.",
        screenshot: {
          src: "/guide/import-04-blocked.png",
          alt: "A table of the names in the file the chart cannot find, each with a picker to choose the account it means",
          caption: "Point each name at an account you already have, or create it here.",
        },
      },
      {
        action: "Choose how much to bring across",
        control: "The whole history / Closing balances only",
        note:
          "The whole history posts one journal entry per date, so every transaction " +
          "stays searchable in the General Ledger report. Closing balances only posts " +
          "a single entry with each account's net, dated as of the day you choose — " +
          "smaller and safer, but the detail is gone. Either way the original file is " +
          "kept under Reports.",
        screenshot: {
          src: "/guide/import-05-mode.png",
          alt: "The two import modes with the whole history selected and the import button beneath",
          caption: "The button counts what it is about to post.",
        },
      },
      {
        action: "Import, then check the result",
        control: "Import",
        note:
          "Everything posts in one go: if any part of it fails, none of it lands. " +
          "Afterwards, read the Trial Balance and compare it with the report you " +
          "exported. The file itself is saved under Reports → Saved Reports.",
        screenshot: {
          src: "/guide/import-06-batches.png",
          alt: "The list of ledgers imported before, each row offering an Undo button",
          caption: "Every import is listed here, and Undo voids the entries it created.",
        },
      },
      {
        action: "Check the numbers against the source",
        control: "Trial Balance",
        route: "/reports",
        note:
          "The one check worth doing every time: the trial balance in One Book should " +
          "match the closing balances on the report you exported. If it does not, undo " +
          "the import while the period is still open.",
        screenshot: {
          src: "/guide/import-07-saved.png",
          alt: "The Saved Reports screen listing the imported file, kept as it arrived",
          caption: "The original export, kept so the ledger can be checked against its source.",
        },
      },
    ],
  },
  {
    id: "feedback",
    title: "Tell us what is wrong or missing",
    purpose:
      "During this test round, this is the channel that turns what you notice into a " +
      "tracked item.",
    route: "/settings/feedback",
    steps: [
      {
        action: "Report a problem or suggest an improvement",
        control: "Report",
        note:
          "The floating Report button works on every page. It captures a screenshot " +
          "of what you are looking at — you can send the report without it.",
      },
      {
        action: "Ask how something is meant to work",
        control: "Ask AI",
        note:
          "Answers come from this system's own guides. The assistant cannot see your " +
          "data, so it will not quote balances.",
      },
      {
        action: "Follow what happens to a report",
        control: "Feedback triage",
        route: "/settings/feedback",
        note: "Reports move through New, Reviewing, Resolved and Declined.",
      },
    ],
  },
];

/** Every route the guide links to, for the test that proves they all exist. */
export function guideRoutes(): string[] {
  const routes = new Set<string>();
  for (const flow of GUIDE_FLOWS) {
    routes.add(flow.route);
    for (const step of flow.steps) if (step.route) routes.add(step.route);
  }
  return [...routes].sort();
}
