import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite, holdsPermission } from "@/lib/auth";
import { listCurrencies } from "@/lib/services/reference";
import { listAccounts } from "@/lib/services/accounts";
import { hasPermission } from "@/lib/services/access";
import { readJournalList } from "@/lib/services/journal";
import { firstPaintRead } from "@/lib/services/request-kind";
import PageHeader from "@/components/PageHeader";
import JournalClient from "./JournalClient";

export const dynamic = "force-dynamic";

export default async function JournalPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; entry?: string | string[] }>;
}) {
  const params = await searchParams;
  const initialCreateOpen = params.new === "1";
  const initialEntryId = Array.isArray(params.entry) ? params.entry[0] : params.entry;
  const sb = await createSupabaseServerClient();
  const [
    currencies,
    accounts,
    role,
    canReadDocuments,
    canManageDocuments,
    canGovernDocuments,
    canMarkAdjusting,
    holdsReverse,
    journal,
  ] = await Promise.all([
    listCurrencies(sb),
    listAccounts(sb),
    getUserRole(),
    hasPermission(sb, "documents.read"),
    hasPermission(sb, "documents.manage"),
    hasPermission(sb, "documents.govern"),
    hasPermission(sb, "journal.post"),
    holdsPermission("journal.void"),
    // The list as the screen first asks for it: every date, or the one entry
    // a report linked to.
    firstPaintRead(() => readJournalList(sb, { entryId: initialEntryId ?? null, from: null, to: null })),
  ]);
  const base = currencies.find((c) => c.is_base);
  const postingAccounts = accounts.filter((a) => a.is_posting_account && a.status === "active");
  return (
    <div>
      <PageHeader title="Journal Entries" description="Create balanced manual journals and correct posted entries with linked reversals." />
      <JournalClient
        initialCreateOpen={initialCreateOpen}
        canWrite={canWrite(role)}
        canReverse={canWrite(role) && holdsReverse}
        accounts={postingAccounts.map((a) => ({ id: a.id, account_code: a.account_code, name: a.name }))}
        baseCurrency={base?.code ?? "USD"}
        baseDecimals={base?.decimal_places ?? 2}
        initialEntryId={initialEntryId}
        initialJournal={journal}
        canReadDocuments={canReadDocuments}
        canManageDocuments={canManageDocuments}
        canGovernDocuments={canGovernDocuments}
        canMarkAdjusting={canMarkAdjusting}
      />
    </div>
  );
}
