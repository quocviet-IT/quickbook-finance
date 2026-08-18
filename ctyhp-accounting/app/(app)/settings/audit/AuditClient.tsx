"use client";
import { useState } from "react";
import { App, Button, Checkbox, DatePicker, Input, Select, Space, Table, Tag, Typography } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import FilterBar from "@/components/ui/FilterBar";
import type { ActorRow, AuditEntryRow } from "@/lib/db/types";
import {
  auditTrailCsv,
  auditTrailFileName,
  diffAuditEntry,
  formatActor,
  formatAuditTimestamp,
  formatAuditValue,
  summarizeAuditChanges,
  type AuditFieldChange,
} from "@/lib/domain/audit";
import { downloadCsvFile } from "@/lib/client/report-export";
import { searchAuditAction } from "./actions";
import { clientTablePagination, pageSizeOptionsFor } from "@/components/ui/table-pagination";

const ACTIONS = ["insert", "update", "delete", "post", "void"];

// See table-pagination.ts for why this has to live in state rather than as a
// literal on `pagination`.
const AUDIT_DEFAULT_PAGE_SIZE = 25;

/**
 * A month is the unit an audit trail is reviewed in, so both the current and
 * the previous one are one click away rather than two date pickers.
 */
function monthPresets(): { label: string; value: [Dayjs, Dayjs] }[] {
  const thisMonth = dayjs().startOf("month");
  const lastMonth = thisMonth.subtract(1, "month");
  return [
    { label: "This month", value: [thisMonth, thisMonth.endOf("month")] },
    { label: "Last month", value: [lastMonth, lastMonth.endOf("month")] },
    { label: "Last 90 days", value: [dayjs().subtract(90, "day"), dayjs()] },
  ];
}

export default function AuditClient({ tables, actors }: { tables: string[]; actors: ActorRow[] }) {
  const { message } = App.useApp();
  const [rows, setRows] = useState<AuditEntryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [ran, setRan] = useState(false);
  const [table, setTable] = useState<string | undefined>();
  const [action, setAction] = useState<string | undefined>();
  const [actorId, setActorId] = useState<string | undefined>();
  const [recordId, setRecordId] = useState("");
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [includeHousekeeping, setIncludeHousekeeping] = useState(false);
  const [pageSize, setPageSize] = useState<number>(AUDIT_DEFAULT_PAGE_SIZE);

  const from = range ? range[0].format("YYYY-MM-DD") : null;
  const to = range ? range[1].format("YYYY-MM-DD") : null;

  async function run() {
    setLoading(true);
    const res = await searchAuditAction({
      table_name: table ?? null,
      record_id: recordId.trim() || null,
      actor_id: actorId ?? null,
      action: action ?? null,
      from,
      to,
      limit: 1000,
    });
    setLoading(false);
    setRan(true);
    if (res.ok && res.data) setRows(res.data);
    else message.error(res.error ?? "Failed to search the audit log");
  }

  /** Exports exactly what the search returned — one row per changed field. */
  function exportCsv() {
    if (rows.length === 0) {
      message.info("Search first — there is nothing to export yet");
      return;
    }
    downloadCsvFile(
      auditTrailCsv(rows, { includeHousekeeping }),
      auditTrailFileName({ from, to }),
    );
  }

  return (
    <Space direction="vertical" size="large" style={{ display: "flex" }}>
      <FilterBar
        resultCount={ran ? rows.length : undefined}
        ariaLabel="Audit history filters"
        actions={
          <Space>
            <Button icon={<DownloadOutlined />} disabled={rows.length === 0} onClick={exportCsv}>
              Export CSV
            </Button>
            <Button type="primary" loading={loading} onClick={run}>
              Search
            </Button>
          </Space>
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
          showSearch
          placeholder="User"
          style={{ width: 240 }}
          value={actorId}
          onChange={setActorId}
          optionFilterProp="label"
          options={actors.map((a) => ({
            value: a.id,
            label: a.full_name ? `${a.email} (${a.full_name})` : a.email,
          }))}
          aria-label="Filter by user"
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
        <DatePicker.RangePicker
          presets={monthPresets()}
          value={range}
          onChange={(v) => setRange(v as [Dayjs, Dayjs] | null)}
        />
        <Checkbox
          checked={includeHousekeeping}
          onChange={(e) => setIncludeHousekeeping(e.target.checked)}
        >
          Show update stamps
        </Checkbox>
      </FilterBar>

      <Table<AuditEntryRow>
        rowKey="id"
        dataSource={rows}
        loading={loading}
        pagination={clientTablePagination(pageSize, setPageSize, pageSizeOptionsFor(AUDIT_DEFAULT_PAGE_SIZE))}
        scroll={{ x: "max-content" }}
        locale={{ emptyText: ran ? "No matching audit entries" : "Set a filter and search" }}
        expandable={{
          expandedRowRender: (r) => (
            <Space direction="vertical" style={{ width: "100%" }}>
              <Typography.Text strong>Changed fields</Typography.Text>
              <FieldChanges changes={diffAuditEntry(r, { includeHousekeeping })} />
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
          {
            title: "When",
            dataIndex: "created_at",
            width: 170,
            render: (v: string) => formatAuditTimestamp(v),
          },
          {
            title: "Actor",
            dataIndex: "actor_email",
            width: 200,
            render: (v: string | null) => formatActor(v),
          },
          { title: "Action", dataIndex: "action", width: 90, render: (v: string) => <Tag>{v}</Tag> },
          { title: "Table", dataIndex: "table_name", width: 200 },
          {
            title: "Record",
            dataIndex: "record_id",
            width: 300,
            render: (v: string | null) => v ?? "—",
          },
          {
            title: "Changed",
            key: "changes",
            render: (_: unknown, r) =>
              summarizeAuditChanges(diffAuditEntry(r, { includeHousekeeping })),
          },
        ]}
      />
    </Space>
  );
}

function FieldChanges({ changes }: { changes: AuditFieldChange[] }) {
  return (
    <Table<AuditFieldChange>
      rowKey="field"
      size="small"
      pagination={false}
      dataSource={changes}
      locale={{ emptyText: "No field changed" }}
      columns={[
        { title: "Field", dataIndex: "field", width: 240 },
        {
          title: "Old value",
          dataIndex: "before",
          render: (v: string | null) => formatAuditValue(v),
        },
        {
          title: "New value",
          dataIndex: "after",
          render: (v: string | null) => formatAuditValue(v),
        },
      ]}
    />
  );
}
