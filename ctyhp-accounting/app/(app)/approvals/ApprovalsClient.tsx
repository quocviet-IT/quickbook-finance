"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Card, Space, Table, Tag, Tooltip, Typography } from "antd";
import type { ApprovalPolicyRow, ApprovalRequestRow, ApprovalStatus } from "@/lib/db/types";
import { canDecide } from "@/lib/domain/access";
import { fromMinor } from "@/lib/domain/money";
import { approveRequestAction, cancelRequestAction, rejectRequestAction } from "./actions";

const STATUS_COLOR: Record<ApprovalStatus, string> = {
  pending: "gold",
  approved: "green",
  rejected: "red",
  cancelled: "default",
};

export default function ApprovalsClient({
  pending,
  history,
  policies,
  currentUserId,
  canDecideRequests,
  baseCurrency,
  baseDecimals,
}: {
  pending: ApprovalRequestRow[];
  history: ApprovalRequestRow[];
  policies: ApprovalPolicyRow[];
  currentUserId: string;
  canDecideRequests: boolean;
  baseCurrency: string;
  baseDecimals: number;
}) {
  const { message, modal } = App.useApp();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  const policyOf = (key: string) => policies.find((p) => p.action_key === key);
  const money = (m: number) =>
    `${fromMinor(m, baseDecimals).toLocaleString(undefined, { minimumFractionDigits: baseDecimals })} ${baseCurrency}`;

  /** The same rule the server enforces, used here only to explain the block. */
  function decision(req: ApprovalRequestRow) {
    return canDecide(
      {
        requestedBy: req.requested_by,
        requireSegregation: policyOf(req.action_key)?.require_segregation ?? true,
      },
      currentUserId,
    );
  }

  async function approve(req: ApprovalRequestRow) {
    modal.confirm({
      title: `Approve "${req.title}"?`,
      content: `Approving performs the action now, in your name. ${req.amount_minor ? money(req.amount_minor) : ""}`,
      okText: "Approve and execute",
      onOk: async () => {
        setBusy(req.id);
        const res = await approveRequestAction(req.id, { note: "Approved" });
        setBusy(null);
        if (res.ok) {
          message.success("Approved and executed");
          router.refresh();
        } else {
          message.error(res.error ?? "Failed to approve");
          throw new Error(res.error);
        }
      },
    });
  }

  async function reject(req: ApprovalRequestRow) {
    let note = "";
    modal.confirm({
      title: `Reject "${req.title}"?`,
      content: (
        <div>
          <Typography.Paragraph type="secondary">A note is required and is kept with the request.</Typography.Paragraph>
          <textarea aria-label="Rejection note" rows={3} style={{ width: "100%" }} onChange={(e) => { note = e.target.value; }} />
        </div>
      ),
      okButtonProps: { danger: true },
      okText: "Reject",
      onOk: async () => {
        if (!note.trim()) {
          message.error("A note is required");
          throw new Error("A note is required");
        }
        const res = await rejectRequestAction(req.id, { note: note.trim() });
        if (!res.ok) {
          message.error(res.error ?? "Failed to reject");
          throw new Error(res.error);
        }
        message.success("Rejected");
        router.refresh();
      },
    });
  }

  async function cancel(req: ApprovalRequestRow) {
    const res = await cancelRequestAction(req.id);
    if (res.ok) {
      message.success("Request cancelled");
      router.refresh();
    } else {
      message.error(res.error ?? "Failed to cancel");
    }
  }

  const commonColumns = [
    { title: "Request", dataIndex: "title" },
    { title: "Action", dataIndex: "action_key", render: (v: string) => <Tag>{v.replace(/_/g, " ")}</Tag> },
    {
      title: "Amount",
      dataIndex: "amount_minor",
      align: "right" as const,
      render: (v: number) => (v ? money(Number(v)) : "—"),
    },
    { title: "Reason", dataIndex: "reason" },
    { title: "Requested", dataIndex: "requested_at", render: (v: string) => v.slice(0, 16).replace("T", " ") },
  ];

  const enabledPolicies = policies.filter((p) => p.enabled);
  const nothingEverSubmitted = pending.length === 0 && history.length === 0;

  return (
    <Space direction="vertical" size="large" style={{ display: "flex" }}>
      {/* An empty queue has two very different causes; say which one it is
          instead of showing two blank grids. */}
      {nothingEverSubmitted && enabledPolicies.length === 0 && (
        <Alert
          type="info"
          showIcon
          message="No approval policy is enabled"
          description={
            <>
              Nothing needs approval yet, so this queue stays empty. Turn on a policy in{" "}
              <Link href="/settings/approvals">Settings → Approval policies</Link> to route an action
              here for a second person to authorize.
            </>
          }
        />
      )}
      {nothingEverSubmitted && enabledPolicies.length > 0 && (
        <Alert
          type="info"
          showIcon
          message="Nothing has been submitted yet"
          description={`${enabledPolicies.length} ${enabledPolicies.length === 1 ? "policy is" : "policies are"} enabled (${enabledPolicies
            .map((p) => p.label)
            .join(", ")}). A request appears here the moment someone performs one of those actions.`}
        />
      )}

      {!canDecideRequests && (
        <Alert
          type="info"
          showIcon
          message="You can submit requests but not decide them"
          description="Deciding an approval request needs the 'Approve or reject requests' permission."
        />
      )}

      <Card title={`Pending (${pending.length})`}>
        <Table<ApprovalRequestRow>
          rowKey="id"
          dataSource={pending}
          pagination={false}
          scroll={{ x: "max-content" }}
          locale={{ emptyText: "Nothing waiting for a decision" }}
          columns={[
            ...commonColumns,
            {
              title: "Actions",
              key: "actions",
              render: (_, r) => {
                const d = decision(r);
                const mine = r.requested_by === currentUserId;
                return (
                  <Space>
                    {canDecideRequests && (
                      <Tooltip title={d.ok ? "" : d.reason}>
                        <Button
                          size="small"
                          type="primary"
                          disabled={!d.ok}
                          loading={busy === r.id}
                          onClick={() => approve(r)}
                        >
                          Approve
                        </Button>
                      </Tooltip>
                    )}
                    {canDecideRequests && (
                      <Button size="small" danger onClick={() => reject(r)}>
                        Reject
                      </Button>
                    )}
                    {mine && (
                      <Button size="small" type="link" onClick={() => cancel(r)}>
                        Cancel
                      </Button>
                    )}
                  </Space>
                );
              },
            },
          ]}
        />
      </Card>

      <Card title="Decided">
        <Table<ApprovalRequestRow>
          rowKey="id"
          dataSource={history}
          pagination={{ pageSize: 20 }}
          scroll={{ x: "max-content" }}
          locale={{ emptyText: "No decisions yet" }}
          columns={[
            ...commonColumns,
            {
              title: "Status",
              dataIndex: "status",
              render: (v: ApprovalStatus) => <Tag color={STATUS_COLOR[v]}>{v}</Tag>,
            },
            { title: "Decided", dataIndex: "decided_at", render: (v: string | null) => (v ? v.slice(0, 16).replace("T", " ") : "—") },
            { title: "Note", dataIndex: "decision_note", render: (v: string | null) => v ?? "—" },
          ]}
        />
      </Card>
    </Space>
  );
}
