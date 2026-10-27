"use client";
import { useCompanyClock } from "@/components/CompanyClock";
import { formatDateTime } from "@/lib/format";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Form, Input, Modal, Select, Space, Table, Tag, Tooltip, Typography } from "antd";
import type { MenuProps } from "antd";
import { PlusOutlined, UserAddOutlined } from "@ant-design/icons";
import FilterBar from "@/components/ui/FilterBar";
import type { AppRole, AppUserRow, UserStatus } from "@/lib/db/types";
import { ADMIN_CAP, canBecomeAdmin, describeStatusChange, isLastActiveAdmin } from "@/lib/domain/access";
import { passwordPolicyProblems } from "@/lib/domain/password-policy";
import { addExistingUserAction, createUserAction, setUserRoleAction, setUserStatusAction } from "./actions";
import { flexColumn, secondaryLine } from "@/components/ui/columns";
import StatusTag from "@/components/ui/StatusTag";
import { humanizeStatus, type StatusLook } from "@/lib/domain/status-label";
import RowActionsMenu from "@/components/ui/RowActionsMenu";

const STATUS_LOOKS: Record<string, StatusLook> = {
  invited: { tone: "neutral", label: "Pending" },
  suspended: { tone: "warning", label: "Suspended" },
  offboarded: { tone: "danger", label: "Offboarded" },
};

/**
 * The roles a person can be given. Admin is offered only while the company has
 * room for one more: at most two admins hold access (2.62), and the database
 * refuses a third however it arrives.
 */
function roleOptions(adminAllowed: boolean): { value: AppRole; label: string; disabled?: boolean }[] {
  return [
    adminAllowed
      ? { value: "admin", label: "Admin" }
      : { value: "admin", label: `Admin (${ADMIN_CAP} already)`, disabled: true },
    { value: "accountant", label: "Accountant" },
    { value: "sales", label: "Sales" },
    { value: "viewer", label: "Viewer" },
  ];
}

