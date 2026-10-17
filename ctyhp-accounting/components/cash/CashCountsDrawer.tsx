"use client";
import { useEffect, useState } from "react";
import { Alert, Drawer, Spin, Tag } from "antd";
import DataTable from "@/components/ui/DataTable";
import { flexColumn } from "@/components/ui/columns";
import { COUNT_STATUS_LABEL, type CashCountRow } from "@/lib/domain/cash-count";
import { shortDate } from "@/lib/domain/report-presets";
import { cashCountsAction } from "./actions";
import {
  COUNTS_DRAWER_WIDTH,
  COUNT_BY_FLOOR,
  COUNT_DATE_WIDTH,
  COUNT_ENTRY_WIDTH,
} from "./count-columns";
import { COLUMN } from "@/lib/design/table-metrics";
import styles from "./count-cash.module.css";

const STATUS_COLOR = { posted: "green", pending_approval: "orange", rejected: "default" } as const;

/** One cash account's counts, newest first: date, counted, book, difference, entry and who counted. */
export default function CashCountsDrawer({
  account,
  money,
  onClose,
}: {
  account: { id: string; name: string } | null;
  money: (minor: number) => string;
  onClose: () => void;
}) {
  return (
    <Drawer
      title={account ? `Counts: ${account.name}` : "Counts"}
      open={account !== null}
      onClose={onClose}
      size={COUNTS_DRAWER_WIDTH}
      styles={{ wrapper: { maxWidth: "100vw" } }}
      destroyOnHidden
    >
      {account ? <Counts accountId={account.id} money={money} /> : null}
    </Drawer>
  );
}

function Counts({ accountId, money }: { accountId: string; money: (minor: number) => string }) {
  const [rows, setRows] = useState<CashCountRow[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await cashCountsAction(accountId);
        if (cancelled) return;
        if (result.ok && result.data) setRows(result.data);
        else setProblem(result.error ?? "The counts could not be read");
      } catch {
        if (!cancelled) setProblem("The counts could not be read. Check the connection and try again.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  if (problem) return <Alert type="warning" showIcon title={problem} />;
  if (rows === null) return <Spin />;

  return (
    <div className={styles.countsTable}>
      <DataTable<CashCountRow>
        rowKey="id"
        dataSource={rows}
        pagination={false}
        emptyTitle="Never counted"
        emptyDescription="Record a count to date this account and post any difference."
        columns={[
          { title: "Date", key: "date", width: COUNT_DATE_WIDTH, render: (_, row) => shortDate(row.countedOn) },
          { title: "Counted", key: "counted", width: COLUMN.MONEY_WIDE, align: "right", render: (_, row) => money(row.countedMinor) },
          { title: "Book", key: "book", width: COLUMN.MONEY_WIDE, align: "right", render: (_, row) => money(row.bookMinor) },
          {
            title: "Difference",
            key: "difference",
            width: COLUMN.MONEY_WIDE,
            align: "right",
            render: (_, row) => money(row.differenceMinor),
          },
          {
            title: "Status",
            key: "status",
            width: COLUMN.STATUS,
            render: (_, row) => <Tag color={STATUS_COLOR[row.status]}>{COUNT_STATUS_LABEL[row.status]}</Tag>,
          },
          { title: "Entry", key: "entry", width: COUNT_ENTRY_WIDTH, render: (_, row) => row.entryNumber ?? "—" },
          flexColumn<CashCountRow>({
            title: "By",
            key: "by",
            floor: COUNT_BY_FLOOR,
            render: (_, row) => <span title={row.byName}>{row.byName || "—"}</span>,
          }),
        ]}
      />
    </div>
  );
}
