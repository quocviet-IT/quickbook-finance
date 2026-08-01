import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/db/server";
import { resolveActiveCompany } from "@/lib/db/company";
import { countPendingApprovals } from "@/lib/services/access";
import type { AppRole } from "@/lib/db/types";
import AppShell from "@/components/AppShell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Which company is open decides which schema everything below reads, so it is
  // resolved before anything else.
  const { active, options } = await resolveActiveCompany();
  const sb = await createSupabaseServerClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login");

  // Reuse one authenticated client and load independent shell data in parallel.
  // The badge must never take the shell down with it: a failed count shows zero.
  const [profile, pendingApprovals, allowedPermissions] = await Promise.all([
    sb.from("acc_app_user").select("role").eq("id", user.id).maybeSingle(),
    countPendingApprovals(sb).catch(() => 0),
    sb
      .from("acc_role_permission")
      .select("role,permission_key")
      .eq("allowed", true),
  ]);
  const role = (profile.data?.role as AppRole | undefined) ?? null;
  const permissionKeys = allowedPermissions.error
    ? null
    : (allowedPermissions.data ?? [])
        .filter((row) => row.role === role)
        .map((row) => row.permission_key);

  return (
    <AppShell
      email={user.email ?? ""}
      role={role}
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
