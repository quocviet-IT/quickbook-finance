"use client";
import { useState } from "react";
import { App, Button, Input, Modal, Table, Tag } from "antd";
import type { ImportBatchRow } from "@/lib/services/ledger-import";
import { voidImportBatchAction } from "./actions";

export interface LedgerBatchListProps {
  batches: ImportBatchRow[];
  canManage: boolean;
  onChanged: () => void;
  /** Both kinds of import share this list, and an empty one has to say which. */
  emptyText?: string;
}

/**
 * What has been imported, and the way back out.
 *
 * Undo is the reason this list exists. Nothing else in One Book can void a
 * plain journal entry, so without it a three-year ledger imported against the
 * wrong chart would have to be unpicked by hand.
 */
export default function LedgerBatchList({
  batches,
  canManage,
  onChanged,
  emptyText,
}: LedgerBatchListProps) {
  const { message } = App.useApp();
  const [undoing, setUndoing] = useState<ImportBatchRow | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const confirmUndo = async () => {
    if (!undoing) return;
    setBusy(true);
    const result = await voidImportBatchAction(undoing.id, reason);
    setBusy(false);
    if (!result.ok || !result.data) {
      message.error(result.error ?? "Could not undo that import");
      return;
    }
    message.success(`${result.data.voided} entries voided`);
    setUndoing(null);
    setReason("");
    onChanged();
  };

  return (
    <>
      <Table<ImportBatchRow>
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={batches}
        locale={{ emptyText: emptyText ?? "No ledger has been imported into this company yet." }}
        columns={[
          { title: "File", dataIndex: "file_name" },
          {
            title: "Mode",
            dataIndex: "mode",
            width: 120,
            render: (mode: string) => (
              <Tag>{mode === "history" ? "Whole history" : "Balances"}</Tag>
            ),
          },
          {
            title: "Covers",
            width: 200,
            render: (_, row) =>
              row.from_date ? `${row.from_date} → ${row.to_date ?? row.from_date}` : "—",
          },
          { title: "Entries", dataIndex: "entry_count", width: 90, align: "right" },
          { title: "Lines", dataIndex: "line_count", width: 90, align: "right" },
          {
            title: "Imported",
            dataIndex: "imported_at",
            width: 120,
            render: (value: string) => value.slice(0, 10),
          },
          {
            title: "",
            width: 110,
            render: (_, row) =>
              row.status === "voided" ? (
                <Tag color="default">undone</Tag>
              ) : canManage ? (
                <Button size="small" danger onClick={() => setUndoing(row)}>
                  Undo
                </Button>
              ) : null,
          },
        ]}
      />

      <Modal
        open={Boolean(undoing)}
        title={`Undo the import of "${undoing?.file_name ?? ""}"?`}
        okText="Undo the import"
        okButtonProps={{ danger: true }}
        confirmLoading={busy}
        onOk={confirmUndo}
        onCancel={() => {
          setUndoing(null);
          setReason("");
        }}
      >
        <p>
          This voids the {undoing?.entry_count ?? 0} entries this import created. Voided entries
          stay in the ledger and drop out of every report, exactly as a voided invoice does. An
          entry dated in a closed period cannot be voided — reverse it instead.
        </p>
        <Input
          placeholder="Imported against the wrong chart of accounts"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </Modal>
    </>
  );
}
