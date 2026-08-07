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
