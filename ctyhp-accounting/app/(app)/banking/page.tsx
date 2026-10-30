import { createSupabaseServerClient } from "@/lib/db/server";
import { listBankAccounts, listBankConnections } from "@/lib/services/banking";
import { listAccounts } from "@/lib/services/accounts";
import { listCurrencies } from "@/lib/services/reference";
import { getUserRole, canWrite, isAdmin } from "@/lib/auth";
import { bankFeedEncryptionConfigured } from "@/lib/services/bank-token-crypto";
import { plaidConfiguration } from "@/lib/services/plaid";
import { hasPermission } from "@/lib/services/access";
import PageHeader from "@/components/PageHeader";
import BankingClient from "./BankingClient";
import { isServerActionRender } from "@/lib/services/request-kind";
import { readOpeningBankingView } from "./banking-view";

export const dynamic = "force-dynamic";

export default async function BankingPage({
  searchParams,
}: {
  searchParams: Promise<{
    queue?: string;
    account?: string;
    focus?: string;
    /** `1` from the New menu: open Import statement. */
    import?: string;
  }>;
}) {
  const params = await searchParams;
  const sb = await createSupabaseServerClient();
  // A save on this screen renders the page again in its answer; the screen
  // keeps its own lines, so they are not read again for it.
  const afterSave = await isServerActionRender();
  const bankAccountsRead = listBankAccounts(sb);
  const [
    bankAccounts,
    openingView,
    bankConnections,
    accounts,
    currencies,
    role,
    canReadDocuments,
    canManageDocuments,
    canGovernDocuments,
  ] = await Promise.all([
    bankAccountsRead,
    // The lines of the account the screen opens on, read here rather than by
    // the screen once it has loaded (2.91): from the browser that was a wait
    // for the page's code, then a Server Action queued behind it, and the
    // table sat empty under a spinner for four to six seconds.
    afterSave ? null : bankAccountsRead.then((list) => readOpeningBankingView(sb, list, params.account ?? null)),
    listBankConnections(sb),
    listAccounts(sb),
    listCurrencies(sb),
    getUserRole(),
    hasPermission(sb, "documents.read"),
    hasPermission(sb, "documents.manage"),
    hasPermission(sb, "documents.govern"),
  ]);

  const linkedIds = new Set(bankAccounts.map((b) => b.account_id));
  // Bank-type accounts and (2.45) credit cards: a card's statement is imported and reconciled here too.
  const glBankAccounts = accounts.filter(
    (a) =>
      (a.account_type === "bank" || a.account_type === "credit_card") &&
      a.is_posting_account &&
      a.status === "active" &&
      !linkedIds.has(a.id),
  );
  const plaid = plaidConfiguration();

  return (
    <div>
      <PageHeader
        title="Banking"
        description="Connect bank feeds, review imported activity, and match it to the General Ledger."
      />
      <BankingClient
        bankAccounts={bankAccounts}
        accounts={accounts}
        initialAccountId={params.account ?? null}
        openingView={openingView}
        initialQueueStatus={params.queue === "unmatched" ? "unmatched" : null}
        initialFocusId={params.focus ?? null}
        initialImport={params.import === "1"}
        bankConnections={bankConnections}
        glBankAccounts={glBankAccounts}
        currencies={currencies}
        canWrite={canWrite(role)}
        canOverride={isAdmin(role)}
        plaidConfigured={plaid.configured && bankFeedEncryptionConfigured()}
        plaidEnvironment={plaid.environment}
        canReadDocuments={canReadDocuments}
        canManageDocuments={canManageDocuments}
        canGovernDocuments={canGovernDocuments}
      />
    </div>
  );
}
