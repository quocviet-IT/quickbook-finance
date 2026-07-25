"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Form, Input, Modal, Select, Space, Table, Tag, Tooltip, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import FilterBar from "@/components/ui/FilterBar";
import type { AppRole, AppUserRow, UserStatus } from "@/lib/db/types";
import { describeStatusChange, isLastActiveAdmin } from "@/lib/domain/access";
import { inviteUserAction, setUserRoleAction, setUserStatusAction } from "./actions";

const STATUS_COLOR: Record<UserStatus, string> = {
  invited: "blue",
  active: "green",
  suspended: "orange",
  offboarded: "red",
};

const STATUS_LABEL: Record<UserStatus, string> = {
  invited: "Password setup pending",
  active: "Active",
  suspended: "Suspended",
  offboarded: "Offboarded",
};

const ROLE_OPTIONS: { value: AppRole; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "accountant", label: "Accountant" },
  { value: "viewer", label: "Viewer" },
];

export default function UsersClient({
  users,
  currentUserId,
  canManage,
  canInvite,
}: {
  users: AppUserRow[];
  currentUserId: string;
  canManage: boolean;
  /** Account creation goes through the Auth admin API, which needs the service-role key. */
  canInvite: boolean;
}) {
  const { message, modal } = App.useApp();
  const router = useRouter();
  const [inviteOpen, setInviteOpen] = useState(false);

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
        description="Admins and accountants are privileged users: they must enrol multi-factor authentication with the identity provider, and the MFA column below is how that policy is checked. Suspending or offboarding a user revokes read and write access immediately across the whole application. The last remaining active admin cannot be demoted or suspended."
      />

      {canManage && !canInvite && (
        <Alert
          type="warning"
          showIcon
          message="User creation is not configured"
          description="Creating a user and sending their password setup email needs SUPABASE_SERVICE_ROLE_KEY in the server environment."
        />
      )}

      <FilterBar
        resultCount={users.length}
        actions={
          canManage ? (
            <Tooltip title={canInvite ? "" : "Set SUPABASE_SERVICE_ROLE_KEY to create users"}>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                disabled={!canInvite}
                onClick={() => setInviteOpen(true)}
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
          { title: "Reason", dataIndex: "status_reason", render: (v: string | null) => v ?? "—" },
          {
            title: "Actions",
            key: "actions",
            render: (_, r) =>
              canManage ? (
                <Space>
                  {r.status !== "suspended" && r.status !== "offboarded" && (
                    <Button size="small" type="link" onClick={() => changeStatus(r, "suspended")}>
                      Suspend
                    </Button>
                  )}
                  {(r.status === "suspended" || r.status === "offboarded") && (
                    <Button size="small" type="link" onClick={() => changeStatus(r, "active")}>
                      Reactivate
                    </Button>
                  )}
                  {r.status !== "offboarded" && (
                    <Button size="small" type="link" danger onClick={() => changeStatus(r, "offboarded")}>
                      Offboard
                    </Button>
                  )}
                </Space>
              ) : null,
          },
        ]}
      />

      {inviteOpen && (
        <InviteModal
          onClose={() => setInviteOpen(false)}
          onDone={() => {
            setInviteOpen(false);
            router.refresh();
          }}
        />
      )}
    </Space>
  );
}

function InviteModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  async function submit() {
    const v = await form.validateFields();
    setSaving(true);
    const res = await inviteUserAction({ email: v.email, full_name: v.full_name ?? null, role: v.role });
    setSaving(false);
    if (res.ok) {
      message.success("User created and password setup email sent");
      onDone();
    } else {
      message.error(res.error ?? "Failed to create the user");
    }
  }

  return (
    <Modal title="Add a user" open onOk={submit} onCancel={onClose} confirmLoading={saving} okText="Create and send email">
      <Typography.Paragraph type="secondary">
        The account is created without a password. The user receives a secure email link to create their password.
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
      </Form>
    </Modal>
  );
}
