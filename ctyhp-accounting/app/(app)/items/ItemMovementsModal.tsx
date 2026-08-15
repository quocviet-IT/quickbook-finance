"use client";
import { useEffect, useState } from "react";
import { App, Modal, Table, Tag } from "antd";
import type { InventoryTxnRow, ItemRow } from "@/lib/db/types";
import { listItemMovementsAction } from "./inventory-actions";
import { longTextColumn } from "@/components/ui/long-text-column";

const SOURCE_COLOR: Record<string, string> = {
  receipt: "green",
  bill_variance: "gold",
  sale: "blue",
  adjustment: "purple",
  reversal: "red",
};

interface Props {
  open: boolean;
  item: ItemRow | null;
  onClose: () => void;
}

/** Every movement behind an item's quantity and value — the audit trail. */
export default function ItemMovementsModal(props: Props) {
  if (!props.open || !props.item) return null;
  return <ItemMovementsModalBody {...props} item={props.item} />;
}

function ItemMovementsModalBody({ item, onClose }: Props & { item: ItemRow }) {
  const { message } = App.useApp();
  const [rows, setRows] = useState<InventoryTxnRow[]>([]);
  const [loading, setLoading] = useState(true);

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

  const money = (m: number) => `$${(m / 100).toFixed(2)}`;

  return (
    <Modal title={`Inventory movements — ${item.name}`} open onCancel={onClose} footer={null} width={860}>
      <Table<InventoryTxnRow>
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={rows}
        pagination={{ pageSize: 20 }}
        scroll={{ x: "max-content" }}
        locale={{ emptyText: "No movements yet" }}
        columns={[
          { title: "Date", dataIndex: "txn_date" },
          {
            title: "Source",
            dataIndex: "source",
            render: (v: string) => <Tag color={SOURCE_COLOR[v]}>{v.replace("_", " ")}</Tag>,
          },
          { title: "Quantity", dataIndex: "qty_delta", align: "right", render: (v: number) => Number(v) },
          { title: "Cost", dataIndex: "cost_delta_minor", align: "right", render: (v: number) => money(Number(v)) },
          { title: "On hand", dataIndex: "running_qty", align: "right", render: (v: number) => Number(v) },
          {
            title: "Value",
            dataIndex: "running_value_minor",
            align: "right",
            render: (v: number) => money(Number(v)),
          },
          { title: "Memo", dataIndex: "memo", ...longTextColumn() },
        ]}
      />
    </Modal>
  );
}
