"use client";
import { useState } from "react";
import { App, Alert, Input, Modal, Space } from "antd";
import { deleteBankTransactionAction } from "./actions";
import type { BankTransactionDeleteEligibility } from "@/lib/domain/bank-transaction-delete";

export interface DeleteBankLineTarget {
  id: string;
  txnDate: string;
  description: string;
  amount: string;
  /** Computed by the table when the control was clicked — see
   *  lib/domain/bank-transaction-delete.ts. Only "delete_only" and
   *  "void_then_delete" ever reach here; a "blocked" row's control is
   *  disabled rather than wired to open this dialog. */
  eligibility: BankTransactionDeleteEligibility;
}

export interface DeleteBankLineModalProps {
  target: DeleteBankLineTarget | null;
  onClose: () => void;
  onDeleted: () => void;
}

/**
 * Removing one bank line for good — and, when the line was categorised,
 * taking back the journal entry categorising it posted, first.
 *
 * Correction to RQ-06, 2026-08-17: a Delete that only ever worked on an
 * `unmatched` row was invisible on every row for the company that asked for
 * it, because categorising posts a journal entry and every one of theirs had
 * been categorised. One confirmed click now does both steps when a row needs
 * both — void, then delete — and this dialog names both effects before
 * either happens, with the entry's own number when one is known. Both steps
 * run inside one database transaction (migration 0114), so the two effects
 * named here either both happen or neither does; what actually runs is
 * documented on `deleteBankTransactionWithVoid` in lib/services/banking.ts.
 */
export default function DeleteBankLineModal({
  target,
  onClose,
  onDeleted,
}: DeleteBankLineModalProps) {
  const { message } = App.useApp();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const willVoid = target?.eligibility.kind === "void_then_delete";
  const entryNumber = target?.eligibility.kind === "void_then_delete" ? target.eligibility.entryNumber : null;

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
    message.success(
      willVoid
        ? `Voided ${entryNumber ?? "the journal entry"} and deleted the bank transaction`
        : "Bank transaction deleted",
    );
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
          description={
            willVoid
              ? `This voids ${entryNumber ?? "the journal entry"} this line posted, and removes ` +
                "the line from the bank register. Both steps are recorded in the audit log."
              : "The line is removed from the bank register. Nothing in the ledger changes — an " +
                "unmatched line has not been posted — and the deletion is recorded in the audit log."
          }
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
