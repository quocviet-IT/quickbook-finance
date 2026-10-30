"use client";
import { useCompanyClock } from "@/components/CompanyClock";
import { formatDateTime } from "@/lib/format";
import { useState } from "react";
import { App, Button, Checkbox, DatePicker, Input, Select, Space, Tag, Typography } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import FilterBar from "@/components/ui/FilterBar";
import TableEmpty from "@/components/ui/TableEmpty";
import DataTable from "@/components/ui/DataTable";
import { flexColumn } from "@/components/ui/columns";
import { COLUMN } from "@/lib/design/table-metrics";
import type { ActorRow, AuditEntryRow } from "@/lib/db/types";
import {
  auditTrailCsv,
  auditTrailFileName,
  diffAuditEntry,
  formatActor,
  formatAuditValue,
  summarizeAuditChanges,
  type AuditFieldChange,
} from "@/lib/domain/audit";
import { ACTIVITY_VERBS, auditEntityLabel } from "@/lib/domain/audit-entities";
import { downloadCsvFile } from "@/lib/client/report-export";
import { searchAuditAction } from "./actions";
import { clientTablePagination, pageSizeOptionsFor } from "@/components/ui/table-pagination";

const ACTIONS = ["insert", "update", "delete", "post", "void"];

// See table-pagination.ts for why this has to live in state rather than as a
// literal on `pagination`.
const AUDIT_DEFAULT_PAGE_SIZE = 25;

/**
 * When, Action, Record type. Actor, Record and Changed share what is left:
 * an email address, a record id and a summary of the fields are text somebody
 * else wrote, and the whole value is one hover away.
 */
export const AUDIT_FIXED_WIDTHS = [COLUMN.DATE_TIME, COLUMN.STATUS, COLUMN.PICKER] as const;
/** The floors of the three elastic columns, in order: Actor, Record, Changed. */
export const AUDIT_ELASTIC_FLOORS = [160, 120, COLUMN.TEXT_MIN] as const;

/** Field. Old value and New value share the rest of the opened entry. */
export const AUDIT_FIELD_CHANGES_FIXED_WIDTHS = [240] as const;

/**
 * A month is the unit an audit trail is reviewed in, so both the current and
 * the previous one are one click away rather than two date pickers.
 */
function monthPresets(today: string): { label: string; value: [Dayjs, Dayjs] }[] {
  const now = dayjs(today);
  const thisMonth = now.startOf("month");
  const lastMonth = thisMonth.subtract(1, "month");
  return [
    { label: "This month", value: [thisMonth, thisMonth.endOf("month")] },
    { label: "Last month", value: [lastMonth, lastMonth.endOf("month")] },
    { label: "Last 90 days", value: [now.subtract(90, "day"), now] },
  ];
}

export default function AuditClient({ tables, actors }: { tables: string[]; actors: ActorRow[] }) {
  const { message } = App.useApp();
  const { timeZone, today } = useCompanyClock();
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

  /** Back to an unfiltered page, ready to search again. */
  function clearFilters() {
    setTable(undefined);
    setAction(undefined);
    setActorId(undefined);
    setRecordId("");
    setRange(null);
    setRows([]);
    setRan(false);
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
          placeholder="Record type"
          style={{ width: 220 }}
          value={table}
          onChange={setTable}
          options={tables.map((t) => ({ value: t, label: auditEntityLabel(t) }))}
          aria-label="Filter by record type"
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
          options={ACTIONS.map((a) => ({ value: a, label: ACTIVITY_VERBS[a] ?? a }))}
          aria-label="Filter by action"
        />
        <Input
          placeholder="Record ID"
          style={{ width: 300 }}
          value={recordId}
          onChange={(e) => setRecordId(e.target.value)}
          aria-label="Filter by record id"
        />
        <DatePicker.RangePicker
          presets={monthPresets(today)}
          value={range}
          onChange={(v) => setRange(v as [Dayjs, Dayjs] | null)}
        />
        <Checkbox
          checked={includeHousekeeping}
          onChange={(e) => setIncludeHousekeeping(e.target.checked)}
        >
          Show last-edited fields
        </Checkbox>
      </FilterBar>

      <DataTable<AuditEntryRow>
        rowKey="id"
        rows={rows}
        loading={loading}
        pagination={clientTablePagination(pageSize, setPageSize, pageSizeOptionsFor(AUDIT_DEFAULT_PAGE_SIZE))}
        locale={{
          emptyText: ran ? (
            <TableEmpty
              loading={loading}
              title="No matching changes"
              description="Nothing in the audit log matches these filters. Clear one, or widen the dates."
              action={<Button onClick={clearFilters}>Clear filters</Button>}
            />
          ) : (
            <TableEmpty
              loading={loading}
              title="Search the audit history"
              description="Narrow it by record type, user, action or dates above, or show the latest changes now."
              action={<Button onClick={run}>Show the latest changes</Button>}
            />
          ),
        }}
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
            width: AUDIT_FIXED_WIDTHS[0],
            render: (v: string) => formatDateTime(v, timeZone),
          },
          flexColumn<AuditEntryRow>({
            title: "Actor",
            dataIndex: "actor_email",
            floor: AUDIT_ELASTIC_FLOORS[0],
            render: (v: string | null) => formatActor(v),
          }),
          {
            title: "Action",
            dataIndex: "action",
            width: AUDIT_FIXED_WIDTHS[1],
            render: (v: string) => <Tag>{ACTIVITY_VERBS[v] ?? v}</Tag>,
          },
          {
            title: "Record type",
            dataIndex: "table_name",
            width: AUDIT_FIXED_WIDTHS[2],
            render: (v: string) => auditEntityLabel(v),
          },
          flexColumn<AuditEntryRow>({
            title: "Record",
            dataIndex: "record_id",
            floor: AUDIT_ELASTIC_FLOORS[1],
            render: (v: string | null) => v ?? "—",
          }),
          flexColumn<AuditEntryRow>({
            title: "Changed",
            key: "changes",
            floor: AUDIT_ELASTIC_FLOORS[2],
            render: (_: unknown, r) =>
              summarizeAuditChanges(diffAuditEntry(r, { includeHousekeeping })),
          }),
        ]}
      />
    </Space>
  );
}

function FieldChanges({ changes }: { changes: AuditFieldChange[] }) {
  return (
    <DataTable<AuditFieldChange>
      rowKey="field"
      pagination={false}
      rows={changes}
      locale={{ emptyText: "No field changed" }}
      columns={[
        { title: "Field", dataIndex: "field", width: AUDIT_FIELD_CHANGES_FIXED_WIDTHS[0] },
        flexColumn<AuditFieldChange>({
          title: "Old value",
          dataIndex: "before",
          render: (v: string | null) => formatAuditValue(v),
        }),
        flexColumn<AuditFieldChange>({
          title: "New value",
          dataIndex: "after",
          render: (v: string | null) => formatAuditValue(v),
        }),
      ]}
    />
  );
}
