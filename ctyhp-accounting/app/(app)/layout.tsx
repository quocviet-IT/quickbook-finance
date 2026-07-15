import { requireUser, getUserRole } from "@/lib/auth";
import AppShell from "@/components/AppShell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const role = await getUserRole();
  return (
    <AppShell email={user.email ?? ""} role={role}>
      {children}
    </AppShell>
  );
}
