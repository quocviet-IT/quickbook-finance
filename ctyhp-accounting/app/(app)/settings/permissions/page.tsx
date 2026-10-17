import { requireSettingsAccess } from "@/lib/db/settings-access";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getPermissionMatrix } from "@/lib/services/access";
import { getUserRole, isAdmin } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import PermissionMatrixClient from "./PermissionMatrixClient";

export const dynamic = "force-dynamic";

export default async function PermissionsPage() {
  await requireSettingsAccess("/settings/permissions");
  const sb = await createSupabaseServerClient();
  const [matrix, role] = await Promise.all([getPermissionMatrix(sb), getUserRole()]);

  return (
    <div>
      <PageHeader
        title="Permissions"
        description="What each role is allowed to do. The starting settings match how the app worked before this screen existed."
      />
      <PermissionMatrixClient
        permissions={matrix.permissions}
        assignments={matrix.assignments}
        canManage={isAdmin(role)}
      />
    </div>
  );
}
