"use client";
import { formatDate } from "@/lib/format";
import { useEffect, useState } from "react";
import { App, Alert, Button, Input, Modal, Space, Spin, Typography } from "antd";
import {
  bankLineDeleteStateAction,
  deleteBankTransactionAction,
  uncategoriseBankTransactionAction,
  unmatchBankTransactionAction,
} from "./actions";
import {
  DELETE_DIALOG,
  deleteStep,
  reasonIsEnough,
  type BankLineDeleteState,
} from "@/lib/domain/bank-transaction-delete";
import { serverFailure } from "@/lib/domain/statement-evidence";

export interface DeleteBankLineTarget {
  id: string;
  txnDate: string;
  description: string;
  amount: string;
}

export interface DeleteBankLineModalProps {
  target: DeleteBankLineTarget | null;
  onClose: () => void;
  /** The line is gone from the register. */
  onDeleted: () => void;
  /** The line changed but stays: its entry voided, or its match taken back. */
  onChanged: () => void;
}

/** How the line stood when it was last asked about. */
interface Read {
  id: string;
  state: BankLineDeleteState | null;
  error: string | null;
}

/**
 * Deleting one bank line, or the way out when it is not deleted (3.0.23).
 *
 * The dialog asks the database how the line stands as it opens
 * (acc_bank_line_delete_state). A line that is unposted, unmatched and
 * unreconciled is deleted with a reason, and the whole line is kept in the
 * audit log. Any other line is refused in the database's own words, with the
 * way out beside it: Void its entry (posted here), Unmatch (matched to an entry
 * posted elsewhere), or the reconciliation to reopen (reconciled). After a void
 * or an unmatch the dialog asks again, so a duplicate can then be deleted
 * without starting over. Nothing is deleted on the way to anything else.
 */
export default function DeleteBankLineModal({ target, onClose, onDeleted, onChanged }: DeleteBankLineModalProps) {
  const { message } = App.useApp();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [read, setRead] = useState<Read | null>(null);

  const ask = (id: string, live: () => boolean = () => true) =>
    bankLineDeleteStateAction(id)
      .then((res) => {
        if (!live()) return;
        setRead(
          res.ok && res.data
            ? { id, state: res.data, error: null }
            : { id, state: null, error: res.error ?? serverFailure(null) },
        );
      })
      .catch((error: unknown) => {
        if (live()) setRead({ id, state: null, error: serverFailure(error) });
      });

  const targetId = target?.id ?? null;
  useEffect(() => {
    if (!targetId) return;
    let live = true;
    void ask(targetId, () => live);
    return () => {
      live = false;
    };
  }, [targetId]);

  const here = read && read.id === targetId ? read : null;
  const state = here?.state ?? null;
  const step = state ? deleteStep(state) : null;
  const needsReason = step?.kind === "delete" || step?.kind === "void" || step?.kind === "unmatch";

  const close = () => {
    setReason("");
    setRead(null);
    onClose();
  };

  async function act() {
    if (!target || !step || busy || !reasonIsEnough(reason)) return;
    setBusy(true);
    try {
      if (step.kind === "delete") {
        const result = await deleteBankTransactionAction(target.id, reason);
        if (!result.ok) {
          message.error(result.error ?? "Could not delete this line", 10);
          void ask(target.id);
          return;
        }
        message.success(DELETE_DIALOG.deleted);
        setReason("");
        setRead(null);
        onDeleted();
        return;
      }
      const result =
        step.kind === "void"
          ? await uncategoriseBankTransactionAction(target.id, reason)
          : step.kind === "unmatch"
            ? await unmatchBankTransactionAction(target.id, reason)
            : null;
      if (!result) return;
      if (!result.ok) {
        message.error(result.error ?? "Could not change this line", 10);
        return;
      }
      message.success(step.kind === "void" ? DELETE_DIALOG.voided : DELETE_DIALOG.unmatched, 8);
      onChanged();
      // Asked again: a line voided or unmatched can now be deleted, if that was the point.
      await ask(target.id);
    } catch (error) {
      message.error(serverFailure(error), 10);
    } finally {
      setBusy(false);
    }
  }

  const actionLabel =
    step?.kind === "delete" ? DELETE_DIALOG.deleteLabel : step?.kind === "void" || step?.kind === "unmatch" ? step.label : null;
  const footer = [
    <Button key="close" onClick={close} disabled={busy}>
      {actionLabel ? "Cancel" : "Close"}
    </Button>,
    step?.kind === "open" ? (
      <Button key="open" type="primary" href={step.href}>
        {step.label}
      </Button>
    ) : null,
    actionLabel ? (
      <Button
        key="act"
        type="primary"
        danger={step?.kind === "delete"}
        loading={busy}
        disabled={!reasonIsEnough(reason)}
        onClick={() => void act()}
      >
        {actionLabel}
      </Button>
    ) : null,
  ];

  return (
    <Modal
      open={target !== null}
      title={state && state.kind !== "deletable" ? DELETE_DIALOG.refusedTitle : DELETE_DIALOG.deleteTitle}
      onCancel={close}
      footer={footer}
      destroyOnHidden
    >
      <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
        <div>
          <b>{formatDate(target?.txnDate)}</b> · {target?.description} · {target?.amount}
        </div>
        {here?.error ? (
          <Alert type="error" showIcon title={here.error} />
        ) : !state ? (
          <Space>
            <Spin size="small" />
            <Typography.Text type="secondary">{DELETE_DIALOG.checking}</Typography.Text>
          </Space>
        ) : state.kind === "deletable" ? (
          <Alert type="warning" showIcon title="This cannot be undone" description={DELETE_DIALOG.deleteNote} />
        ) : (
          <Alert
            type="info"
            showIcon
            title={state.message}
            description={step && step.kind !== "none" && step.kind !== "delete" ? step.note : undefined}
          />
        )}
        {needsReason ? (
          <Input.TextArea
            aria-label="Reason"
            rows={2}
            value={reason}
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
            placeholder={DELETE_DIALOG.reasonPlaceholder}
          />
        ) : null}
      </Space>
    </Modal>
  );
}
