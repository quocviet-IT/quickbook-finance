"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Card, Form, Input, InputNumber, Space } from "antd";
import FormActions from "@/components/ui/FormActions";
import type { WorkPolicy } from "@/lib/domain/accounting-dashboard/policy";
import { fromMinor, toMinor } from "@/lib/domain/money";
import { saveWorkPolicyAction } from "./actions";

/**
 * Where a company says what it means by urgent and by late.
 *
 * Every field can be left empty, and empty is a real answer that the screen
 * says out loud: the rule that needed it stays asleep rather than judging by a
 * number nobody chose. That is the whole reason this page exists — the
 * dashboard refused to invent these, and this is where they stop being
 * invented and start being decided.
 */
export default function WorkPolicyClient({
  policy,
  baseCurrency,
  baseDecimals,
  canManage,
}: {
  policy: WorkPolicy;
  baseCurrency: string;
  baseDecimals: number;
  canManage: boolean;
}) {
  const { message } = App.useApp();
  const router = useRouter();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  async function submit() {
    const values = await form.validateFields();
    setSaving(true);
    const result = await saveWorkPolicyAction({
      materialityMinor:
        values.materiality === null || values.materiality === undefined
          ? null
          : toMinor(values.materiality, baseDecimals),
      approvalSlaDays: values.approvalSlaDays ?? null,
      unmatchedBankAgeDays: values.unmatchedBankAgeDays ?? null,
      closeWindowDays: values.closeWindowDays ?? null,
      note: values.note ?? null,
    });
    setSaving(false);
    if (result.ok) {
      message.success("Work policy saved");
      router.refresh();
    } else {
      message.error(result.error ?? "Could not save the policy");
    }
  }

  const unset = [
    policy.materialityMinor === null ? "a materiality threshold" : null,
    policy.approvalSlaDays === null ? "a time limit for approvals" : null,
    policy.unmatchedBankAgeDays === null ? "how long a bank line may stay unmatched" : null,
    policy.closeWindowDays === null ? "when to start closing a period" : null,
  ].filter(Boolean) as string[];

  return (
    <Space direction="vertical" size="large" style={{ display: "flex" }}>
      {unset.length > 0 ? (
        <Alert
          type="info"
          showIcon
          message="Some dashboard alerts are off"
          description={
            <>
              This company has not set {unset.join(", ")}. The dashboard alerts that need those
              numbers stay off until they are set. Leaving a field empty is a fine answer: it only
              means those alerts stay quiet.
            </>
          }
        />
      ) : null}

      <Card size="small" title="What this company means by urgent, and by late">
        <Form
          form={form}
          layout="vertical"
          disabled={!canManage}
          initialValues={{
            materiality:
              policy.materialityMinor === null
                ? null
                : fromMinor(policy.materialityMinor, baseDecimals),
            approvalSlaDays: policy.approvalSlaDays,
            unmatchedBankAgeDays: policy.unmatchedBankAgeDays,
            closeWindowDays: policy.closeWindowDays,
          }}
        >
          <Form.Item
            name="materiality"
            label={`Materiality threshold (${baseCurrency})`}
            extra="A change smaller than this is not raised as something to look at. Leave empty to be told about every change."
          >
            <InputNumber min={0} precision={baseDecimals} style={{ width: 260 }} placeholder="Not set" />
          </Form.Item>

          <Form.Item
            name="approvalSlaDays"
            label="Days an approval may wait"
            extra="After this many days a waiting approval is reported as late. Zero means any wait at all is late."
          >
            <InputNumber min={0} precision={0} style={{ width: 260 }} placeholder="Not set" />
          </Form.Item>

          <Form.Item
            name="unmatchedBankAgeDays"
            label="Days a bank line may stay unmatched"
            extra="After this many days an unmatched bank line is reported as late."
          >
            <InputNumber min={0} precision={0} style={{ width: 260 }} placeholder="Not set" />
          </Form.Item>

          <Form.Item
            name="closeWindowDays"
            label="Days before a period ends to start closing it"
            extra="Inside this many days of a period end, the accounting screen suggests switching to close mode. A period already open past its end date is suggested regardless — that needs no policy."
          >
            <InputNumber min={0} precision={0} style={{ width: 260 }} placeholder="Not set" />
          </Form.Item>

          <Form.Item name="note" label="Why (optional)">
            <Input.TextArea rows={2} placeholder="Agreed with the auditors, March review" />
          </Form.Item>

          {canManage ? (
            <FormActions>
              <Button type="primary" loading={saving} onClick={() => void submit()}>
                Save the policy
              </Button>
            </FormActions>
          ) : (
            <FormActions note="Only an admin can change this. What is set here decides what every accountant in the company is told is urgent." />
          )}
        </Form>
      </Card>
    </Space>
  );
}
