import { requireUser, getUserRole } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/db/server";
import { countPendingApprovals } from "@/lib/services/access";
import AppShell from "@/components/AppShell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const role = await getUserRole();

  // The badge must never take the shell down with it: a failed count shows zero.
  let pendingApprovals = 0;
  try {
    const sb = await createSupabaseServerClient();
    pendingApprovals = await countPendingApprovals(sb);
  } catch {
    pendingApprovals = 0;
  }

  return (
    <AppShell email={user.email ?? ""} role={role} pendingApprovals={pendingApprovals}>
      {children}
    </AppShell>
  );
}
