"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Space, Switch, Tag, Tooltip, Typography } from "antd";
import type { AppRole, PermissionRow, RolePermissionRow } from "@/lib/db/types";
import { emptyGrants, minRoleNote, roleMeets } from "@/lib/domain/access";
import { APP_ROLES } from "@/lib/domain/schemas";
import { cellKey, describeChange, flip, pendingChanges, type PermissionDrafts } from "@/lib/domain/permission-changes";
import { plural } from "@/lib/format";
import { useUnsavedGuard } from "@/lib/client/use-unsaved-guard";
import { saveRolePermissionsAction } from "./actions";
import DataTable from "@/components/ui/DataTable";
import FormActions from "@/components/ui/FormActions";
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

const roleTitle = (role: AppRole) => role.charAt(0).toUpperCase() + role.slice(1);

export default function PermissionMatrixClient({
  permissions,
  assignments,
  canManage,
}: {
  permissions: PermissionRow[];
  assignments: RolePermissionRow[];
  canManage: boolean;
}) {
  const { message, modal } = App.useApp();
  const router = useRouter();
  /**
   * Flipped switches not saved yet (3.0.34). A switch used to write the moment
   * it moved; now the matrix is edited like a form, and Save writes the
   * changes together after showing them.
   */
  const [drafts, setDrafts] = useState<PermissionDrafts>({});
  const [saving, setSaving] = useState(false);
  /** What the last save could not do, beside Save until the next attempt. */
  const [saveError, setSaveError] = useState<string | null>(null);

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

  const changes = useMemo(() => pendingChanges(drafts, permissions, ROLES), [drafts, permissions]);
  const dirty = changes.length > 0;
  useUnsavedGuard(dirty, modal, "the permissions");

  function discard() {
    setDrafts({});
    setSaveError(null);
  }

  async function save() {
    if (saving || !dirty) return;
    setSaving(true);
    setSaveError(null);
    const res = await saveRolePermissionsAction(
      changes.map(({ role, permission_key, allowed }) => ({ role, permission_key, allowed })),
    ).catch((error: unknown) => ({
      ok: false as const,
      data: undefined,
      error: `The request did not reach the server (${error instanceof Error ? error.message : String(error)}). Nothing was saved.`,
    }));
    setSaving(false);
    if (!res.ok || !res.data) {
      // Nothing was saved: every change stays, to try again.
      setSaveError(res.error ?? "The permissions could not be saved.");
      return;
    }
    const { saved, refused } = res.data;
    // What was saved leaves the drafts; what was refused stays, marked, to try again.
    const stillPending: Record<string, boolean> = {};
    for (const r of refused) {
      const key = cellKey(r.role as AppRole, r.permission_key);
      if (drafts[key] !== undefined) stillPending[key] = drafts[key];
    }
    setDrafts(stillPending);
    if (saved > 0) router.refresh();
    if (refused.length === 0) {
      message.success(`Saved ${plural(saved, "permission change")}`);
    } else {
      const labelOf = new Map(permissions.map((p) => [p.key, p.label]));
      setSaveError(
        `${saved} saved, ${refused.length} not: ` +
          refused
            .map((r) => `${describeChange({ role: r.role, label: labelOf.get(r.permission_key) ?? r.permission_key, allowed: drafts[cellKey(r.role as AppRole, r.permission_key)] ?? false })} — ${r.error}`)
            .join("; "),
      );
    }
  }

  /** Ask first, naming every change: a permission taken away locks people out at once. */
  function confirmSave() {
    modal.confirm({
      autoFocusButton: "cancel",
      title: `Save ${plural(changes.length, "permission change")}?`,
      width: 520,
      content: (
        <ul style={{ margin: "8px 0 0", paddingInlineStart: 20 }}>
          {changes.map((change) => (
            <li key={cellKey(change.role, change.permission_key)}>{describeChange(change)}</li>
          ))}
        </ul>
      ),
      okText: "Save changes",
      cancelText: "Keep editing",
      onOk: () => save(),
    });
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
      <div>
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
                  <Space size={6}>
                    <Typography.Text strong>{v}</Typography.Text>
                    {/* As on Approval policies: the row says it holds a change Save will write. */}
                    {ROLES.some((role) => drafts[cellKey(role, r.key)] !== undefined) ? <Tag color="gold">Unsaved</Tag> : null}
                  </Space>
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
              title: roleTitle(role),
              key: role,
              width: PERMISSION_MATRIX_FIXED_WIDTHS[2 + i],
              align: "center" as const,
              render: (_: unknown, r: Row) => {
                const saved = r.allowed[role];
                const draft = drafts[cellKey(role, r.key)];
                const changed = draft !== undefined;
                const shown = changed ? draft : saved;
                // Below the permission's least role a grant would change nothing,
                // and the database refuses it (2.60). One already on can still be
                // switched off, and switched back.
                const unusable = !roleMeets(role, r.min_role) && !saved;
                // The reason is in the accessible name too: a disabled switch takes
                // no focus, so the hover note never reaches a keyboard or
                // screen-reader user (access audit, 27 Oct 2026).
                const control = (
                  <span className={changed ? "permission-matrix__cell permission-matrix__cell--changed" : "permission-matrix__cell"}>
                    <Switch
                      checked={shown}
                      disabled={!canManage || unusable || saving}
                      aria-label={
                        unusable
                          ? `${r.label} for ${role}: ${minRoleNote(r.min_role)?.toLowerCase()}`
                          : `${r.label} for ${role}${changed ? ", changed, not saved" : ""}`
                      }
                      onChange={(checked) => setDrafts((d) => flip(d, role, r.key, checked, saved))}
                    />
                  </span>
                );
                return unusable ? <Tooltip title={minRoleNote(r.min_role)}>{control}</Tooltip> : control;
              },
            })),
          ]}
        />
        {canManage ? (
          <FormActions
            error={saveError}
            note={
              dirty
                ? `${plural(changes.length, "unsaved change")}, marked in the table`
                : "No unsaved changes"
            }
          >
            <Button type="primary" loading={saving} disabled={!dirty} onClick={confirmSave}>
              Save changes
            </Button>
            <Button disabled={!dirty || saving} onClick={discard}>
              Discard changes
            </Button>
          </FormActions>
        ) : (
          <FormActions note="Only an administrator can change the permissions." />
        )}
      </div>
    </Space>
  );
}
