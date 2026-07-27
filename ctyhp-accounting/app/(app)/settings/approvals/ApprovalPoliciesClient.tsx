"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, InputNumber, Space, Switch, Table, Tooltip, Typography } from "antd";
import { SaveOutlined } from "@ant-design/icons";
import type { ApprovalPolicyRow } from "@/lib/db/types";
import { CONTROLLED_ACTIONS } from "@/lib/domain/access";
import IconActionButton from "@/components/ui/IconActionButton";
import { setApprovalPolicyAction } from "../permissions/actions";

interface Draft {
  enabled: boolean;
  thresholdMajor: number;
  requireSegregation: boolean;
}

export default function ApprovalPoliciesClient({
  policies,
  approverCount,
  baseCurrency,
  baseDecimals,
  canManage,
}: {
  policies: ApprovalPolicyRow[];
  /** People who hold `approval.decide`; below two, segregation blocks everyone. */
  approverCount: number;
  baseCurrency: string;
  baseDecimals: number;
  canManage: boolean;
}) {
  const { message } = App.useApp();
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(
      policies.map((p) => [
        p.action_key,
        {
          enabled: p.enabled,
          thresholdMajor: p.threshold_minor / 10 ** baseDecimals,
          requireSegregation: p.require_segregation,
        },
      ]),
    ),
  );
  const [saving, setSaving] = useState<string | null>(null);

  function usesThreshold(actionKey: string): boolean {
    return CONTROLLED_ACTIONS.find((a) => a.key === actionKey)?.usesThreshold ?? true;
  }

  async function save(policy: ApprovalPolicyRow) {
    const d = drafts[policy.action_key];
    setSaving(policy.action_key);
    const res = await setApprovalPolicyAction({
      action_key: policy.action_key,
      enabled: d.enabled,
      threshold_minor: usesThreshold(policy.action_key)
        ? Math.round((d.thresholdMajor ?? 0) * 10 ** baseDecimals)
        : 0,
      require_segregation: d.requireSegregation,
    });
    setSaving(null);
    if (res.ok) {
      message.success("Policy saved");
      router.refresh();
    } else {
      message.error(res.error ?? "Failed to save the policy");
    }
  }

  function patch(key: string, part: Partial<Draft>) {
    setDrafts((d) => ({ ...d, [key]: { ...d[key], ...part } }));
  }

  return (
    <Space direction="vertical" size="large" style={{ display: "flex" }}>
      {/* The deadlock this warns about is real: one approver plus segregation
          means nobody can ever sign off, so the action is blocked for everyone. */}
      {approverCount < 2 && (
        <Alert
          type="warning"
          showIcon
          message={
            approverCount === 0
              ? "Nobody can approve requests"
              : "Only one person can approve requests"
          }
          description={
            approverCount === 0
              ? "No active user holds the 'Approve or reject requests' permission. Enabling any policy below would block its action for everyone. Grant the permission in Settings → Permissions first."
              : "Segregation of duties stops the requester approving their own request, so with a single approver an enabled policy blocks its action for everyone — including that approver. Either add a second person who can approve, or turn segregation off for the policies you enable."
          }
        />
      )}

      <Alert
        type="info"
        showIcon
        message="How a policy behaves once enabled"
        description="At or above the threshold, the action can no longer be performed directly — it must be submitted for approval and is executed by whoever approves it. With segregation of duties on, the person who submitted a request can never be the one who approves it. Every policy starts disabled, so nothing changes until you turn one on."
      />
      <Table<ApprovalPolicyRow>
        rowKey="action_key"
        dataSource={policies}
        pagination={false}
        scroll={{ x: "max-content" }}
        columns={[
          {
            title: "Controlled action",
            dataIndex: "label",
            render: (v: string, r) => (
              <Space direction="vertical" size={0}>
                <Typography.Text strong>{v}</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {r.description}
                </Typography.Text>
              </Space>
            ),
          },
          {
            title: "Approval required",
            key: "enabled",
            render: (_, r) => (
              <Switch
                checked={drafts[r.action_key]?.enabled}
                disabled={!canManage}
                aria-label={`Require approval for ${r.label}`}
                onChange={(v) => patch(r.action_key, { enabled: v })}
              />
            ),
          },
          {
            title: `Threshold (${baseCurrency})`,
            key: "threshold",
            align: "right",
            render: (_, r) =>
              usesThreshold(r.action_key) ? (
                <InputNumber
                  min={0}
                  precision={baseDecimals}
                  value={drafts[r.action_key]?.thresholdMajor}
                  disabled={!canManage}
                  aria-label={`Threshold for ${r.label}`}
                  onChange={(v) => patch(r.action_key, { thresholdMajor: Number(v ?? 0) })}
                />
              ) : (
                <Tooltip title="This action has no amount; the policy is simply on or off.">
                  <Typography.Text type="secondary">n/a</Typography.Text>
                </Tooltip>
              ),
          },
          {
            title: "Segregation of duties",
            key: "segregation",
            render: (_, r) => (
              <Switch
                checked={drafts[r.action_key]?.requireSegregation}
                disabled={!canManage}
                aria-label={`Segregation of duties for ${r.label}`}
                onChange={(v) => patch(r.action_key, { requireSegregation: v })}
              />
            ),
          },
          {
            title: "",
            key: "save",
            render: (_, r) =>
              canManage ? (
                <IconActionButton
                  label={`Save ${r.label} approval policy`}
                  icon={<SaveOutlined />}
                  loading={saving === r.action_key}
                  onClick={() => save(r)}
                />
              ) : null,
          },
        ]}
      />
    </Space>
  );
}
