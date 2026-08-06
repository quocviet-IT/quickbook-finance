import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/db/server";
import { isPlatformAdmin, resolveActiveCompany } from "@/lib/db/company";
import { countPendingApprovals } from "@/lib/services/access";
import { currentAccess } from "@/lib/db/settings-access";
import AppShell from "@/components/AppShell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Which company is open decides which schema everything below reads, so it is
  // resolved before anything else.
  const { active, options } = await resolveActiveCompany();
  // Answered here so every screen's header can offer a new company, or not.
  const canCreateCompany = await isPlatformAdmin();
  const sb = await createSupabaseServerClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login");

  // The badge must never take the shell down with it: a failed count shows zero.
  // Access comes from currentAccess() rather than being rebuilt here, so the
  // shell, the settings hub and every settings guard read one answer. It is
  // cache()d, so sharing it costs no extra queries.
  const [pendingApprovals, { role, permissionKeys }] = await Promise.all([
    countPendingApprovals(sb).catch(() => 0),
    currentAccess(),
  ]);

  return (
    <AppShell
      email={user.email ?? ""}
      role={role}
      canCreateCompany={canCreateCompany}
      activeCompany={
        active
          ? {
              slug: active.slug,
              legalName: active.legalName,
              dbaName: active.dbaName,
              isSample: active.isSample,
            }
          : null
      }
      companyOptions={options.map((company) => ({
        slug: company.slug,
        legalName: company.legalName,
        dbaName: company.dbaName,
        isSample: company.isSample,
      }))}
      permissionKeys={permissionKeys}
      pendingApprovals={pendingApprovals}
    >
      {children}
    </AppShell>
  );
}
