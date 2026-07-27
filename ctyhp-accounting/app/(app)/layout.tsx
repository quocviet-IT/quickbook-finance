import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/db/server";
import { countPendingApprovals } from "@/lib/services/access";
import type { AppRole } from "@/lib/db/types";
import AppShell from "@/components/AppShell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const sb = await createSupabaseServerClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login");

  // Reuse one authenticated client and load independent shell data in parallel.
  // The badge must never take the shell down with it: a failed count shows zero.
  const [profile, pendingApprovals] = await Promise.all([
    sb.from("acc_app_user").select("role").eq("id", user.id).maybeSingle(),
    countPendingApprovals(sb).catch(() => 0),
  ]);
  const role = (profile.data?.role as AppRole | undefined) ?? null;

  return (
    <AppShell email={user.email ?? ""} role={role} pendingApprovals={pendingApprovals}>
      {children}
    </AppShell>
  );
}
