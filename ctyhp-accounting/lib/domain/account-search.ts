import type { AccountType } from "./accounts";

/**
 * Finding the account somebody means from the word they typed.
 *
 * A plain substring match over "code — name" only finds the word the chart
 * happens to use. Somebody typing "wages" wants the payroll account whether it
 * is called "Salaries", "Payroll Expense" or "Staff Costs" — and they will not
 * try three spellings, they will decide the search is broken.
 *
 * So each group below is a set of words that mean the same thing when you are
 * naming an account. Typing any of them finds an account named with any other.
 * They are deliberately about *bookkeeping words*, not about a particular chart:
 * a chart is imported from somewhere else and cannot be relied on to use ours.
 *
 * Kept in code rather than in a table because nobody would fill the table in.
 * The bank-line labels feature proved that: it asked people to invent their own
 * words first, and every company had zero of them.
 */
const SYNONYMS: readonly (readonly string[])[] = [
  ["payroll", "salary", "salaries", "wage", "wages", "staff", "employee", "compensation"],
  ["fee", "fees", "charge", "charges", "commission", "surcharge"],
  ["sale", "sales", "revenue", "income", "turnover", "takings"],
  ["bank", "banking", "cash", "checking", "current account"],
  ["tax", "taxes", "vat", "gst", "duty"],
  ["rent", "rental", "lease", "premises"],
  ["utility", "utilities", "electricity", "power", "water", "gas", "internet", "phone"],
  ["insurance", "cover", "premium"],
  ["freight", "shipping", "postage", "courier", "delivery", "carriage"],
  ["advertising", "marketing", "promotion", "publicity"],
  ["interest", "finance charge", "loan interest"],
  ["supplies", "stationery", "consumables", "materials"],
  ["repair", "repairs", "maintenance", "servicing"],
  ["travel", "mileage", "fuel", "airfare", "accommodation"],
  ["legal", "professional", "accountancy", "consulting", "advisory"],
  ["inventory", "stock", "goods", "merchandise"],
  ["receivable", "debtor", "debtors", "customer"],
  ["payable", "creditor", "creditors", "supplier", "vendor"],
  ["depreciation", "amortisation", "amortization", "write down"],
  ["refund", "credit note", "return", "returns"],
];

/** Words that mean the same as this one, itself included. Empty when none do. */
function synonymsFor(word: string): string[] {
  const found = SYNONYMS.filter((group) => group.some((entry) => entry === word));
  return [...new Set(found.flat())];
}

export interface SearchableAccount {
  id: string;
  account_code: string;
  name: string;
  account_type: AccountType;
}

export interface AccountSearchHit<T extends SearchableAccount> {
  account: T;
  /** Higher is a better answer. Only used to order what is shown. */
  score: number;
  /** The word that found it, when it was not the one typed. */
  via: string | null;
  /** Which part of the account answered, which decides how ties are broken. */
  by: "code" | "name";
}

const normalise = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Rank the chart against what somebody typed.
 *
 * The order matters more than the filter does: a chart of ninety-five accounts
 * answering to "sales" is not a shortlist, and the one they meant has to be at
 * the top rather than somewhere in it. An exact code beats everything — it is
 * the one thing that can only mean one account.
 */
export function searchAccounts<T extends SearchableAccount>(
  accounts: readonly T[],
  query: string,
): AccountSearchHit<T>[] {
  const wanted = normalise(query);
  if (wanted === "") {
    return accounts.map((account) => ({ account, score: 0, via: null, by: "name" as const }));
  }

  const related = synonymsFor(wanted).filter((word) => word !== wanted);
  const hits: AccountSearchHit<T>[] = [];

  for (const account of accounts) {
    const code = normalise(account.account_code);
    const name = normalise(account.name);

    let score = 0;
    let via: string | null = null;
    let by: "code" | "name" = "name";

    if (code === wanted) {
      score = 100;
      by = "code";
    } else if (code.startsWith(wanted)) {
      score = 80;
      by = "code";
    } else if (name === wanted) score = 90;
    else if (name.startsWith(wanted)) score = 70;
    else if (name.includes(wanted)) score = 60;
    else {
      // Only now the other words for the same thing, so a chart that uses the
      // reader's own word always wins over one that needs translating.
      const match = related.find((word) => name.includes(word));
      if (match) {
        score = 40;
        via = match;
      }
    }

    if (score > 0) hits.push({ account, score, via, by });
  }

  // On a tie between two names, the shorter one is the closer answer: "Sales
  // Revenue" and "Sales Tax Payable" both begin with "sales", and somebody
  // typing it means the one with less else in the name. Codes are left in code
  // order — typing "60" is asking for a range, and shuffling it by name length
  // would answer a question nobody asked. Then the code, so nothing wobbles.
  return hits.sort(
    (a, b) =>
      b.score - a.score ||
      (a.by === "code" ? 0 : a.account.name.length - b.account.name.length) ||
      a.account.account_code.localeCompare(b.account.account_code),
  );
}
