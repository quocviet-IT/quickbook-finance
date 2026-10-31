"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, App, Button, Card, Input, Modal, Space, Tag, Tooltip, Typography } from "antd";
import DataTable from "@/components/ui/DataTable";
import { useCompanyClock } from "@/components/CompanyClock";
import { formatDateTime } from "@/lib/format";
import {
  SYNC_STATUS_LABEL,
  syncUndoState,
  undoSyncWarning,
  undoneSyncMessage,
  type BankFeedSyncStatus,
  type BankFeedSyncView,
} from "@/lib/domain/bank-feeds";
import StatusTag from "@/components/ui/StatusTag";
import { serverFailure } from "@/lib/domain/statement-evidence";
import { bankFeedSyncsAction, undoBankFeedSyncAction } from "./actions";

export interface BankFeedSyncListProps {
  bankAccountId: string;
  canWrite: boolean;
  /** Bumped by the screen after anything that can change the list. */
  reloadKey: number;
  onChanged: () => void;
  /** The rows the page read for the account the screen opened on (2.92), used once. */
  initialRows?: BankFeedSyncView[];
}

/** A count column: room for "Removed" or "Skipped" in the header and five digits below (2.50). */
const COUNT_WIDTH = 80;

const STATUS_COLOR: Record<BankFeedSyncStatus, string | undefined> = {
  running: "blue",
  succeeded: "green",
  failed: "orange",
  undone: undefined,
};

/**
 * Bank feed syncs, and the way back out of one (1.89). Shown only for an
 * account a bank feed has fed. Undo is offered on one sync at a time — the
 * connection's newest that changed something — and the button says why when
 * it is shut instead of failing when pressed.
 */
export default function BankFeedSyncList({ bankAccountId, canWrite, reloadKey, onChanged, initialRows }: BankFeedSyncListProps) {
  const { message } = App.useApp();
  const { timeZone } = useCompanyClock();
  const when = (iso: string) => formatDateTime(iso, timeZone);
  const [rows, setRows] = useState<BankFeedSyncView[]>(initialRows ?? []);
  const [undoing, setUndoing] = useState<BankFeedSyncView | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const [readError, setReadError] = useState<string | null>(null);
  // Until the first answer the list is loading, not empty: without the page's
  // rows it reads after the bank lines in Next's one-at-a-time queue of Server
  // Actions.
  const [loaded, setLoaded] = useState(initialRows !== undefined);
  const seeded = useRef(initialRows !== undefined);
  /** Counts reads, so only the latest one may set the rows: a slow answer for another account is dropped. */
  const latestRead = useRef(0);

  const refresh = useCallback(() => {
    const read = ++latestRead.current;
    void bankFeedSyncsAction(bankAccountId)
      .then((result) => {
        if (read !== latestRead.current) return;
        if (result.ok && result.data) {
          setRows(result.data);
          setReadError(null);
        } else {
          setRows([]);
          setReadError(result.error ?? "The bank feed syncs could not be read");
        }
        setLoaded(true);
      })
      .catch((error) => {
        if (read !== latestRead.current) return;
        setRows([]);
        setReadError(`The bank feed syncs could not be read: ${serverFailure(error)}`);
        setLoaded(true);
      });
  }, [bankAccountId]);

  useEffect(() => {
    // The page's rows stand for the first paint; every later change reads again.
    if (seeded.current) seeded.current = false;
    else refresh();
    // Leaving the account, or the screen, drops the read still in flight.
    return () => {
      latestRead.current += 1;
    };
  }, [refresh, reloadKey]);

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

  if (readError) {
    return (
      <Card size="small" title="Bank feed syncs" style={{ marginTop: 16 }}>
        <Alert type="error" showIcon message={readError} />
      </Card>
    );
  }
  if (rows.length === 0) return null;

  return (
    <Card size="small" title="Bank feed syncs" style={{ marginTop: 16 }} styles={{ body: { padding: 0 } }}>
      <DataTable<BankFeedSyncView>
        rowKey="runId"
        dataSource={rows}
        loading={!loaded}
        columns={[
          { title: "Started", dataIndex: "startedAt", width: 170, render: (value: string) => when(value) },
          {
            // The one elastic column (2.50). Four counts and Undo left it about
            // 200px once Skipped arrived, and "First Platypus Bank" broke over
            // three lines beside its Disconnected tag; now the tag wraps under
            // the name when the two do not fit side by side.
            title: "Bank",
            dataIndex: "institutionName",
            render: (name: string, row) => (
              <Space size={[6, 4]} wrap>
                <span>{name}</span>
                {row.connectionStatus === "disconnected" ? <StatusTag status="disconnected" /> : null}
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
          { title: "Added", dataIndex: "added", width: COUNT_WIDTH, align: "right" },
          { title: "Changed", dataIndex: "modified", width: COUNT_WIDTH, align: "right" },
          { title: "Removed", dataIndex: "removed", width: COUNT_WIDTH, align: "right" },
          {
            // Lines not brought in: already in OneBook, or dated before the feed's start (2.48).
            title: "Skipped",
            dataIndex: "skipped",
            width: COUNT_WIDTH,
            align: "right",
            render: (skipped: number) =>
              skipped > 0 ? (
                <Tooltip title="Not brought in: already in OneBook from a statement or another connection, or dated before the feed's start">
                  <span>{skipped}</span>
                </Tooltip>
              ) : (
                skipped
              ),
          },
          {
            title: "",
            key: "undo",
            width: 88,
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
