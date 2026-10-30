"use client";
import { useEffect, useState } from "react";
import { App, Modal, Tag } from "antd";
import type { InventoryTxnRow, ItemRow } from "@/lib/db/types";
import { listItemMovementsAction } from "./inventory-actions";
import { formatDate, formatMoney } from "@/lib/format";
import { humanizeStatus } from "@/lib/domain/status-label";
import DataTable from "@/components/ui/DataTable";
import { flexColumn } from "@/components/ui/columns";
import { COLUMN } from "@/lib/design/table-metrics";
import { clientTablePagination, pageSizeOptionsFor } from "@/components/ui/table-pagination";

const SOURCE_COLOR: Record<string, string> = {
  receipt: "green",
  bill_variance: "gold",
  sale: "blue",
  adjustment: "purple",
  reversal: "red",
};

// See table-pagination.ts for why this has to live in state rather than as a
// literal on `pagination`.
const MOVEMENTS_DEFAULT_PAGE_SIZE = 20;

/**
 * The dialog's width; its body, where the table sits, is 48px less. Seven
 * columns, one of them a memo, do not fit in the 812px the old 860 left, so it
 * is a little wider.
 */
export const ITEM_MOVEMENTS_MODAL_WIDTH = 900;

/**
 * Date, Source (one tag), Quantity, Cost, On hand and Value (a running total,
 * so a digit wider than Cost). Memo takes what is left, at least
 * COLUMN.TEXT_MIN.
 */
export const ITEM_MOVEMENTS_FIXED_WIDTHS = [
  COLUMN.DATE,
  COLUMN.STATUS,
  COLUMN.QTY,
  COLUMN.MONEY,
  COLUMN.QTY,
  COLUMN.MONEY_WIDE,
] as const;

interface Props {
  open: boolean;
  item: ItemRow | null;
  onClose: () => void;
  baseCurrency: string;
  baseDecimals: number;
}

/** Every movement behind an item's quantity and value — the audit trail. */
export default function ItemMovementsModal(props: Props) {
  if (!props.open || !props.item) return null;
  return <ItemMovementsModalBody {...props} item={props.item} />;
}

function ItemMovementsModalBody({ item, onClose, baseCurrency, baseDecimals }: Props & { item: ItemRow }) {
  const { message } = App.useApp();
  const [rows, setRows] = useState<InventoryTxnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageSize, setPageSize] = useState<number>(MOVEMENTS_DEFAULT_PAGE_SIZE);

  useEffect(() => {
    let cancelled = false;
    listItemMovementsAction(item.id).then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (res.ok && res.data) setRows(res.data);
      else message.error(res.error ?? "Failed to load movements");
    });
    return () => {
      cancelled = true;
    };
  }, [item.id, message]);

  const money = (m: number) => formatMoney(m, baseCurrency, baseDecimals);

  return (
    <Modal title={`Inventory movements — ${item.name}`} open onCancel={onClose} footer={null} width={ITEM_MOVEMENTS_MODAL_WIDTH}>
      <DataTable<InventoryTxnRow>
        rowKey="id"
        loading={loading}
        rows={rows}
        pagination={clientTablePagination(pageSize, setPageSize, pageSizeOptionsFor(MOVEMENTS_DEFAULT_PAGE_SIZE))}
        locale={{ emptyText: "No movements yet" }}
        columns={[
          { title: "Date", dataIndex: "txn_date", width: ITEM_MOVEMENTS_FIXED_WIDTHS[0], render: (v: string) => formatDate(v) },
          {
            title: "Source",
            dataIndex: "source",
            width: ITEM_MOVEMENTS_FIXED_WIDTHS[1],
            render: (v: string) => <Tag color={SOURCE_COLOR[v]}>{humanizeStatus(v)}</Tag>,
          },
          { title: "Quantity", dataIndex: "qty_delta", width: ITEM_MOVEMENTS_FIXED_WIDTHS[2], align: "right", render: (v: number) => Number(v) },
          { title: "Cost", dataIndex: "cost_delta_minor", width: ITEM_MOVEMENTS_FIXED_WIDTHS[3], align: "right", render: (v: number) => money(Number(v)) },
          { title: "On hand", dataIndex: "running_qty", width: ITEM_MOVEMENTS_FIXED_WIDTHS[4], align: "right", render: (v: number) => Number(v) },
          {
            title: "Value",
            dataIndex: "running_value_minor",
            width: ITEM_MOVEMENTS_FIXED_WIDTHS[5],
            align: "right",
            render: (v: number) => money(Number(v)),
          },
          flexColumn<InventoryTxnRow>({ title: "Memo", dataIndex: "memo" }),
        ]}
      />
    </Modal>
  );
}
