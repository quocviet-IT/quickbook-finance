"use client";
import { useCallback, useEffect, useState } from "react";
import { App, Button, Card, Input, Modal, Space, Tag, Tooltip, Typography } from "antd";
import DataTable from "@/components/ui/DataTable";
import {
  SYNC_STATUS_LABEL,
  syncUndoState,
  undoSyncWarning,
  undoneSyncMessage,
  type BankFeedSyncStatus,
  type BankFeedSyncView,
} from "@/lib/domain/bank-feeds";
import { serverFailure } from "@/lib/domain/statement-evidence";
import { bankFeedSyncsAction, undoBankFeedSyncAction } from "./actions";

export interface BankFeedSyncListProps {
  bankAccountId: string;
  canWrite: boolean;
  /** Bumped by the screen after anything that can change the list. */
  reloadKey: number;
  onChanged: () => void;
}

const STATUS_COLOR: Record<BankFeedSyncStatus, string | undefined> = {
  running: "blue",
  succeeded: "green",
  failed: "orange",
  undone: undefined,
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * Bank feed syncs, and the way back out of one (1.87). Shown only for an
 * account a bank feed has fed. Undo is offered on one sync at a time — the
 * connection's newest that changed something — and the button says why when
 * it is shut instead of failing when pressed.
 */
export default function BankFeedSyncList({ bankAccountId, canWrite, reloadKey, onChanged }: BankFeedSyncListProps) {
  const { message } = App.useApp();
  const [rows, setRows] = useState<BankFeedSyncView[]>([]);
  const [undoing, setUndoing] = useState<BankFeedSyncView | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    void bankFeedSyncsAction(bankAccountId).then((result) => {
      if (result.ok && result.data) setRows(result.data);
    });
  }, [bankAccountId]);

  useEffect(refresh, [refresh, reloadKey]);

  const close = () => {
    setUndoing(null);
    setReason("");
  };

  const confirmUndo = async () => {
    if (!undoing) return;
    setBusy(true);
    try {
      const result = await undoBankFeedSyncAction(undoing.runId, reason);
      if (!result.ok || !result.data) {
        message.error(result.error ?? "Could not undo this sync", 10);
        return;
      }
      message.success(undoneSyncMessage(result.data), 8);
      close();
      refresh();
      onChanged();
    } catch (error) {
      message.error(`Could not undo this sync: ${serverFailure(error)}`, 10);
    } finally {
      setBusy(false);
    }
  };

  if (rows.length === 0) return null;

  return (
    <Card size="small" title="Bank feed syncs" style={{ marginTop: 16 }} styles={{ body: { padding: 0 } }}>
      <DataTable<BankFeedSyncView>
        rowKey="runId"
        dataSource={rows}
        columns={[
          { title: "Started", dataIndex: "startedAt", width: 190, render: (value: string) => when(value) },
          {
            title: "Bank",
            dataIndex: "institutionName",
            render: (name: string, row) => (
              <Space size={6}>
                <span>{name}</span>
                {row.connectionStatus === "disconnected" ? <Tag>disconnected</Tag> : null}
              </Space>
            ),
          },
          {
            title: "Status",
            dataIndex: "status",
            width: 120,
            render: (status: BankFeedSyncStatus, row) => {
              const tag = <Tag color={STATUS_COLOR[status]}>{SYNC_STATUS_LABEL[status]}</Tag>;
              const note = status === "failed" ? row.errorMessage : status === "undone" ? row.undoReason : null;
              return note ? <Tooltip title={note}>{tag}</Tooltip> : tag;
            },
          },
          { title: "Added", dataIndex: "added", width: 90, align: "right" },
          { title: "Changed", dataIndex: "modified", width: 90, align: "right" },
          { title: "Removed", dataIndex: "removed", width: 90, align: "right" },
          {
            title: "",
            key: "undo",
            width: 100,
            align: "right",
            render: (_, row) => {
              if (!canWrite || row.status === "undone") return null;
              const state = syncUndoState(row);
              return (
                <Tooltip title={state.why ?? undefined}>
                  <Button size="small" danger disabled={!state.canUndo} onClick={() => setUndoing(row)}>
                    Undo
                  </Button>
                </Tooltip>
              );
            },
          },
        ]}
      />
      <Modal
        open={undoing !== null}
        title={`Undo the sync of ${undoing ? when(undoing.startedAt) : ""}?`}
        okText="Undo the sync"
        okButtonProps={{ danger: true, loading: busy, disabled: reason.trim() === "" }}
        onOk={() => void confirmUndo()}
        onCancel={close}
        destroyOnHidden
      >
        <Typography.Paragraph>{undoing ? undoSyncWarning(undoing) : null}</Typography.Paragraph>
        <Input.TextArea
          rows={2}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="These lines were already imported from a statement"
        />
      </Modal>
    </Card>
  );
}
