"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Alert, App, Button, Input, Modal, Space, Tag, Tooltip } from "antd";
import type { BankStatementImportRow } from "@/lib/services/banking";
import { useCompanyClock } from "@/components/CompanyClock";
import DataTable from "@/components/ui/DataTable";
import { flexColumn } from "@/components/ui/columns";
import { COLUMN } from "@/lib/design/table-metrics";
import { formatDateInTimeZone, plural, pluralWord } from "@/lib/format";
import { getStatementImportsAction, undoStatementImportAction } from "./actions";

/**
 * Rows, Still here, Imported, and the Review/Undo buttons. File and Into take
 * what is left; File carries a link, a tag and a second line, so its floor is
 * COLUMN.RICH_MIN, and Into (an account name) is COLUMN.TEXT_MIN. The buttons
 * are Review and Undo side by side, 190px as before.
 */
export const BANK_IMPORT_LIST_FIXED_WIDTHS = [COLUMN.QTY, COLUMN.QTY, COLUMN.DATE, 190] as const;

export interface BankImportListProps {
  /** Null shows every bank account's imports, matching the review queue. */
  bankAccountId: string | null;
  canWrite: boolean;
  /** Bumped by the screen after an import, and after an undo. */
  reloadKey: number;
  onChanged: () => void;
  /** The rows the page read for the account the screen opened on (2.92), used once. */
  initialRows?: BankStatementImportRow[];
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
  initialRows,
}: BankImportListProps) {
  const { message } = App.useApp();
  const { timeZone } = useCompanyClock();
  const [rows, setRows] = useState<BankStatementImportRow[]>(initialRows ?? []);
  // Until the first answer the register is loading, not empty: without the
  // page's rows it reads after the bank lines in Next's one-at-a-time queue of
  // Server Actions.
  const [loaded, setLoaded] = useState(initialRows !== undefined);
  const seeded = useRef(initialRows !== undefined);
  const [undoing, setUndoing] = useState<BankStatementImportRow | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    void getStatementImportsAction(bankAccountId).then((result) => {
      if (result.ok && result.data) setRows(result.data);
      setLoaded(true);
    });
  }, [bankAccountId]);

  useEffect(() => {
    // The page's rows stand for the first paint; every later change reads again.
    if (seeded.current) {
      seeded.current = false;
      return;
    }
    refresh();
  }, [refresh, reloadKey]);

  const confirmUndo = async () => {
    if (!undoing) return;
    setBusy(true);
    const result = await undoStatementImportAction(undoing.id, reason);
    setBusy(false);
    if (!result.ok || !result.data) {
      message.error(result.error ?? "Could not undo this import");
      return;
    }
    message.success(`${plural(result.data.removed, "line")} removed`);
    setUndoing(null);
    setReason("");
    refresh();
    onChanged();
  };

  return (
    <>
      {rows.some((row) => row.overrides_unavailable) ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          title="Could not check which of these imports were out of balance."
        />
      ) : null}
      <DataTable<BankStatementImportRow>
        rowKey="id"
        pagination={false}
        rows={rows}
        loading={!loaded}
        locale={{ emptyText: loaded ? "No statement has been imported into this company yet." : "" }}
        columns={[
          {
            title: "File",
            dataIndex: "filename",
            // Elastic, and not cut: it holds a link, a tag and a second line.
            minWidth: COLUMN.RICH_MIN,
            // The file itself, kept when it was read (1.83); imports before then kept only its name.
            render: (filename: string, row) => {
              const name = row.statement_file_id ? (
                <Space size={8}>
                  <span>{filename}</span>
                  <Link href={`/banking/statement-files/${row.statement_file_id}`}>View</Link>
                </Space>
              ) : (
                filename
              );
              // A statement an administrator imported out of balance (2.11) says so
              // under its file name, with who, when, why and by how much.
              if (row.override_detail === null) return name;
              return (
                <div>
                  <Space size={8} wrap>
                    {name}
                    <Tag color="orange">Imported out of balance</Tag>
                  </Space>
                  <div style={{ marginTop: 4, color: "var(--ant-color-text-secondary)", fontSize: 12 }}>
                    {row.override_detail}
                  </div>
                </div>
              );
            },
          },
          flexColumn<BankStatementImportRow>({
            title: "Into",
            render: (_, row) => `${row.account_code} — ${row.account_name}`,
          }),
          { title: "Rows", dataIndex: "row_count", width: BANK_IMPORT_LIST_FIXED_WIDTHS[0], align: "right" },
          {
            title: "Still here",
            dataIndex: "lines_here",
            width: BANK_IMPORT_LIST_FIXED_WIDTHS[1],
            align: "right",
          },
          {
            title: "Imported",
            dataIndex: "imported_at",
            width: BANK_IMPORT_LIST_FIXED_WIDTHS[2],
            render: (value: string) => formatDateInTimeZone(value, timeZone),
          },
          {
            title: "",
            key: "undo",
            width: BANK_IMPORT_LIST_FIXED_WIDTHS[3],
            align: "right",
            render: (_, row) => {
              if (row.status === "voided") {
                return (
                  <Tooltip title={row.void_reason ?? undefined}>
                    <Tag>Undone</Tag>
                  </Tooltip>
                );
              }
              // Review import, again, for as long as the import has lines waiting.
              const review =
                row.lines_here > row.locked_lines ? (
                  <Button size="small" href={`/banking/imports/${row.id}`}>
                    Review
                  </Button>
                ) : null;
              if (!canWrite) return review;
              if (row.locked_lines > 0) {
                return (
                  <Space size={6}>
                    {review}
                    <Tooltip
                      title={`${plural(row.locked_lines, "line")} ${pluralWord(row.locked_lines, "is", "are")} matched to the ledger. Unmatch them first — removing a line an entry points at would leave the books short.`}
                    >
                      <Button size="small" danger disabled>
                        Undo
                      </Button>
                    </Tooltip>
                  </Space>
                );
              }
              return (
                <Space size={6}>
                  {review}
                  <Button size="small" danger onClick={() => setUndoing(row)}>
                    Undo
                  </Button>
                </Space>
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
          {plural(undoing?.lines_here ?? 0, "bank line")} will be removed from{" "}
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
