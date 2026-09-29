import { createSupabaseServerClient } from "@/lib/db/server";
import { canWrite, getUserRole } from "@/lib/auth";
import { codableAccount, codingAccountOf } from "@/lib/domain/coding";
import { listAccounts } from "@/lib/services/accounts";
import { listBankRules, ruleWaitingCounts } from "@/lib/services/coding";
import PageHeader from "@/components/PageHeader";
import RulesClient, { type RuleListRow } from "./RulesClient";

export const dynamic = "force-dynamic";

export default async function BankRulesPage() {
  const sb = await createSupabaseServerClient();
  const [role, rules, accounts] = await Promise.all([getUserRole(), listBankRules(sb), listAccounts(sb)]);
  const waiting = await ruleWaitingCounts(sb, rules);
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const rows: RuleListRow[] = rules.map((rule) => {
    const account = byId.get(rule.accountId);
    return {
      ...rule,
      accountLabel: account ? `${account.account_code} — ${account.name}` : "Account not found",
      accountUsable: codableAccount(account ? codingAccountOf(account) : undefined),
      waiting: waiting[rule.id] ?? 0,
    };
  });
  return (
    <div>
      <PageHeader
        title="Bank Rules"
        description="The words that say which account a bank line belongs to. The first rule that matches suggests the account; history speaks only when no rule does. Nothing is posted until someone uses a suggestion."
      />
      <RulesClient
        rules={rows}
        accounts={accounts.filter((account) => codableAccount(codingAccountOf(account)))}
        canWrite={canWrite(role)}
      />
    </div>
  );
}
