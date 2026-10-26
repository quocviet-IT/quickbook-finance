"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Space, Switch, Table, Tag, Tooltip, Typography } from "antd";
import type { AppRole, PermissionRow, RolePermissionRow } from "@/lib/db/types";
import { emptyGrants, minRoleNote, roleMeets } from "@/lib/domain/access";
import { APP_ROLES } from "@/lib/domain/schemas";
import { setRolePermissionAction } from "./actions";

// Columns follow the one ordered role list, so a role added later cannot be
// missing a column here while being present everywhere else.
const ROLES: AppRole[] = [...APP_ROLES];

interface Row extends PermissionRow {
  allowed: Record<AppRole, boolean>;
}

export default function PermissionMatrixClient({
  permissions,
  assignments,
  canManage,
}: {
  permissions: PermissionRow[];
  assignments: RolePermissionRow[];
  canManage: boolean;
}) {
  const { message } = App.useApp();
  const router = useRouter();
  const [saving, setSaving] = useState<string | null>(null);

  const rows = useMemo<Row[]>(() => {
    const byKey = new Map<string, Record<AppRole, boolean>>();
    for (const p of permissions) {
      byKey.set(p.key, emptyGrants());
    }
    for (const a of assignments) {
      const entry = byKey.get(a.permission_key);
      if (entry) entry[a.role] = a.allowed;
    }
    return permissions.map((p) => ({ ...p, allowed: byKey.get(p.key)! }));
  }, [permissions, assignments]);

  async function toggle(key: string, role: AppRole, allowed: boolean) {
    setSaving(`${role}:${key}`);
    const res = await setRolePermissionAction({ role, permission_key: key, allowed });
    setSaving(null);
    if (res.ok) {
      message.success("Permission updated");
      router.refresh();
    } else {
      message.error(res.error ?? "Failed to update the permission");
    }
  }

  // Since 2.59 every permission is checked before its action runs. A permission
  // added later without that check is marked, rather than looking like one
  // that works.
  const advisory = permissions.some((p) => !p.is_enforced);

  return (
    <Space direction="vertical" size="large" style={{ display: "flex" }}>
      <Alert
        type={advisory ? "warning" : "info"}
        showIcon
        message={advisory ? "Some permissions are not enforced yet" : "Every permission is enforced"}
        description={
          advisory
            ? "Those marked Not enforced are listed for reference: the app does not block them yet. Every other permission is checked before its action runs."
            : "Each permission is checked before its action runs. A greyed-out switch is one that role cannot use: bookkeeping actions also need the admin or accountant role, and reopening a period or a reconciliation needs an admin."
        }
      />
      <Table<Row>
        rowKey="key"
        dataSource={rows}
        pagination={false}
        scroll={{ x: "max-content" }}
        columns={[
          {
            title: "Permission",
            dataIndex: "label",
            render: (v: string, r) => (
              <Tooltip
                title={
                  <>
                    {r.description ? <div>{r.description}</div> : null}
                    <div>{r.key}</div>
                  </>
                }
              >
                <Typography.Text strong>{v}</Typography.Text>
              </Tooltip>
            ),
          },
          { title: "Area", dataIndex: "category" },
          ...(advisory
            ? [
                {
                  title: "Control",
                  dataIndex: "is_enforced",
                  render: (v: boolean) =>
                    v ? <Tag color="green">Enforced</Tag> : <Tag color="default">Not enforced</Tag>,
                },
              ]
            : []),
          ...ROLES.map((role) => ({
            title: role.charAt(0).toUpperCase() + role.slice(1),
            key: role,
            align: "center" as const,
            render: (_: unknown, r: Row) => {
              // Below the permission's least role a grant would change nothing,
              // and the database refuses it (2.60). One already on can still be
              // switched off.
              const unusable = !roleMeets(role, r.min_role) && !r.allowed[role];
              const control = (
                <Switch
                  checked={r.allowed[role]}
                  disabled={!canManage || unusable || saving === `${role}:${r.key}`}
                  aria-label={`${r.label} for ${role}`}
                  onChange={(checked) => toggle(r.key, role, checked)}
                />
              );
              return unusable ? <Tooltip title={minRoleNote(r.min_role)}>{control}</Tooltip> : control;
            },
          })),
        ]}
      />
    </Space>
  );
}
