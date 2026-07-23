"use client";
import { useCallback, useEffect, useState } from "react";
import { App, DatePicker, Select, Space, Table, Tag, Typography } from "antd";
import type { Dayjs } from "dayjs";
import { fromMinor } from "@/lib/domain/money";
import { journalReportAction } from "./actions";
import type { JournalEntrySummary } from "@/lib/services/journal";

const SOURCES = [
  "invoice",
  "payment",
  "manual",
  "bank",
  "reconciliation",
  "opening_balance",
  "bill",
  "expense",
  "bill_payment",
  "tax_payment",
];

interface Props {
  baseCurrency: string;
  baseDecimals: number;
}

export default function JournalReportClient({ baseCurrency, baseDecimals }: Props) {
  const { message } = App.useApp();
  const [data, setData] = useState<JournalEntrySummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState<string>();
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const fmt = (m: number) => (m ? fromMinor(m, baseDecimals).toLocaleString(undefined, { minimumFractionDigits: baseDecimals }) : "");

  const load = useCallback(async () => {
    setLoading(true);
    const r = await journalReportAction({
      sourceType: source ?? null,
      from: range ? range[0].format("YYYY-MM-DD") : null,
      to: range ? range[1].format("YYYY-MM-DD") : null,
    });
    setLoading(false);
    if (r.ok && r.data) setData(r.data);
    else message.error(r.error ?? "Failed to load");
  }, [source, range, message]);

  // Data-synchronization effect: reload the report whenever the source or
  // date-range filter changes. load() flips a loading flag then fetches via a
  // server action — an intentional load, not derived render state.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="large">
      <Space wrap>
        <Select
          allowClear
          style={{ width: 200 }}
          placeholder="Source"
          value={source}
          onChange={setSource}
          options={SOURCES.map((s) => ({ value: s, label: s }))}
        />
        <DatePicker.RangePicker value={range} onChange={(v) => setRange(v && v[0] && v[1] ? [v[0], v[1]] : null)} />
      </Space>
      <Typography.Text type="secondary">Base currency {baseCurrency}</Typography.Text>
      <Table<JournalEntrySummary>
        rowKey="id"
        loading={loading}
        dataSource={data}
        scroll={{ x: "max-content" }}
        expandable={{
          expandedRowRender: (e) => (
            <Table
              size="small"
              rowKey={(_, i) => String(i)}
              pagination={false}
              dataSource={e.lines}
              columns={[
                { title: "Account", render: (_, l) => `${l.accountCode} ${l.accountName}` },
                { title: "Debit", align: "right", render: (_, l) => fmt(l.debitMinor) },
                { title: "Credit", align: "right", render: (_, l) => fmt(l.creditMinor) },
              ]}
            />
          ),
        }}
        columns={[
          { title: "Number", dataIndex: "entryNumber" },
          { title: "Date", dataIndex: "entryDate" },
          { title: "Source", dataIndex: "sourceType", render: (s: string) => <Tag>{s}</Tag> },
          { title: "Description", dataIndex: "description" },
          {
            title: "Status",
            render: (_, e) => (e.isReversed ? <Tag color="orange">reversed</Tag> : <Tag color="green">{e.status}</Tag>),
          },
        ]}
      />
    </Space>
  );
}
