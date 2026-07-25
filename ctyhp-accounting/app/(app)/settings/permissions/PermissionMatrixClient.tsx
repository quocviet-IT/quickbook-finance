"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Space, Switch, Table, Tag, Tooltip, Typography } from "antd";
import type { AppRole, PermissionRow, RolePermissionRow } from "@/lib/db/types";
import { setRolePermissionAction } from "./actions";

const ROLES: AppRole[] = ["admin", "accountant", "viewer"];

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
      byKey.set(p.key, { admin: false, accountant: false, viewer: false });
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

  return (
    <Space direction="vertical" size="large" style={{ display: "flex" }}>
      <Alert
        type="warning"
        showIcon
        message="Enforced and advisory permissions"
        description="Permissions marked Enforced are checked by the server before the action runs. The rest are recorded here but the underlying operation still gates on the coarse role check (admin or accountant), so switching one off does not yet block it. Converting the remaining operations is a planned follow-up; until then treat the advisory rows as documentation, not control."
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
              <Space direction="vertical" size={0}>
                <Tooltip title={r.description}>
                  <Typography.Text strong>{v}</Typography.Text>
                </Tooltip>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {r.key}
                </Typography.Text>
              </Space>
            ),
          },
          { title: "Area", dataIndex: "category" },
          {
            title: "Control",
            dataIndex: "is_enforced",
            render: (v: boolean) =>
              v ? <Tag color="green">Enforced</Tag> : <Tag color="default">Advisory</Tag>,
          },
          ...ROLES.map((role) => ({
            title: role.charAt(0).toUpperCase() + role.slice(1),
            key: role,
            align: "center" as const,
            render: (_: unknown, r: Row) => (
              <Switch
                checked={r.allowed[role]}
                disabled={!canManage || saving === `${role}:${r.key}`}
                aria-label={`${r.label} for ${role}`}
                onChange={(checked) => toggle(r.key, role, checked)}
              />
            ),
          })),
        ]}
      />
    </Space>
  );
}
