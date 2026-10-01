import { createSupabaseServerClient } from "@/lib/db/server";
import { canWrite, getUserRole } from "@/lib/auth";
import { fundingAccountAllowed, suggestFundingAccount } from "@/lib/domain/bank-pairs";
import { codableAccount, codingAccountOf } from "@/lib/domain/coding";
import { repaysAccountAllowed, usableRepayment } from "@/lib/domain/repayments";
import { listAccounts } from "@/lib/services/accounts";
import { getBankingPreference } from "@/lib/services/banking-preference";
import { listBankRules, ruleWaitingCounts } from "@/lib/services/coding";
import { listRepayments } from "@/lib/services/repayment-register";
import { repaymentStats } from "@/lib/services/repayments";
import PageHeader from "@/components/PageHeader";
import PairsPreference from "./PairsPreference";
import RepaymentsSection, { type RepaymentListRow } from "./RepaymentsSection";
import RulesClient, { type RuleListRow } from "./RulesClient";

export const dynamic = "force-dynamic";

export default async function BankRulesPage() {
  const sb = await createSupabaseServerClient();
  const [role, rules, accounts, preference, repayments] = await Promise.all([
    getUserRole(),
    listBankRules(sb),
    listAccounts(sb),
    getBankingPreference(sb),
    listRepayments(sb),
  ]);
  const liabilities = accounts
    .filter(fundingAccountAllowed)
    .map((account) => ({ id: account.id, label: `${account.account_code} — ${account.name}` }));
  const [waiting, stats] = await Promise.all([ruleWaitingCounts(sb, rules), repaymentStats(sb, repayments)]);
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const chart = new Map(accounts.map((account) => [account.id, codingAccountOf(account)]));
  const labelOf = (id: string) => {
    const account = byId.get(id);
    return account ? `${account.account_code} — ${account.name}` : "Account not found";
  };
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
    accountUsable: usableRepayment({ ...entry, isActive: true }, chart),
    stats: stats[entry.id] ?? { past: 0, caught: 0, waiting: 0, missed: [] },
  }));
  return (
    <div>
      <PageHeader
        title="Bank Rules"
        description="What says which account a bank line belongs to. A card in Cards and loans is recognised first; then the first rule that matches; history speaks only when neither does. Nothing is posted until someone uses a suggestion."
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
