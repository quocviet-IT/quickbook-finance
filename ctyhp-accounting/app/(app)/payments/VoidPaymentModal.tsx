"use client";
import { useEffect, useState } from "react";
import { App, Alert, Descriptions, Form, Input, Modal } from "antd";
import type { PaymentRow } from "@/lib/db/types";
import { formatMoney } from "@/lib/format";
import { voidPaymentAction } from "./actions";

export interface VoidPaymentModalProps {
  payment: (PaymentRow & { customer_name: string }) | null;
  decimalsOf: (currencyCode: string) => number;
  onClose: () => void;
  onDone: () => void;
}

/**
 * Voiding a receipt is not deleting it.
 *
 * The number, the allocations and the journal entry all stay readable; what
 * changes is that the money goes back onto the customer's invoices. That is a
 * consequence worth spelling out before anyone confirms, which is why this
 * modal states it and requires a reason rather than a click.
 */
export default function VoidPaymentModal({
  payment,
  decimalsOf,
  onClose,
  onDone,
}: VoidPaymentModalProps) {
  const { message } = App.useApp();
  const [form] = Form.useForm<{ reason: string }>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (payment) form.resetFields();
  }, [payment, form]);

  async function submit() {
    if (!payment) return;
    const { reason } = await form.validateFields();
    setSaving(true);
    try {
      const result = await voidPaymentAction(payment.id, reason);
      if (!result.ok) {
        message.error(result.error ?? "Failed to void payment");
        return;
      }
      message.success("Payment voided; invoice balances were restored");
      onDone();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Void payment"
      open={!!payment}
      onOk={submit}
      onCancel={onClose}
      confirmLoading={saving}
      okText="Void payment"
      okButtonProps={{ danger: true }}
      cancelText="Cancel"
      width={560}
      destroyOnHidden
    >
      {payment ? (
        <>
          <Descriptions size="small" column={1} bordered style={{ marginBottom: 12 }}>
            <Descriptions.Item label="Payment">{payment.payment_number ?? "(unnumbered)"}</Descriptions.Item>
            <Descriptions.Item label="Customer">{payment.customer_name}</Descriptions.Item>
            <Descriptions.Item label="Amount">
              {formatMoney(
                payment.amount_minor,
                payment.currency_code,
                decimalsOf(payment.currency_code),
              )}
            </Descriptions.Item>
          </Descriptions>
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message="What voiding does"
            description="Every invoice this payment settled goes back to outstanding, and the journal entry stops counting in the ledger. The payment, its number and its history stay on record — a void cannot be undone, so correcting it means recording a replacement payment."
          />
          <Form form={form} layout="vertical" requiredMark={false}>
            <Form.Item
              name="reason"
              label="Reason"
              rules={[
                { required: true, message: "Explain why this payment is being voided" },
                { max: 500, message: "A void reason cannot exceed 500 characters" },
              ]}
            >
              <Input.TextArea
                rows={3}
                maxLength={500}
                showCount
                placeholder="Entered twice — duplicate of CP-0104"
              />
            </Form.Item>
          </Form>
        </>
      ) : null}
    </Modal>
  );
}
