"use client";
import { useState } from "react";
import { App, Button, DatePicker, Select, Space, Statistic, Typography } from "antd";
import type { Dayjs } from "dayjs";
import DataTable from "@/components/ui/DataTable";
import FilterBar from "@/components/ui/FilterBar";
import { fromMinor } from "@/lib/domain/money";
import { vendorStatementAction } from "./actions";
import type { StatementReport, StatementRow } from "@/lib/services/ageing";

interface Vendor {
  id: string;
  name: string;
}
interface Props {
  vendors: Vendor[];
  baseCurrency: string;
  baseDecimals: number;
}

export default function VendorStatementClient({ vendors, baseCurrency, baseDecimals }: Props) {
  const { message } = App.useApp();
  const [vendorId, setVendorId] = useState<string>();
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [rep, setRep] = useState<StatementReport | null>(null);
  const [loading, setLoading] = useState(false);
  const fmt = (m: number) => fromMinor(m, baseDecimals).toLocaleString(undefined, { minimumFractionDigits: baseDecimals });

  const run = async () => {
    if (!vendorId || !range) {
      message.warning("Pick a vendor and date range");
      return;
    }
    setLoading(true);
    const r = await vendorStatementAction(vendorId, range[0].format("YYYY-MM-DD"), range[1].format("YYYY-MM-DD"));
    setLoading(false);
    if (r.ok && r.data) setRep(r.data);
    else message.error(r.error ?? "Failed to load");
  };

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="large">
      <FilterBar
        resultCount={rep?.rows.length}
        ariaLabel="Vendor statement filters"
        actions={
          <Button type="primary" loading={loading} onClick={run}>
            Run statement
          </Button>
        }
      >
        <Select
          showSearch
          style={{ width: 320 }}
          placeholder="Vendor"
          optionFilterProp="label"
          value={vendorId}
          options={vendors.map((v) => ({ value: v.id, label: v.name }))}
          onChange={setVendorId}
        />
        <DatePicker.RangePicker value={range} onChange={(v) => v && setRange([v[0]!, v[1]!])} />
      </FilterBar>
      {rep && (
        <>
          <Typography.Text type="secondary">Base currency {baseCurrency} · Accrual basis</Typography.Text>
          <Typography.Text type="secondary">
            Opening balance reflects current open items dated before the period (historical point-in-time statements
            are a later enhancement).
          </Typography.Text>
          <Space size="large">
            <Statistic title="Opening balance" value={fmt(rep.openingMinor)} />
            <Statistic title="Closing balance" value={fmt(rep.closingMinor)} />
          </Space>
          <DataTable<StatementRow>
            rowKey={(r) => `${r.docType}-${r.docNumber}-${r.txnDate}`}
            dataSource={rep.rows}
            pagination={false}
            loading={loading}
            emptyTitle="No statement activity"
            emptyDescription="No vendor transactions were found for this date range."
            columns={[
              { title: "Date", dataIndex: "txnDate" },
              { title: "Type", dataIndex: "docType" },
              { title: "Number", dataIndex: "docNumber" },
              { title: "Amount", align: "right", render: (_, r) => fmt(r.amountMinor) },
              { title: "Running", align: "right", render: (_, r) => fmt(r.runningMinor) },
            ]}
          />
        </>
      )}
    </Space>
  );
}
