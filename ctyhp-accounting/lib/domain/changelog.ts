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
