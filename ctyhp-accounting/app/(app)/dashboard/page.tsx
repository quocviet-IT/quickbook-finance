import { createSupabaseServerClient } from "@/lib/db/server";
import DashboardClient from "./DashboardClient";

export const dynamic = "force-dynamic";

async function countRows(table: string): Promise<number> {
  const sb = await createSupabaseServerClient();
  const { count } = await sb.from(table).select("id", { count: "exact", head: true });
  return count ?? 0;
}

export default async function DashboardPage() {
  const [accounts, entries] = await Promise.all([
    countRows("acc_account"),
    countRows("acc_journal_entry"),
  ]);

  return <DashboardClient accounts={accounts} entries={entries} />;
}
