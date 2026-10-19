"use client";
import { useEffect, useMemo, useState } from "react";
import { Alert, App, Space, Typography } from "antd";
import DataTable from "@/components/ui/DataTable";
import ReportBar from "@/components/reports/ReportBar";
import { useCompanyClock } from "@/components/CompanyClock";
import { formatDate, formatMoney } from "@/lib/format";
import type { InventoryValuationRow } from "@/lib/db/types";
import type { InventoryValuation } from "@/lib/services/inventory";
import { METHOD_LABEL } from "@/lib/domain/inventory-review";
import { fromMinor } from "@/lib/domain/money";
import { sanitizeExportFileName, type ReportExportSheet } from "@/lib/domain/report-export";
import { inventoryValuationAction } from "./actions";

/** The valuation as the screen shows it: one line per tracked item, then the total. */
function valuationSheet(
  rep: InventoryValuation,
  companyName: string,
  currencyCode: string,
  decimals: number,
): ReportExportSheet {
  return {
    fileName: sanitizeExportFileName(`inventory-valuation-${rep.asOf}`),
    companyName,
    title: "Inventory Valuation",
    subtitle: `As of ${formatDate(rep.asOf)}`,
    currencyCode,
    columns: [
      { key: "code", header: "Code", kind: "text" },
      { key: "item", header: "Item", kind: "text" },
      { key: "qty", header: "Quantity on hand", kind: "number" },
      { key: "unit", header: "Unit cost", kind: "money" },
      { key: "value", header: "Value", kind: "money" },
    ],
    rows: [
      ...rep.rows.map((row) => ({
        code: row.item_code ?? "",
        item: row.name,
        qty: Number(row.qty_on_hand),
        unit: fromMinor(Number(row.unit_cost_minor), decimals),
        value: fromMinor(Number(row.value_minor), decimals),
      })),
      {
        code: "",
        item: "Total inventory value",
        qty: null,
        unit: null,
        value: fromMinor(rep.subledgerValueMinor, decimals),
      },
    ],
  };
}

export default function InventoryValuationClient({
  baseCurrency,
  baseDecimals,
  companyName,
  valuationMethod,
  policyMemo,
}: {
  baseCurrency: string;
  baseDecimals: number;
  companyName: string;
  /** Read from the company's accounting policy, never hardcoded here. */
  valuationMethod: string;
  policyMemo: string | null;
}) {
  const { message } = App.useApp();
  const { today } = useCompanyClock();
  const [asOf, setAsOf] = useState(today);
  const [rep, setRep] = useState<InventoryValuation | null>(null);
  const [loading, setLoading] = useState(true);

  const fmt = (m: number) => formatMoney(m, baseCurrency, baseDecimals);

  async function run() {
    setLoading(true);
    const r = await inventoryValuationAction({ as_of: asOf });
    setLoading(false);
    if (r.ok && r.data) setRep(r.data);
    else message.error(r.error ?? "Failed to run the report");
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void run();
    // Runs once on arrival; afterwards the date and Run report do it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sheet = useMemo(
    () => (rep ? valuationSheet(rep, companyName, baseCurrency, baseDecimals) : null),
    [rep, companyName, baseCurrency, baseDecimals],
  );

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="large">
      <ReportBar
        dates={{ kind: "asOf", to: asOf, onTo: setAsOf }}
        onRun={() => void run()}
        loading={loading}
        sheet={sheet}
        resultCount={rep ? rep.rows.length : undefined}
      />

      {rep && (
        <div className="report-print-area">
        <Space direction="vertical" style={{ width: "100%" }} size="large">
          <Alert
            type="info"
            showIcon
            message={
              <>
                Measured at <b>{METHOD_LABEL[valuationMethod] ?? valuationMethod}</b>, at the lower
                of cost and net realizable value (ASC 330-10-35-1B). Base currency {baseCurrency},
                as of {formatDate(rep.asOf)}.
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
              `Subledger ${fmt(rep.subledgerValueMinor)} vs inventory control accounts ${fmt(rep.controlBalanceMinor)}` +
              (rep.tiesOut ? " ✓ reconciled" : " — does not reconcile, investigate")
            }
            description={
              rep.tiesOut
                ? "The inventory subledger agrees with the ledger, which is the acceptance condition for inventory valuation."
                : "A difference means something moved inventory outside the subledger — for example a manual journal posted straight to the inventory account."
            }
          />
        </Space>
        </div>
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