export default function UsersClient({
  users,
  currentUserId,
  canManage,
  canCreateUsers,
}: {
  users: AppUserRow[];
  currentUserId: string;
  canManage: boolean;
  /** Account creation goes through the Auth admin API, which needs the service-role key. */
  canCreateUsers: boolean;
}) {
  const { message, modal } = App.useApp();
  const { timeZone } = useCompanyClock();
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [addExistingOpen, setAddExistingOpen] = useState(false);

  /** Ask for the reason every access change is required to carry. */
  function promptReason(title: string, content: string, onReason: (reason: string) => Promise<void>) {
    let reason = "";
    modal.confirm({
      title,
      content: (
        <div>
          <Typography.Paragraph type="secondary">{content}</Typography.Paragraph>
          <textarea
            aria-label="Reason"
            rows={3}
            style={{ width: "100%" }}
            onChange={(e) => {
              reason = e.target.value;
            }}
          />
        </div>
      ),
      okText: "Confirm",
      onOk: async () => {
        if (!reason.trim()) {
          message.error("A reason is required");
          throw new Error("A reason is required");
        }
        await onReason(reason.trim());
      },
    });
  }

  async function changeStatus(user: AppUserRow, status: UserStatus) {
    promptReason(describeStatusChange(user.status, status), `${user.email} — this is recorded in the audit log.`, async (reason) => {
      const res = await setUserStatusAction(user.id, { status, reason });
      if (!res.ok) {
        message.error(res.error ?? "Failed to change the status");
        throw new Error(res.error);
      }
      message.success("Access updated");
      router.refresh();
    });
  }

  async function changeRole(user: AppUserRow, role: AppRole) {
    if (role === user.role) return;
    promptReason(`Change ${user.email} to ${role}?`, "Role changes take effect immediately and are recorded in the audit log.", async (reason) => {
      const res = await setUserRoleAction(user.id, { role, reason });
      if (!res.ok) {
        message.error(res.error ?? "Failed to change the role");
        throw new Error(res.error);
      }
      message.success("Role updated");
      router.refresh();
    });
  }

  return (
    <Space direction="vertical" size="large" style={{ display: "flex" }}>
      <Alert
        type="info"
        showIcon
        message="Privileged access policy"
        description="Multi-factor sign-in is recommended for admins, accountants and sales users, not yet required; the MFA column shows who has it. Suspending a user ends their access at once. The last active admin cannot be demoted or suspended."
      />

      {canManage && !canCreateUsers && (
        <Alert
          type="warning"
          showIcon
          message="User creation is not configured"
          description="Creating a login with an administrator-assigned password needs SUPABASE_SERVICE_ROLE_KEY in the server environment."
        />
      )}

      <FilterBar
        resultCount={users.length}
        actions={
          canManage ? (
            <Space wrap>
              {/* Someone who already signs in for another company: no new
                  account, no password, just a place in this one. */}
              <Button icon={<UserAddOutlined />} onClick={() => setAddExistingOpen(true)}>
                Add existing account
              </Button>
              <Tooltip title={canCreateUsers ? "" : "Set SUPABASE_SERVICE_ROLE_KEY to create users"}>
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  disabled={!canCreateUsers}
                  onClick={() => setCreateOpen(true)}
                >
                  Add user
                </Button>
              </Tooltip>
            </Space>
          ) : null
        }
      />

      <Table<AppUserRow>
        rowKey="id"
        dataSource={users}
        pagination={false}
        locale={{ emptyText: "No users yet" }}
        columns={[
          {
            // The elastic column: an email address is as long as it is, and
            // the name and the reason a status was set belong with it rather
            // than in columns of their own.
            ...flexColumn<AppUserRow>({
              title: "Email",
              key: "email",
              render: (_: unknown, r: AppUserRow) => (
                <div style={{ minWidth: 0 }}>
                  <span title={r.email}>{r.email}</span>
                  {r.id === currentUserId ? <Tag style={{ marginLeft: 6 }}>You</Tag> : null}
                  {secondaryLine(
                    [r.full_name || "No name recorded", r.status_reason].filter(Boolean).join(" · "),
                  )}
                </div>
              ),
            }),
          },
          {
            title: "Role",
            dataIndex: "role",
            width: 160,
            render: (v: AppRole, r) =>
              canManage ? (
                <Select
                  value={v}
                  // Fills the column instead of declaring a width wider than
                  // one; the dropdown stays readable on its own.
                  style={{ width: "100%" }}
                  popupMatchSelectWidth={200}
                  options={roleOptions(canBecomeAdmin(users, r.id))}
                  aria-label={`Role for ${r.email}`}
                  onChange={(role) => changeRole(r, role)}
                />
              ) : (
                <Tag>{humanizeStatus(v)}</Tag>
              ),
          },
          {
            title: "Status",
            dataIndex: "status",
            width: 150,
            render: (v: UserStatus, r) => (
              <Space size={4} wrap>
                <StatusTag status={v} looks={STATUS_LOOKS} />
                {isLastActiveAdmin(users, r.id) && <Tag color="gold">Last admin</Tag>}
              </Space>
            ),
          },
          {
            title: "MFA",
            dataIndex: "mfa_enrolled",
            width: 130,
            render: (v: boolean, r) =>
              v ? (
                <StatusTag status="enrolled" />
              ) : r.role === "viewer" ? (
                <StatusTag status="not_required" />
              ) : (
                <StatusTag status="not_enrolled" />
              ),
          },
          {
            title: "Last sign-in",
            dataIndex: "last_sign_in",
            width: 170,
            render: (v: string | null) => (v ? formatDateTime(v, timeZone) : "never"),
          },
          {
            title: "Actions",
            key: "actions",
            width: 90,
            align: "right" as const,
            render: (_, r) => {
              if (!canManage) return null;
              const menu: MenuProps["items"] = [];
              if (r.status !== "suspended" && r.status !== "offboarded") {
                menu.push({ key: "suspend", label: "Suspend", onClick: () => changeStatus(r, "suspended") });
              }
              if (r.status === "suspended" || r.status === "offboarded") {
                menu.push({ key: "reactivate", label: "Reactivate", onClick: () => changeStatus(r, "active") });
              }
              // Last, and separated — but only separated when there is
              // something to separate from: an offboarded user's menu holds
              // Reactivate alone, and a suspended user's opens with it.
              if (r.status !== "offboarded") {
                if (menu.length) menu.push({ type: "divider" as const, key: "before-offboard" });
                menu.push({
                  key: "offboard",
                  label: "Offboard",
                  danger: true,
                  onClick: () => changeStatus(r, "offboarded"),
                });
              }
              return menu.length ? (
                <RowActionsMenu items={menu} label={`Actions for ${r.email}`} />
              ) : null;
            },
          },
        ]}
      />

      {addExistingOpen && (
        <AddExistingUserModal
          adminAllowed={canBecomeAdmin(users, null)}
          onClose={() => setAddExistingOpen(false)}
          onDone={() => {
            setAddExistingOpen(false);
            router.refresh();
          }}
        />
      )}

      {createOpen && (
        <CreateUserModal
          adminAllowed={canBecomeAdmin(users, null)}
          onClose={() => setCreateOpen(false)}
          onDone={() => {
            setCreateOpen(false);
            router.refresh();
          }}
        />
      )}
    </Space>
  );
}

