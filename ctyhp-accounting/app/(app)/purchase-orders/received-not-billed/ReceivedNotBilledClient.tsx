"use client";
import Link from "next/link";
import { Typography } from "antd";
import DataTable from "@/components/ui/DataTable";
import type { CurrencyRow, ReceivedNotBilledRow } from "@/lib/db/types";

export default function ReceivedNotBilledClient({
  rows,
  currencies,
}: {
  rows: ReceivedNotBilledRow[];
  currencies: CurrencyRow[];
}) {
  function fmt(minor: number, code: string): string {
    const d = currencies.find((c) => c.code === code)?.decimal_places ?? 2;
    return `${(minor / 10 ** d).toFixed(d)} ${code}`;
  }

  // Only total when every row is in one currency — summing across currencies
  // without an FX conversion would be a wrong number (FX is Module I).
  const codes = new Set(rows.map((r) => r.currency_code));
  const singleCurrency = codes.size === 1 ? [...codes][0] : null;
  const total = rows.reduce((s, r) => s + r.value_minor, 0);

  return (
    <>
      <DataTable<ReceivedNotBilledRow>
        rowKey="purchase_order_line_id"
        dataSource={rows}
        emptyTitle="Nothing outstanding"
        emptyDescription="Everything received has been billed."
        columns={[
          {
            title: "PO Number",
            dataIndex: "po_number",
            render: (v: string | null, r) => (
              <Link href={`/purchase-orders/${r.purchase_order_id}`}>{v ?? "(draft)"}</Link>
            ),
          },
          { title: "Vendor", dataIndex: "vendor_name" },
          { title: "Order Date", dataIndex: "order_date" },
          { title: "Description", dataIndex: "description", render: (v: string) => v || "—" },
          {
            title: "Quantity Outstanding",
            dataIndex: "qty_outstanding",
            align: "right",
            render: (v: number) => Number(v),
          },
          {
            title: "Unit Cost",
            dataIndex: "unit_cost_minor",
            align: "right",
            render: (v: number, r) => fmt(v, r.currency_code),
          },
          {
            title: "Value",
            dataIndex: "value_minor",
            align: "right",
            render: (v: number, r) => fmt(v, r.currency_code),
          },
        ]}
      />
      {singleCurrency && (
        <Typography.Paragraph strong style={{ textAlign: "right", marginTop: 12 }}>
          Total received not billed: {fmt(total, singleCurrency)}
        </Typography.Paragraph>
      )}
      <Typography.Paragraph type="secondary">
        Amounts are the purchase-order cost of goods and services that have arrived but have no
        vendor bill yet. They are not in the ledger until the bill is posted.
      </Typography.Paragraph>
    </>
  );
}
