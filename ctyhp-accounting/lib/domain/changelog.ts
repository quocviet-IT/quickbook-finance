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
