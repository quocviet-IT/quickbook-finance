/**
 * Setting up a company: what a new set of books still needs before it is ready
 * to work in, read from the books themselves (3.00).
 *
 * Creating a company builds its tables, its chart of accounts and a settings
 * row holding only the name it was created under. Everything else (the
 * address documents print, the time zone every date is read in, where the
 * books start, the bank accounts, the people) is left to whoever opens it
 * first, and nothing said so. Two of the companies in use had never saved
 * their settings at all.
 *
 * Pure: the facts are read by lib/services/company-setup, and every word the
 * checklist says is decided here, where it is tested.
 */
import { formatDate, plural, timeZoneLabel } from "@/lib/format";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/** What the books hold that says how far they have been set up. */
export interface CompanySetupFacts {
  /** The newest settings version, or null when the company has never had one. */
  settings: {
    /** Whether any version was saved by a person, rather than written when the company was created. */
    savedByPerson: boolean;
    hasAddress: boolean;
    /** A phone or an email, either of which a document prints. */
    hasContact: boolean;
    timeZone: string;
    fiscalYearStartMonth: number;
  } | null;
  /** The earliest posted entry made on the Opening Balances screen, or null. */
  openingBalanceDate: string | null;
  /** The earliest posted entry of any kind, or null when nothing is posted. */
  firstEntryDate: string | null;
  postedEntries: number;
  bankAccounts: number;
  /** Everyone with an account in these books, the person reading included. */
  people: number;
}

/** The size of a company's books, as the Companies list shows it. */
export interface CompanySummary {
  postedEntries: number;
  /** Issued: neither a draft nor void. */
  invoices: number;
  bills: number;
  activeAccounts: number;
}

/**
 * Done, or still to do. "Check" is for what the books cannot settle on their
 * own: entries that start the books without an opening balance may be right
 * (a business that began with nothing) or may be missing one.
 */
export type SetupStepState = "done" | "todo" | "check";

export type SetupStepKey = "details" | "opening" | "bank" | "people";

export interface SetupStep {
  key: SetupStepKey;
  title: string;
  state: SetupStepState;
  detail: string;
  href: string;
  action: string;
}

export interface SetupProgress {
  done: number;
  check: number;
  total: number;
  complete: boolean;
}

function monthName(month: number): string {
  return MONTHS[Math.min(12, Math.max(1, month)) - 1];
}

/** What a saved company lacks for its documents, for the sentence that says so. */
function missingContact(settings: NonNullable<CompanySetupFacts["settings"]>): string | null {
  if (!settings.hasAddress && !settings.hasContact) return "an address, phone or email";
  if (!settings.hasAddress) return "an address";
  if (!settings.hasContact) return "a phone or an email";
  return null;
}

function detailsStep(facts: CompanySetupFacts): SetupStep {
  const base = { key: "details" as const, title: "Company details", href: "/settings/company", action: "Edit" };
  const settings = facts.settings;
  if (!settings) {
    return {
      ...base,
      state: "todo",
      detail:
        "Never saved. Invoices, estimates and sales receipts print no address, phone or email, and every screen reads dates in Eastern Time with a fiscal year starting in January, defaults nobody chose.",
    };
  }
  if (!settings.savedByPerson) {
    return {
      ...base,
      state: "todo",
      detail: `Holds only the name the company was created under. Add the address, phone and email the documents print, and check the time zone (${timeZoneLabel(settings.timeZone)}) and the fiscal year (starts in ${monthName(settings.fiscalYearStartMonth)}).`,
    };
  }
  const missing = missingContact(settings);
  if (missing) {
    return {
      ...base,
      state: "todo",
      detail: `Saved without ${missing}. Invoices, estimates and sales receipts print what is saved here.`,
    };
  }
  return {
    ...base,
    state: "done",
    detail: `Saved. Dates are read in ${timeZoneLabel(settings.timeZone)}, and the fiscal year starts in ${monthName(settings.fiscalYearStartMonth)}.`,
  };
}

function openingStep(facts: CompanySetupFacts): SetupStep {
  const base = { key: "opening" as const, title: "Opening balances", href: "/opening-balances", action: "Open Opening Balances" };
  if (facts.openingBalanceDate) {
    return { ...base, state: "done", detail: `Posted as of ${formatDate(facts.openingBalanceDate)}.` };
  }
  if (facts.postedEntries === 0 || !facts.firstEntryDate) {
    return {
      ...base,
      state: "todo",
      detail:
        "Nothing is posted yet. Enter what each account held on the day these books start in OneBook. A business that starts with nothing can skip this.",
    };
  }
  return {
    ...base,
    state: "check",
    detail: `The books start on ${formatDate(facts.firstEntryDate)}, with ${plural(facts.postedEntries, "posted entry", "posted entries")}, none of them from Opening Balances. If the accounts held money before that day, enter it there.`,
  };
}

function bankStep(facts: CompanySetupFacts): SetupStep {
  const base = { key: "bank" as const, title: "Bank and card accounts", href: "/banking", action: "Open Banking" };
  if (facts.bankAccounts > 0) {
    return { ...base, state: "done", detail: `${plural(facts.bankAccounts, "account")} set up in Banking.` };
  }
  return {
    ...base,
    state: "todo",
    detail: "None yet. Add the bank accounts and cards the business uses, so their statements can be brought in and reconciled.",
  };
}

function peopleStep(facts: CompanySetupFacts): SetupStep {
  const base = { key: "people" as const, title: "People", href: "/settings/users", action: "Open Users" };
  if (facts.people > 1) {
    return { ...base, state: "done", detail: `${plural(facts.people, "person", "people")} have an account in these books.` };
  }
  return {
    ...base,
    state: "todo",
    detail: "Only one person has an account in these books. Add the people who will work in them.",
  };
}

/** The four steps, in the order they are best done. */
export function companySetupSteps(facts: CompanySetupFacts): SetupStep[] {
  return [detailsStep(facts), openingStep(facts), bankStep(facts), peopleStep(facts)];
}

export function setupProgress(steps: SetupStep[]): SetupProgress {
  const done = steps.filter((step) => step.state === "done").length;
  const check = steps.filter((step) => step.state === "check").length;
  return { done, check, total: steps.length, complete: done === steps.length };
}

/** "3 of 4 done", with what is left to check when there is any. */
export function setupProgressLabel(progress: SetupProgress): string {
  const head = `${progress.done} of ${progress.total} done`;
  return progress.check > 0 ? `${head}, ${progress.check} to check` : head;
}
