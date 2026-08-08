"use client";
import { useCallback, useEffect, useState } from "react";
import { App, Button, Input, Modal, Table, Tag, Tooltip } from "antd";
import type { BankStatementImportRow } from "@/lib/services/banking";
import { getStatementImportsAction, undoStatementImportAction } from "./actions";

export interface BankImportListProps {
  /** Null shows every bank account's imports, matching the review queue. */
  bankAccountId: string | null;
  canWrite: boolean;
  /** Bumped by the screen after an import, and after an undo. */
  reloadKey: number;
  onChanged: () => void;
}

/**
 * Statement imports, and the way back out of one.
 *
 * This list exists because there was no way out. A statement import writes
 * bank lines and posts nothing, so there was no entry to void and no button of
 * any kind — an accountant who imported a file into the wrong bank account had
 * to ask somebody with a database connection to delete 1,560 rows.
 *
 * Undo is offered only while every line of the import is still unmatched. Once
 * the ledger cites one, removing it would leave an entry pointing at a
 * transaction that no longer exists, so the button says why it is shut instead
 * of failing when pressed.
 */
export default function BankImportList({
  bankAccountId,
  canWrite,
  reloadKey,
  onChanged,
}: BankImportListProps) {
  const { message } = App.useApp();
  const [rows, setRows] = useState<BankStatementImportRow[]>([]);
  const [undoing, setUndoing] = useState<BankStatementImportRow | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    void getStatementImportsAction(bankAccountId).then((result) => {
      if (result.ok && result.data) setRows(result.data);
    });
  }, [bankAccountId]);

  useEffect(refresh, [refresh, reloadKey]);

  const confirmUndo = async () => {
    if (!undoing) return;
    setBusy(true);
    const result = await undoStatementImportAction(undoing.id, reason);
    setBusy(false);
    if (!result.ok || !result.data) {
      message.error(result.error ?? "Could not undo this import");
      return;
    }
    message.success(`${result.data.removed} line(s) removed`);
    setUndoing(null);
    setReason("");
    refresh();
    onChanged();
  };

  return (
    <>
      <Table<BankStatementImportRow>
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={rows}
        locale={{ emptyText: "No statement has been imported into this company yet." }}
        columns={[
          { title: "File", dataIndex: "filename" },
          {
            title: "Into",
            width: 240,
            render: (_, row) => `${row.account_code} — ${row.account_name}`,
          },
          { title: "Rows", dataIndex: "row_count", width: 80, align: "right" },
          {
            title: "Still here",
            dataIndex: "lines_here",
            width: 100,
            align: "right",
          },
          {
            title: "Imported",
            dataIndex: "imported_at",
            width: 120,
            render: (value: string) => value.slice(0, 10),
          },
          {
            title: "",
            key: "undo",
            width: 110,
            align: "right",
            render: (_, row) => {
              if (row.status === "voided") {
                return (
                  <Tooltip title={row.void_reason ?? undefined}>
                    <Tag>Undone</Tag>
                  </Tooltip>
                );
              }
              if (!canWrite) return null;
              if (row.locked_lines > 0) {
                return (
                  <Tooltip
                    title={`${row.locked_lines} line(s) are matched to the ledger. Unmatch them first — removing a line an entry points at would leave the books short.`}
                  >
                    <Button size="small" danger disabled>
                      Undo
                    </Button>
                  </Tooltip>
                );
              }
              return (
                <Button size="small" danger onClick={() => setUndoing(row)}>
                  Undo
                </Button>
              );
            },
          },
        ]}
      />

      <Modal
        open={undoing !== null}
        title={`Undo the import of "${undoing?.filename ?? ""}"?`}
        okText="Undo the import"
        okButtonProps={{ danger: true, loading: busy, disabled: reason.trim() === "" }}
        onOk={confirmUndo}
        onCancel={() => {
          setUndoing(null);
          setReason("");
        }}
      >
        <p>
          {undoing?.lines_here ?? 0} bank line(s) will be removed from{" "}
          <b>
            {undoing?.account_code} — {undoing?.account_name}
          </b>
          . Nothing was posted to the ledger by this import, so no entry changes. The record of
          the import is kept, marked undone.
        </p>
        <Input.TextArea
          rows={2}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Imported into the wrong bank account"
        />
      </Modal>
    </>
  );
}
