"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Space, Switch, Tag, Tooltip, Typography } from "antd";
import type { AppRole, PermissionRow, RolePermissionRow } from "@/lib/db/types";
import { emptyGrants, minRoleNote, roleMeets } from "@/lib/domain/access";
import { APP_ROLES } from "@/lib/domain/schemas";
import { setRolePermissionAction } from "./actions";
import DataTable from "@/components/ui/DataTable";
import { flexColumn } from "@/components/ui/columns";
import { COLUMN } from "@/lib/design/table-metrics";

// Columns follow the one ordered role list, so a role added later cannot be
// missing a column here while being present everywhere else.
const ROLES: AppRole[] = [...APP_ROLES];

/**
 * Area, Control (shown only while some permission is not enforced), then one
 * column per role. Permission takes what is left, at least COLUMN.TEXT_MIN.
 *
 * The roles are the fixed list above, four of them, so this is a designed grid
 * and fits its box like any other table: the rows are what grow with data. The
 * widest case, with Control showing, is the one measured.
 */
export const PERMISSION_MATRIX_FIXED_WIDTHS = [
  COLUMN.CODE,
  COLUMN.STATUS,
  ...APP_ROLES.map(() => COLUMN.CODE),
] as const;

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
      <DataTable<Row>
        rowKey="key"
        rows={rows}
        pagination={false}
        columns={[
          flexColumn<Row>({
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
          }),
          { title: "Area", dataIndex: "category", width: PERMISSION_MATRIX_FIXED_WIDTHS[0] },
          ...(advisory
            ? [
                {
                  title: "Control",
                  dataIndex: "is_enforced",
                  width: PERMISSION_MATRIX_FIXED_WIDTHS[1],
                  render: (v: boolean) =>
                    v ? <Tag color="green">Enforced</Tag> : <Tag color="default">Not enforced</Tag>,
                },
              ]
            : []),
          ...ROLES.map((role, i) => ({
            title: role.charAt(0).toUpperCase() + role.slice(1),
            key: role,
            width: PERMISSION_MATRIX_FIXED_WIDTHS[2 + i],
            align: "center" as const,
            render: (_: unknown, r: Row) => {
              // Below the permission's least role a grant would change nothing,
              // and the database refuses it (2.60). One already on can still be
              // switched off.
              const unusable = !roleMeets(role, r.min_role) && !r.allowed[role];
              // The reason is in the accessible name too: a disabled switch takes
              // no focus, so the hover note never reaches a keyboard or
              // screen-reader user (access audit, 27 Oct 2026).
              const control = (
                <Switch
                  checked={r.allowed[role]}
                  disabled={!canManage || unusable || saving === `${role}:${r.key}`}
                  aria-label={
                    unusable
                      ? `${r.label} for ${role}: ${minRoleNote(r.min_role)?.toLowerCase()}`
                      : `${r.label} for ${role}`
                  }
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
