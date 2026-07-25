import { createSupabaseServerClient } from "@/lib/db/server";
import { isAdminClientConfigured } from "@/lib/db/admin";
import { listUsers } from "@/lib/services/access";
import { getSessionUser, getUserRole, isAdmin } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import { Alert } from "antd";
import UsersClient from "./UsersClient";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const [role, user] = await Promise.all([getUserRole(), getSessionUser()]);
  const canManage = isAdmin(role);

  if (!canManage) {
    return (
      <div>
        <PageHeader title="Users" description="Roles, access status, and multi-factor enrolment." />
        <Alert
          type="warning"
          showIcon
          message="Admin only"
          description="Only an admin can view and manage users."
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
        description="Create users, send password setup emails, assign roles, and revoke access. Every change is audited."
      />
      <UsersClient
        users={users}
        currentUserId={user?.id ?? ""}
        canManage={canManage}
        canInvite={isAdminClientConfigured()}
      />
    </div>
  );
}
