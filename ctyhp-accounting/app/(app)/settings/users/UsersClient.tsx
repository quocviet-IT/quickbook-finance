"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Dropdown, Form, Input, Modal, Select, Space, Table, Tag, Tooltip, Typography } from "antd";
import type { MenuProps } from "antd";
import { MoreOutlined, PlusOutlined } from "@ant-design/icons";
import FilterBar from "@/components/ui/FilterBar";
import type { AppRole, AppUserRow, UserStatus } from "@/lib/db/types";
import { describeStatusChange, isLastActiveAdmin } from "@/lib/domain/access";
import { passwordPolicyProblems } from "@/lib/domain/password-policy";
import { createUserAction, setUserRoleAction, setUserStatusAction } from "./actions";
import { longTextColumn } from "@/components/ui/long-text-column";

const STATUS_COLOR: Record<UserStatus, string> = {
  invited: "blue",
  active: "green",
  suspended: "orange",
  offboarded: "red",
};

const STATUS_LABEL: Record<UserStatus, string> = {
  invited: "Pending",
  active: "Active",
  suspended: "Suspended",
  offboarded: "Offboarded",
};

const ROLE_OPTIONS: { value: AppRole; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "accountant", label: "Accountant" },
  { value: "sales", label: "Sales" },
  { value: "viewer", label: "Viewer" },
];

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
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);

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
        description="Admins, accountants and sales users are privileged users: they must enrol multi-factor authentication with the identity provider, and the MFA column below is how that policy is checked. Sales users cannot post to the ledger, but the prices they maintain decide what a customer is billed. Suspending or offboarding a user revokes read and write access immediately across the whole application. The last remaining active admin cannot be demoted or suspended."
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
          ) : null
        }
      />

      <Table<AppUserRow>
        rowKey="id"
        dataSource={users}
        pagination={false}
        scroll={{ x: "max-content" }}
        locale={{ emptyText: "No users yet" }}
        columns={[
          {
            title: "Email",
            dataIndex: "email",
            render: (v: string, r) => (
              <Space>
                {v}
                {r.id === currentUserId && <Tag>you</Tag>}
              </Space>
            ),
          },
          { title: "Name", dataIndex: "full_name", render: (v: string) => v || "—" },
          {
            title: "Role",
            dataIndex: "role",
            render: (v: AppRole, r) =>
              canManage ? (
                <Select
                  value={v}
                  style={{ width: 150 }}
                  options={ROLE_OPTIONS}
                  aria-label={`Role for ${r.email}`}
                  onChange={(role) => changeRole(r, role)}
                />
              ) : (
                <Tag>{v}</Tag>
              ),
          },
          {
            title: "Status",
            dataIndex: "status",
            render: (v: UserStatus, r) => (
              <Space>
                <Tag color={STATUS_COLOR[v]}>{STATUS_LABEL[v]}</Tag>
                {isLastActiveAdmin(users, r.id) && <Tag color="gold">last admin</Tag>}
              </Space>
            ),
          },
          {
            title: "MFA",
            dataIndex: "mfa_enrolled",
            render: (v: boolean, r) =>
              v ? (
                <Tag color="green">enrolled</Tag>
              ) : r.role === "viewer" ? (
                <Tag>not required</Tag>
              ) : (
                <Tag color="orange">not enrolled</Tag>
              ),
          },
          {
            title: "Last sign-in",
            dataIndex: "last_sign_in",
            render: (v: string | null) => (v ? v.slice(0, 16).replace("T", " ") : "never"),
          },
          { title: "Reason", dataIndex: "status_reason", ...longTextColumn() },
          {
            title: "Actions",
            key: "actions",
            width: 90,
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
                <Dropdown menu={{ items: menu, style: { minWidth: 148 } }} trigger={["click"]}>
                  <Button size="small" icon={<MoreOutlined />} aria-label={`Actions for ${r.email}`} />
                </Dropdown>
              ) : null;
            },
          },
        ]}
      />

      {createOpen && (
        <CreateUserModal
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

function CreateUserModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
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
          <Select options={ROLE_OPTIONS} />
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
