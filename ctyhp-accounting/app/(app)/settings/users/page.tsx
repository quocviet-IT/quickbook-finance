import { requireSettingsAccess } from "@/lib/db/settings-access";
import { createSupabaseServerClient } from "@/lib/db/server";
import { isAdminClientConfigured } from "@/lib/db/admin";
import { listUsers } from "@/lib/services/access";
import { getSessionUser, holdsPermission } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import { Alert } from "antd";
import UsersClient from "./UsersClient";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  await requireSettingsAccess("/settings/users");
  const [canManage, user] = await Promise.all([holdsPermission("users.manage"), getSessionUser()]);

  if (!canManage) {
    return (
      <div>
        <PageHeader title="Users" description="Roles, access status, and multi-factor enrollment." />
        <Alert
          type="warning"
          showIcon
          message="Needs the Manage users permission"
          description="Only someone who holds Manage users can view and manage users."
        />
      </div>
    );
  }

  const sb = await createSupabaseServerClient();
  const users = await listUsers(sb);

  return (
    <div>
      <PageHeader
        title="Users"
        description="Create login accounts, assign roles, and revoke access. Every change is audited."
      />
      <UsersClient
        users={users}
        currentUserId={user?.id ?? ""}
        canManage={canManage}
        canCreateUsers={isAdminClientConfigured()}
      />
    </div>
  );
}
