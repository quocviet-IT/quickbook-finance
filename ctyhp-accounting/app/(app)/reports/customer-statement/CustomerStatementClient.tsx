"use client";
import { useState } from "react";
import { App, Button, DatePicker, Select, Space, Statistic, Typography } from "antd";
import type { Dayjs } from "dayjs";
import DataTable from "@/components/ui/DataTable";
import FilterBar from "@/components/ui/FilterBar";
import { fromMinor } from "@/lib/domain/money";
import { customerStatementAction } from "./actions";
import type { StatementReport, StatementRow } from "@/lib/services/ageing";

interface Customer {
  id: string;
  name: string;
}
interface Props {
  customers: Customer[];
  baseCurrency: string;
  baseDecimals: number;
}

export default function CustomerStatementClient({ customers, baseCurrency, baseDecimals }: Props) {
  const { message } = App.useApp();
  const [customerId, setCustomerId] = useState<string>();
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [rep, setRep] = useState<StatementReport | null>(null);
  const [loading, setLoading] = useState(false);
  const fmt = (m: number) => fromMinor(m, baseDecimals).toLocaleString(undefined, { minimumFractionDigits: baseDecimals });

  const run = async () => {
    if (!customerId || !range) {
      message.warning("Pick a customer and date range");
      return;
    }
    setLoading(true);
    const r = await customerStatementAction(customerId, range[0].format("YYYY-MM-DD"), range[1].format("YYYY-MM-DD"));
    setLoading(false);
    if (r.ok && r.data) setRep(r.data);
    else message.error(r.error ?? "Failed to load");
  };

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="large">
      <FilterBar
        resultCount={rep?.rows.length}
        ariaLabel="Customer statement filters"
        actions={
          <Button type="primary" loading={loading} onClick={run}>
            Run statement
          </Button>
        }
      >
        <Select
          showSearch
          style={{ width: 320 }}
          placeholder="Customer"
          optionFilterProp="label"
          value={customerId}
          options={customers.map((c) => ({ value: c.id, label: c.name }))}
          onChange={setCustomerId}
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
            emptyDescription="No customer transactions were found for this date range."
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
