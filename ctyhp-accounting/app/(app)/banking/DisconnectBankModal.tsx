"use client";
import { useState } from "react";
import { Alert, App, Checkbox, Input, Modal, Typography } from "antd";
import { disconnectedMessage } from "@/lib/domain/bank-feeds";
import { serverFailure } from "@/lib/domain/statement-evidence";
import { disconnectBankConnectionAction } from "./actions";

export interface DisconnectBankModalProps {
  /** The connection to disconnect; null keeps the dialog closed. */
  connection: { id: string; institution_name: string } | null;
  onClose: () => void;
  onDisconnected: () => void;
}

/**
 * Disconnect a bank feed (1.87). The connection is removed at Plaid first;
 * when Plaid does not confirm, nothing changes and the dialog says why and
 * offers to disconnect in OneBook only — never silently, because a connection
 * Plaid still holds keeps running (and, on a paid plan, billing) unseen.
 */
export default function DisconnectBankModal({ connection, onClose, onDisconnected }: DisconnectBankModalProps) {
  const { message } = App.useApp();
  const [reason, setReason] = useState("");
  const [unconfirmed, setUnconfirmed] = useState<string | null>(null);
  const [onlyInOneBook, setOnlyInOneBook] = useState(false);
  const [busy, setBusy] = useState(false);

  const close = () => {
    setReason("");
    setUnconfirmed(null);
    setOnlyInOneBook(false);
    onClose();
  };

  const confirm = async () => {
    if (!connection) return;
    setBusy(true);
    try {
      const result = await disconnectBankConnectionAction(connection.id, reason, onlyInOneBook);
      if (!result.ok || !result.data) {
        message.error(result.error ?? "Could not disconnect this bank", 10);
        return;
      }
      if (!result.data.disconnected) {
        setUnconfirmed(result.data.unconfirmed);
        return;
      }
      message.success(disconnectedMessage(connection.institution_name, result.data.confirmedByPlaid), 8);
      close();
      onDisconnected();
    } catch (error) {
      message.error(`Could not disconnect this bank: ${serverFailure(error)}`, 10);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={connection !== null}
      title={`Disconnect ${connection?.institution_name ?? "this bank"}?`}
      okText={unconfirmed && onlyInOneBook ? "Disconnect in OneBook only" : "Disconnect"}
      okButtonProps={{ danger: true, loading: busy, disabled: reason.trim() === "" || (unconfirmed !== null && !onlyInOneBook) }}
      onOk={() => void confirm()}
      onCancel={close}
      destroyOnHidden
    >
      <Typography.Paragraph>
        Plaid stops sending this bank&apos;s transactions. The lines already here stay. You can connect the bank again.
      </Typography.Paragraph>
      <Input.TextArea
        rows={2}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="The bank closed this account"
      />
      {unconfirmed ? (
        <>
          <Alert type="warning" showIcon style={{ marginTop: 12 }} title={unconfirmed} />
          <Checkbox style={{ marginTop: 8 }} checked={onlyInOneBook} onChange={(event) => setOnlyInOneBook(event.target.checked)}>
            Disconnect in OneBook only
          </Checkbox>
        </>
      ) : null}
    </Modal>
  );
}
