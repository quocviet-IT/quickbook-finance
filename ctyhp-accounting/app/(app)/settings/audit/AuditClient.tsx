"use client";
import { useState } from "react";
import { App, Button, DatePicker, Input, Select, Space, Table, Tag, Typography } from "antd";
import type { Dayjs } from "dayjs";
import FilterBar from "@/components/ui/FilterBar";
import type { AuditEntryRow } from "@/lib/db/types";
import { searchAuditAction } from "./actions";

const ACTIONS = ["insert", "update", "delete", "post", "void"];

export default function AuditClient({ tables }: { tables: string[] }) {
  const { message } = App.useApp();
  const [rows, setRows] = useState<AuditEntryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [ran, setRan] = useState(false);
  const [table, setTable] = useState<string | undefined>();
  const [action, setAction] = useState<string | undefined>();
  const [recordId, setRecordId] = useState("");
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);

  async function run() {
    setLoading(true);
    const res = await searchAuditAction({
      table_name: table ?? null,
      record_id: recordId.trim() || null,
      actor_id: null,
      action: action ?? null,
      from: range ? range[0].format("YYYY-MM-DD") : null,
      to: range ? range[1].format("YYYY-MM-DD") : null,
      limit: 200,
    });
    setLoading(false);
    setRan(true);
    if (res.ok && res.data) setRows(res.data);
    else message.error(res.error ?? "Failed to search the audit log");
  }

  return (
    <Space direction="vertical" size="large" style={{ display: "flex" }}>
      <FilterBar
        resultCount={ran ? rows.length : undefined}
        ariaLabel="Audit history filters"
        actions={
          <Button type="primary" loading={loading} onClick={run}>
            Search
          </Button>
        }
      >
        <Select
          allowClear
          showSearch
          placeholder="Table"
          style={{ width: 220 }}
          value={table}
          onChange={setTable}
          options={tables.map((t) => ({ value: t, label: t }))}
          aria-label="Filter by table"
        />
        <Select
          allowClear
          placeholder="Action"
          style={{ width: 140 }}
          value={action}
          onChange={setAction}
          options={ACTIONS.map((a) => ({ value: a, label: a }))}
          aria-label="Filter by action"
        />
        <Input
          placeholder="Record id"
          style={{ width: 300 }}
          value={recordId}
          onChange={(e) => setRecordId(e.target.value)}
          aria-label="Filter by record id"
        />
        <DatePicker.RangePicker value={range} onChange={(v) => setRange(v as [Dayjs, Dayjs] | null)} />
      </FilterBar>

      <Table<AuditEntryRow>
        rowKey="id"
        dataSource={rows}
        loading={loading}
        pagination={{ pageSize: 25 }}
        scroll={{ x: "max-content" }}
        locale={{ emptyText: ran ? "No matching audit entries" : "Set a filter and search" }}
        expandable={{
          expandedRowRender: (r) => (
            <Space direction="vertical" style={{ width: "100%" }}>
              <Typography.Text strong>Before</Typography.Text>
              <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                {r.before_json ? JSON.stringify(r.before_json, null, 2) : "—"}
              </pre>
              <Typography.Text strong>After</Typography.Text>
              <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                {r.after_json ? JSON.stringify(r.after_json, null, 2) : "—"}
              </pre>
            </Space>
          ),
        }}
        columns={[
          { title: "When", dataIndex: "created_at", render: (v: string) => v.slice(0, 19).replace("T", " ") },
          { title: "Actor", dataIndex: "actor_email", render: (v: string | null) => v ?? "system" },
          { title: "Action", dataIndex: "action", render: (v: string) => <Tag>{v}</Tag> },
          { title: "Table", dataIndex: "table_name" },
          { title: "Record", dataIndex: "record_id", render: (v: string | null) => v ?? "—" },
        ]}
      />
    </Space>
  );
}
