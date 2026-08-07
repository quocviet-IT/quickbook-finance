"use client";
import { useState } from "react";
import { Alert, App, Input, Modal, Space, Typography } from "antd";
import type { PaymentListRow } from "./PaymentsClient";
import { deletePaymentAction } from "./actions";

export interface DeletePaymentModalProps {
  payment: PaymentListRow | null;
  onClose: () => void;
  onDeleted: () => void;
}

/**
 * Deleting a receipt, and saying plainly what that does.
 *
 * The person asking for this was clear that void and delete are different
 * things. They are — but the accounting is the same either way: whatever the
 * receipt took from an invoice goes back first, and every rule that refuses a
 * void refuses this too. What differs is that the row then goes.
 */
export default function DeletePaymentModal({
  payment,
  onClose,
  onDeleted,
}: DeletePaymentModalProps) {
  const { message } = App.useApp();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (!payment) return;
    setBusy(true);
    const result = await deletePaymentAction(payment.id, reason);
    setBusy(false);
    if (!result.ok) {
      message.error(result.error ?? "Could not delete that payment");
      return;
    }
    message.success(`${result.data?.paymentNumber ?? "The payment"} was deleted`);
    setReason("");
    onDeleted();
  };

  return (
    <Modal
      open={Boolean(payment)}
      title={`Delete ${payment?.payment_number ?? "this payment"}?`}
      okText="Delete permanently"
      okButtonProps={{ danger: true, disabled: reason.trim().length < 10 }}
      confirmLoading={busy}
      onOk={confirm}
      onCancel={() => {
        setReason("");
        onClose();
      }}
      destroyOnHidden
    >
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Alert
          type="warning"
          showIcon
          message="This removes the receipt from the list for good"
          description={
            payment?.status === "void"
              ? "The record and its void entry are removed. Voiding it kept the details; this does not."
              : "It is voided first — the invoices it paid get their balances back — and then the record is removed. Voiding alone would keep the details; this does not."
          }
        />
        <Typography.Text type="secondary">
          The receipt number is written to the document number report so the sequence still adds
          up, and the audit log keeps what was deleted and who deleted it. Everything else about
          this receipt is gone.
        </Typography.Text>
        <Input.TextArea
          rows={2}
          maxLength={500}
          placeholder="Demo data entered while testing"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          At least 10 characters — this becomes the note explaining the missing receipt number.
        </Typography.Text>
      </Space>
    </Modal>
  );
}
