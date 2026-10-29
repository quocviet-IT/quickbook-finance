"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Button, InputNumber, Space, Switch, Table, Tag, Tooltip, Typography } from "antd";
import type { ApprovalPolicyRow } from "@/lib/db/types";
import { CONTROLLED_ACTIONS } from "@/lib/domain/access";
import {
  approvalPolicyDraft,
  approvalPolicyStatus,
  changedApprovalPolicies,
  thresholdMinor,
  type ApprovalPolicyDraft,
} from "@/lib/domain/approval-policy-draft";
import { plural } from "@/lib/format";
import { useUnsavedGuard } from "@/lib/client/use-unsaved-guard";
import FormActions from "@/components/ui/FormActions";
import { setApprovalPolicyAction } from "../permissions/actions";

function usesThreshold(actionKey: string): boolean {
  return CONTROLLED_ACTIONS.find((a) => a.key === actionKey)?.usesThreshold ?? true;
}

/**
 * The approval policies, edited as one form: change any rows, then Save
 * changes under the table saves every row that changed.
 *
 * It saved one row at a time, from a floppy-disk icon at the end of each row
 * with no word on it. The UI review of 2026-10-19 asked for the Save button
 * where every other settings form keeps it, under the form, with its name on it.
 */
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
  const { message, modal } = App.useApp();
  const router = useRouter();
  const savedDrafts = () =>
    Object.fromEntries(policies.map((p) => [p.action_key, approvalPolicyDraft(p, baseDecimals)]));
  const [drafts, setDrafts] = useState<Record<string, ApprovalPolicyDraft>>(savedDrafts);
  const [saving, setSaving] = useState(false);

  const changed = changedApprovalPolicies(policies, drafts, baseDecimals, usesThreshold);
  const changedKeys = new Set(changed.map((p) => p.action_key));
  useUnsavedGuard(changed.length > 0, modal, "these approval policies");

  async function saveChanges() {
    setSaving(true);
    const failed: string[] = [];
    for (const policy of changed) {
      const d = drafts[policy.action_key];
      const res = await setApprovalPolicyAction({
        action_key: policy.action_key,
        enabled: d.enabled,
        threshold_minor: usesThreshold(policy.action_key) ? thresholdMinor(d, baseDecimals) : 0,
        require_segregation: d.requireSegregation,
      });
      if (!res.ok) failed.push(`${policy.label}: ${res.error ?? "not saved"}`);
    }
    setSaving(false);
    const saved = changed.length - failed.length;
    if (saved > 0) router.refresh();
    if (failed.length === 0) {
      message.success(`Saved ${plural(saved, "policy", "policies")}`);
    } else {
      message.error(
        `${plural(failed.length, "policy", "policies")} not saved. ${failed.join(" · ")}`,
      );
    }
  }

  function discardChanges() {
    setDrafts(savedDrafts());
  }

  function patch(key: string, part: Partial<ApprovalPolicyDraft>) {
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
        message={approvalPolicyStatus(policies)}
        description="At or above the threshold, the action goes for approval and runs when approved. With segregation of duties on, nobody approves their own request. A new company starts with every policy off."
      />
      <div>
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
                  <Space size={8}>
                    <Typography.Text strong>{v}</Typography.Text>
                    {changedKeys.has(r.action_key) ? <Tag color="gold">Unsaved</Tag> : null}
                  </Space>
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
                  disabled={!canManage || saving}
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
                    disabled={!canManage || saving}
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
                  disabled={!canManage || saving}
                  aria-label={`Segregation of duties for ${r.label}`}
                  onChange={(v) => patch(r.action_key, { requireSegregation: v })}
                />
              ),
            },
          ]}
        />
        {canManage ? (
          <FormActions
            note={
              changed.length
                ? `${plural(changed.length, "unsaved change")}, marked in the table`
                : "No unsaved changes"
            }
          >
            <Button type="primary" loading={saving} disabled={changed.length === 0} onClick={() => void saveChanges()}>
              Save changes
            </Button>
            <Button disabled={changed.length === 0 || saving} onClick={discardChanges}>
              Discard changes
            </Button>
          </FormActions>
        ) : (
          <FormActions note="Only an admin can change these policies." />
        )}
      </div>
    </Space>
  );
}
