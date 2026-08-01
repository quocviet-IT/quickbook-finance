"use client";
import { useState } from "react";
import { Alert, App, Button, DatePicker, Space, Typography } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import DataTable from "@/components/ui/DataTable";
import FilterBar from "@/components/ui/FilterBar";
import { fromMinor } from "@/lib/domain/money";
import type { InventoryValuationRow } from "@/lib/db/types";
import type { InventoryValuation } from "@/lib/services/inventory";
import { METHOD_LABEL } from "@/lib/domain/inventory-review";
import { inventoryValuationAction } from "./actions";

export default function InventoryValuationClient({
  baseCurrency,
  baseDecimals,
  valuationMethod,
  policyMemo,
}: {
  baseCurrency: string;
  baseDecimals: number;
  /** Read from the company's accounting policy, never hardcoded here. */
  valuationMethod: string;
  policyMemo: string | null;
}) {
  const { message } = App.useApp();
  const [asOf, setAsOf] = useState<Dayjs>(dayjs());
  const [rep, setRep] = useState<InventoryValuation | null>(null);
  const [loading, setLoading] = useState(false);

  const fmt = (m: number) =>
    fromMinor(m, baseDecimals).toLocaleString(undefined, { minimumFractionDigits: baseDecimals });

  async function run() {
    setLoading(true);
    const r = await inventoryValuationAction({ as_of: asOf.format("YYYY-MM-DD") });
    setLoading(false);
    if (r.ok && r.data) setRep(r.data);
    else message.error(r.error ?? "Failed to run the report");
  }

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="large">
      <FilterBar
        resultCount={rep ? rep.rows.length : undefined}
        ariaLabel="Inventory Valuation filters"
        actions={
          <Button type="primary" loading={loading} onClick={run}>
            Run report
          </Button>
        }
      >
        <DatePicker value={asOf} onChange={(v) => v && setAsOf(v)} aria-label="As of date" />
      </FilterBar>

      {rep && (
        <>
          <Alert
            type="info"
            showIcon
            message={
              <>
                Measured at <b>{METHOD_LABEL[valuationMethod] ?? valuationMethod}</b>, at the lower
                of cost and net realisable value (ASC 330-10-35-1B). Base currency {baseCurrency},
                as of {rep.asOf}.
              </>
            }
            description={
              policyMemo ? (
                <Typography.Paragraph
                  type="secondary"
                  style={{ marginBottom: 0, whiteSpace: "pre-line" }}
                  ellipsis={{ rows: 2, expandable: true, symbol: "the full policy" }}
                >
                  {policyMemo}
                </Typography.Paragraph>
              ) : (
                <Typography.Text type="warning">
                  No inventory accounting policy has been recorded. Settings → Company.
                </Typography.Text>
              )
            }
          />
          <DataTable<InventoryValuationRow>
            rowKey="item_id"
            pagination={false}
            dataSource={rep.rows}
            emptyTitle="No tracked items"
            emptyDescription="Turn on quantity tracking on a product to see it valued here."
            columns={[
              { title: "Code", dataIndex: "item_code", render: (v: string | null) => v ?? "—" },
              { title: "Item", dataIndex: "name" },
              {
                title: "Quantity on hand",
                dataIndex: "qty_on_hand",
                align: "right",
                render: (v: number) => Number(v),
              },
              {
                title: "Unit cost",
                dataIndex: "unit_cost_minor",
                align: "right",
                render: (v: number) => fmt(Number(v)),
              },
              {
                title: "Value",
                dataIndex: "value_minor",
                align: "right",
                render: (v: number) => fmt(Number(v)),
              },
            ]}
            summary={() => (
              <DataTableSummaryTotal label="Total inventory value" value={fmt(rep.subledgerValueMinor)} />
            )}
          />
          <Alert
            type={rep.tiesOut ? "success" : "warning"}
            showIcon
            message={
              `Subledger ${fmt(rep.subledgerValueMinor)} vs inventory control accounts ${fmt(rep.controlBalanceMinor)} ${baseCurrency}` +
              (rep.tiesOut ? " ✓ reconciled" : " — does not reconcile, investigate")
            }
            description={
              rep.tiesOut
                ? "The inventory subledger agrees with the ledger, which is the acceptance condition for inventory valuation."
                : "A difference means something moved inventory outside the subledger — for example a manual journal posted straight to the inventory account."
            }
          />
        </>
      )}
    </Space>
  );
}

/** Ant Design's Table summary row, kept readable. */
function DataTableSummaryTotal({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <th colSpan={4} style={{ textAlign: "right", padding: 8 }}>
        {label}
      </th>
      <th style={{ textAlign: "right", padding: 8 }}>{value}</th>
    </tr>
  );
}
