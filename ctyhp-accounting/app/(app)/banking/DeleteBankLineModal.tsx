"use client";
import { useState } from "react";
import { App, Alert, Input, Modal, Space } from "antd";
import { deleteBankTransactionAction } from "./actions";

export interface DeleteBankLineTarget {
  id: string;
  txnDate: string;
  description: string;
  amount: string;
}

export interface DeleteBankLineModalProps {
  target: DeleteBankLineTarget | null;
  onClose: () => void;
  onDeleted: () => void;
}

/**
 * Removing one bank line for good.
 *
 * A bank line is not a document and has no number, so deleting one leaves no
 * hole in a sequence — but it is still the only delete in this screen, and the
 * reason is kept in the audit log rather than thrown away. The database refuses
 * anything that is not `unmatched`; this dialog does not try to guess ahead of
 * it, it reports what it is told.
 */
export default function DeleteBankLineModal({
  target,
  onClose,
  onDeleted,
}: DeleteBankLineModalProps) {
  const { message } = App.useApp();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const close = () => {
    setReason("");
    onClose();
  };

  const confirm = async () => {
    if (!target) return;
    setBusy(true);
    const result = await deleteBankTransactionAction(target.id, reason);
    setBusy(false);
    if (!result.ok) {
      message.error(result.error ?? "Could not delete this line");
      return;
    }
    message.success("Bank transaction deleted");
    setReason("");
    onDeleted();
  };

  return (
    <Modal
      open={target !== null}
      title="Delete this bank transaction?"
      okText="Delete it"
      okButtonProps={{ danger: true, loading: busy, disabled: reason.trim().length < 10 }}
      onOk={confirm}
      onCancel={close}
    >
      <Space direction="vertical" size="small" style={{ width: "100%" }}>
        <div>
          <b>{target?.txnDate}</b> · {target?.description} · {target?.amount}
        </div>
        <Alert
          type="warning"
          showIcon
          message="This cannot be undone"
          description="The line is removed from the bank register. Nothing in the ledger changes — an unmatched line has not been posted — and the deletion is recorded in the audit log."
        />
        <Input.TextArea
          rows={2}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Why is this line being deleted? A sentence, at least."
        />
      </Space>
    </Modal>
  );
}