/**
 * A person who already signs in to OneBook, for another company, given a
 * place in this one. Add user would refuse their email: it always creates a
 * new sign-in. Their name and password stay as they are.
 */
function AddExistingUserModal({
  adminAllowed,
  onClose,
  onDone,
}: {
  adminAllowed: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const v = await form.validateFields();
    setSaving(true);
    setError(null);
    const res = await addExistingUserAction({ email: v.email, role: v.role });
    setSaving(false);
    if (res.ok) {
      message.success(`${v.email} can now open this company`);
      onDone();
    } else {
      setError(res.error ?? "Failed to add the account");
    }
  }

  return (
    <Modal title="Add an existing account" open onOk={submit} onCancel={onClose} confirmLoading={saving} okText="Add to this company">
      <Typography.Paragraph type="secondary">
        For someone who already signs in to OneBook for another company. They keep their password; this gives them a
        place in this company with the role you choose. It takes effect at once and is recorded in the audit log.
      </Typography.Paragraph>
      <Form form={form} layout="vertical" initialValues={{ role: "viewer" }}>
        <Form.Item
          name="email"
          label="Email they sign in with"
          rules={[
            { required: true, message: "Enter the email address" },
            { type: "email", message: "Enter a valid email" },
          ]}
        >
          <Input type="email" placeholder="person@ctyhp.vn" autoComplete="off" />
        </Form.Item>
        <Form.Item name="role" label="Role in this company" rules={[{ required: true, message: "Select a role" }]}>
          <Select options={roleOptions(adminAllowed)} />
        </Form.Item>
      </Form>
      {error ? <Alert type="error" showIcon message={error} /> : null}
    </Modal>
  );
}

function CreateUserModal({
  adminAllowed,
  onClose,
  onDone,
}: {
  adminAllowed: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  async function submit() {
    const v = await form.validateFields();
    setSaving(true);
    const res = await createUserAction({
      email: v.email,
      full_name: v.full_name ?? null,
      role: v.role,
      password: v.password,
    });
    setSaving(false);
    if (res.ok) {
      message.success("User account created");
      onDone();
    } else {
      message.error(res.error ?? "Failed to create the user");
    }
  }

  return (
    <Modal title="Add a user" open onOk={submit} onCancel={onClose} confirmLoading={saving} okText="Create account">
      <Typography.Paragraph type="secondary">
        Set the user&apos;s initial password and share the credentials through an approved secure channel. No email is sent.
      </Typography.Paragraph>
      <Form form={form} layout="vertical" initialValues={{ role: "viewer" }}>
        <Form.Item name="email" label="Email" rules={[{ required: true, message: "Enter an email" }]}>
          <Input type="email" placeholder="person@ctyhp.vn" />
        </Form.Item>
        <Form.Item name="full_name" label="Full name">
          <Input />
        </Form.Item>
        <Form.Item name="role" label="Role" rules={[{ required: true, message: "Select a role" }]}>
          <Select options={roleOptions(adminAllowed)} />
        </Form.Item>
        <Form.Item
          name="password"
          label="Initial password"
          // The Microsoft complexity standard — the same function the server
          // schema runs, so this form cannot promise what the action refuses.
          // Two of its rules read other fields, hence the dependencies.
          dependencies={["email", "full_name"]}
          extra="Microsoft standard: 8–256 characters, three of the four kinds (uppercase, lowercase, number, symbol), and no part of the person's name or account name."
          rules={[
            { required: true, message: "Enter a password" },
            ({ getFieldValue }) => ({
              validator(_, value: string) {
                if (!value) return Promise.resolve();
                const problems = passwordPolicyProblems(
                  value,
                  getFieldValue("email"),
                  getFieldValue("full_name"),
                );
                return problems.length
                  ? Promise.reject(new Error(problems[0]))
                  : Promise.resolve();
              },
            }),
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="confirm_password"
          label="Confirm password"
          dependencies={["password"]}
          rules={[
            { required: true, message: "Confirm the password" },
            ({ getFieldValue }) => ({
              validator(_, value) {
                return !value || getFieldValue("password") === value
                  ? Promise.resolve()
                  : Promise.reject(new Error("The passwords do not match"));
              },
            }),
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
