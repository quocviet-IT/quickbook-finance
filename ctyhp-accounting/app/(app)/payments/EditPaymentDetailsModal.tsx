"use client";
import { useState } from "react";
import { App, Form, Input, Modal, Select, Typography } from "antd";
import type { PaymentRow } from "@/lib/db/types";
import { updatePaymentDetailsAction } from "./actions";

export interface EditPaymentDetailsModalProps {
  payment: (PaymentRow & { customer_name: string }) | null;
  onClose: () => void;
  onDone: () => void;
}

/**
 * The description of a receipt, and nothing else. A wrong check number is a
 * typing mistake, not an accounting event — fixing it must not disturb a
 * balance, so the amount, date, customer and allocations are not on this form.
 */
export default function EditPaymentDetailsModal({
  payment,
  onClose,
  onDone,
}: EditPaymentDetailsModalProps) {
  const { message } = App.useApp();
  const [form] = Form.useForm<{
    method?: string | null;
    reference?: string | null;
    memo?: string | null;
  }>();
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!payment) return;
    const values = await form.validateFields();
    setSaving(true);
    try {
      const result = await updatePaymentDetailsAction({ payment_id: payment.id, ...values });
      if (!result.ok) {
        message.error(result.error ?? "Failed to save the payment details");
        return;
      }
      message.success("Payment details saved");
      onDone();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Edit details · ${payment?.payment_number ?? "payment"}`}
      open={!!payment}
      onOk={submit}
      onCancel={onClose}
      confirmLoading={saving}
      okText="Save details"
      cancelText="Cancel"
      width={520}
      destroyOnHidden
    >
      {payment ? (
        <>
          <Typography.Paragraph type="secondary">
            Only the description changes. To change the amount, date, customer or which invoices
            this receipt settled, use Correct payment.
          </Typography.Paragraph>
          <Form
            form={form}
            layout="vertical"
            requiredMark={false}
            initialValues={{
              method: payment.method ?? undefined,
              reference: payment.reference ?? undefined,
              memo: payment.memo ?? undefined,
            }}
          >
            <Form.Item name="method" label="Method">
              <Select
                allowClear
                placeholder="Method"
                options={["cash", "bank_transfer", "card", "check"].map((m) => ({
                  value: m,
                  label: m,
                }))}
              />
            </Form.Item>
            <Form.Item
              name="reference"
              label="Reference"
              rules={[{ max: 80, message: "Reference cannot exceed 80 characters" }]}
              tooltip="Check number, wire reference or ACH trace — what the bank statement will show"
            >
              <Input placeholder="Check / wire ref" maxLength={80} />
            </Form.Item>
            <Form.Item
              name="memo"
              label="Memo"
              rules={[{ max: 500, message: "Memo cannot exceed 500 characters" }]}
            >
              <Input.TextArea rows={3} maxLength={500} showCount />
            </Form.Item>
          </Form>
        </>
      ) : null}
    </Modal>
  );
}
