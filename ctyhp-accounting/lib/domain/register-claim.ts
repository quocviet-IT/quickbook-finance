/**
 * What the person registered about a waiting line's other side: a card or a
 * loan it repays (repayments.ts), or a related company it names
 * (related-companies.ts). Both are weighed together, before any rule or
 * history, and the rule is the same for both — one claimant or nothing. A line
 * two claim gets no proposal at all, and says which, the way two open invoices
 * of one amount get none.
 *
 * Imported by scripts/*.mjs: relative imports only.
 */
import type { CodingAccount } from "./coding.ts";
import { relatedHits, type RelatedCompany } from "./related-companies.ts";
import { repaymentHits, type RepaymentAccount, type RepaymentLine } from "./repayments.ts";

export type RegisterClaim =
  | { kind: "repayment"; entry: RepaymentAccount }
  | { kind: "related"; company: RelatedCompany }
  | { kind: "rivals"; labels: string[] };

/** The one card, loan or related company that claims a waiting line; every claimant's label when several do; or nothing. */
export function registerClaim(input: {
  repayments: readonly RepaymentAccount[];
  related: readonly RelatedCompany[];
  line: RepaymentLine;
  accounts: ReadonlyMap<string, CodingAccount>;
}): RegisterClaim | null {
  const { line, accounts } = input;
  const repayments = repaymentHits(input.repayments, line, accounts);
  const related = relatedHits(input.related, line, accounts);
  const count = repayments.length + related.length;
  if (count === 0) return null;
  if (count === 1) {
    return repayments.length ? { kind: "repayment", entry: repayments[0] } : { kind: "related", company: related[0] };
  }
  const accountLabel = (id: string) => {
    const account = accounts.get(id);
    return account ? `${account.code} ${account.name}` : "an account not found";
  };
  return {
    kind: "rivals",
    labels: [...related.map((company) => company.name), ...repayments.map((entry) => accountLabel(entry.accountId))],
  };
}

/** "Matches Example Affiliate and 2050 Example Card — code it yourself"; past two, "and N more". */
export function rivalsWhy(labels: readonly string[]): string {
  const named = labels.length <= 2 ? labels.join(" and ") : `${labels[0]}, ${labels[1]} and ${labels.length - 2} more`;
  return `Matches ${named} — code it yourself`;
}
