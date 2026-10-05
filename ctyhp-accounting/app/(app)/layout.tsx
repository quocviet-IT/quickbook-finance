import { redirect } from "next/navigation";
import { createSupabaseServerClient, createSupabaseServerClientForSchema } from "@/lib/db/server";
import { isPlatformAdmin, resolveActiveCompany } from "@/lib/db/company";
import { countPendingApprovals } from "@/lib/services/access";
import { currentAccess } from "@/lib/db/settings-access";
import AppShell from "@/components/AppShell";
import NoCompanyNotice from "@/components/NoCompanyNotice";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Which company is open decides which schema everything below reads, so it is
  // resolved before anything else — and before any client is bound to a schema.
  //
  // The order matters and it did not used to. `createSupabaseServerClient()`
  // came first, which meant the layout asked for a client for "the current
  // company" before establishing that there was one. Now that `activeSchema()`
  // fails closed rather than guessing `public`, that call would throw here and
  // take the whole shell down instead of explaining itself.
  const { active, options } = await resolveActiveCompany();

  // Signing in is not a company question, so this client is bound to the
  // register rather than to books this account may not have.
  const control = await createSupabaseServerClientForSchema("onebook");
  const {
    data: { user },
  } = await control.auth.getUser();
  if (!user) redirect("/login");

  // Answered here so every screen's header can offer a new company, or not.
  const canCreateCompany = await isPlatformAdmin();

  if (!active) {
    // Entitled to nothing. Say so — the alternative was reading the first
    // company's ledger behind a switcher that showed no company at all.
    return <NoCompanyNotice email={user.email ?? ""} canCreateCompany={canCreateCompany} />;
  }

  const sb = await createSupabaseServerClient();

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
      activeCompany={{
        slug: active.slug,
        legalName: active.legalName,
        dbaName: active.dbaName,
        isSample: active.isSample,
      }}
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
