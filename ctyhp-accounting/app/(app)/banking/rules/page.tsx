import { createSupabaseServerClient } from "@/lib/db/server";
import { canWrite, getUserRole } from "@/lib/auth";
import { fundingAccountAllowed, suggestFundingAccount } from "@/lib/domain/bank-pairs";
import { codableAccount, codingAccountOf } from "@/lib/domain/coding";
import { relatedAccountAllowed, usableRelated } from "@/lib/domain/related-companies";
import { interestAccountAllowed, repaysAccountAllowed, usableRepayment } from "@/lib/domain/repayments";
import { suggestInterestAccount } from "@/lib/domain/loan-interest";
import { listAccounts } from "@/lib/services/accounts";
import { listBankTransactions } from "@/lib/services/banking";
import { getBankingPreference } from "@/lib/services/banking-preference";
import { listBankRules, ruleWaitingCounts } from "@/lib/services/coding";
import { relatedBalances, relatedWaitingCounts } from "@/lib/services/related-companies";
import { listRelatedCompanies, listRepayments } from "@/lib/services/repayment-register";
import { repaymentStats } from "@/lib/services/repayments";
import PageHeader from "@/components/PageHeader";
import PairsPreference from "./PairsPreference";
import RelatedCompaniesSection, { type RelatedListRow } from "./RelatedCompaniesSection";
import RepaymentsSection, { type RepaymentListRow } from "./RepaymentsSection";
import RulesClient, { type RuleListRow } from "./RulesClient";

export const dynamic = "force-dynamic";

export default async function BankRulesPage() {
  const sb = await createSupabaseServerClient();
  const [role, rules, accounts, preference, repayments, related, lines] = await Promise.all([
    getUserRole(),
    listBankRules(sb),
    listAccounts(sb),
    getBankingPreference(sb),
    listRepayments(sb),
    listRelatedCompanies(sb),
    listBankTransactions(sb, null),
  ]);
  const liabilities = accounts
    .filter(fundingAccountAllowed)
    .map((account) => ({ id: account.id, label: `${account.account_code} — ${account.name}` }));
  const [waiting, stats, relatedWaiting, balances] = await Promise.all([
    ruleWaitingCounts(sb, rules, lines),
    repaymentStats(sb, repayments, lines),
    relatedWaitingCounts(sb, related, lines),
    relatedBalances(sb, related.map((company) => company.accountId)),
  ]);
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const chart = new Map(accounts.map((account) => [account.id, codingAccountOf(account)]));
  const labelOf = (id: string) => {
    const account = byId.get(id);
    return account ? `${account.account_code} — ${account.name}` : "Account not found";
  };
  // An account is a card's, a loan's or a related company's — never two of them.
  const repaymentAccountIds = new Set(repayments.map((entry) => entry.accountId));
  const relatedAccountIds = new Set(related.map((company) => company.accountId));
  const rows: RuleListRow[] = rules.map((rule) => {
    const account = byId.get(rule.accountId);
    return {
      ...rule,
      accountLabel: labelOf(rule.accountId),
      accountUsable: codableAccount(account ? codingAccountOf(account) : undefined),
      waiting: waiting[rule.id] ?? 0,
    };
  });
  const repaymentRows: RepaymentListRow[] = repayments.map((entry) => ({
    ...entry,
    accountLabel: labelOf(entry.accountId),
    interestLabel: entry.interestAccountId ? labelOf(entry.interestAccountId) : null,
    accountUsable: usableRepayment({ ...entry, isActive: true }, chart),
    stats: stats[entry.id] ?? { past: 0, caught: 0, waiting: 0, missed: [] },
  }));
  const relatedRows: RelatedListRow[] = related.map((company) => ({
    ...company,
    accountLabel: labelOf(company.accountId),
    accountUsable: usableRelated({ ...company, isActive: true }, chart),
    waiting: relatedWaiting[company.id] ?? 0,
    balanceMinor: balances[company.accountId] ?? 0,
  }));
  return (
    <div>
      <PageHeader
        title="Bank Rules"
        description="What says which account a bank line belongs to. A card, loan or related company registered here is recognized first; then the first rule that matches; history speaks only when none does. Nothing is posted until someone uses a suggestion."
      />
      <PairsPreference
        initial={preference}
        suggestedFundingId={suggestFundingAccount(accounts)}
        accounts={liabilities}
        canWrite={canWrite(role)}
      />
      <RepaymentsSection
        rows={repaymentRows}
        cardAccounts={accounts.filter((account) => repaysAccountAllowed("card", codingAccountOf(account)))}
        loanAccounts={accounts.filter(
          (account) => repaysAccountAllowed("loan", codingAccountOf(account)) && !relatedAccountIds.has(account.id),
        )}
        interestAccounts={accounts.filter((account) => interestAccountAllowed(codingAccountOf(account)))}
        suggestedInterestId={suggestInterestAccount([...chart.values()])}
        canWrite={canWrite(role)}
      />
      <RelatedCompaniesSection
        rows={relatedRows}
        accounts={accounts.filter(
          (account) => relatedAccountAllowed(codingAccountOf(account)) && !repaymentAccountIds.has(account.id),
        )}
        canWrite={canWrite(role)}
      />
      <RulesClient
        rules={rows}
        accounts={accounts.filter((account) => codableAccount(codingAccountOf(account)))}
        canWrite={canWrite(role)}
      />
    </div>
  );
}
