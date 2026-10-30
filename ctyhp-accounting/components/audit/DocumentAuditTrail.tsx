"use client";
import { useCompanyClock } from "@/components/CompanyClock";
import { formatDateTime } from "@/lib/format";
import { useState } from "react";
import { Alert, Descriptions, Space, Tag, Typography } from "antd";
import type { AuditEntryRow } from "@/lib/db/types";
import {
  diffAuditEntry,
  documentAttribution,
  formatActor,
  formatAuditValue,
  summarizeAuditChanges,
  type AttributionSource,
  type AuditFieldChange,
} from "@/lib/domain/audit";
import { humanizeStatus } from "@/lib/domain/status-label";
import { ACTIVITY_VERBS } from "@/lib/domain/audit-entities";
import { clientTablePagination, pageSizeOptionsFor } from "@/components/ui/table-pagination";
import DataTable from "@/components/ui/DataTable";
import { flexColumn } from "@/components/ui/columns";
import { COLUMN } from "@/lib/design/table-metrics";

// See table-pagination.ts for why this has to live in state rather than as a
// literal on `pagination`.
const CHANGE_HISTORY_DEFAULT_PAGE_SIZE = 10;

/**
 * When, Action. Who and Changed share what is left. Action is a one-word verb
 * tag ("Recode undone" is the longest), so it takes less than a status tag.
 */
export const DOCUMENT_AUDIT_TRAIL_FIXED_WIDTHS = [COLUMN.DATE_TIME, 100] as const;
/** The floors of Who and Changed, in that order. */
export const DOCUMENT_AUDIT_TRAIL_ELASTIC_FLOORS = [160, COLUMN.TEXT_MIN] as const;
/** Field. Old value and New value share the rest of the opened entry. */
export const DOCUMENT_AUDIT_FIELD_CHANGES_FIXED_WIDTHS = [220] as const;
/**
 * The narrowest box the trail is drawn in: the 720px payment drawer, less the
 * 24px of padding either side. The invoice dialog is wider.
 */
export const DOCUMENT_AUDIT_TRAIL_BOX = 720 - 48;

/**
 * Who made a document, who touched it last, and every change the database
 * recorded in between. Shown on the document itself so an auditor never has to
 * reconstruct its history from the audit page by record id.
 */
export default function DocumentAuditTrail({
  record,
  directory,
  entries,
  loading,
  canReadAudit,
}: {
  record: AttributionSource;
  /** User id → email, from `acc_actor_directory`. */
  directory: ReadonlyMap<string, string>;
  entries: AuditEntryRow[];
  loading: boolean;
  canReadAudit: boolean;
}) {
  const attribution = documentAttribution(record, directory);
  const [pageSize, setPageSize] = useState<number>(CHANGE_HISTORY_DEFAULT_PAGE_SIZE);
  const { timeZone } = useCompanyClock();

  return (
    <Space direction="vertical" size="middle" style={{ display: "flex", marginBottom: 16 }}>
      <Descriptions size="small" column={2} bordered items={[
        { key: "created_by", label: "Created by", children: attribution.createdBy },
        {
          key: "created_at",
          label: "Created",
          children: formatDateTime(attribution.createdAt, timeZone),
        },
        {
          key: "modified_by",
          label: "Last modified by",
          children: attribution.modifiedBy ?? "—",
        },
        {
          key: "modified_at",
          label: "Last modified",
          children: attribution.modifiedAt
            ? formatDateTime(attribution.modifiedAt, timeZone)
            : "Not modified since it was created",
        },
      ]} />

      {canReadAudit ? (
        <div>
          <Typography.Text strong>Change history</Typography.Text>
          <DataTable<AuditEntryRow>
            rowKey="id"
            style={{ marginTop: 8 }}
            loading={loading}
            rows={entries}
            pagination={
              entries.length > 10
                ? clientTablePagination(
                    pageSize,
                    setPageSize,
                    pageSizeOptionsFor(CHANGE_HISTORY_DEFAULT_PAGE_SIZE),
                  )
                : false
            }
            locale={{ emptyText: "No recorded change" }}
            expandable={{
              rowExpandable: (entry) => diffAuditEntry(entry).length > 0,
              expandedRowRender: (entry) => <FieldChanges changes={diffAuditEntry(entry)} />,
            }}
            columns={[
              {
                title: "When",
                dataIndex: "created_at",
                width: DOCUMENT_AUDIT_TRAIL_FIXED_WIDTHS[0],
                render: (value: string) => formatDateTime(value, timeZone),
              },
              flexColumn<AuditEntryRow>({
                title: "Who",
                dataIndex: "actor_email",
                floor: DOCUMENT_AUDIT_TRAIL_ELASTIC_FLOORS[0],
                render: (value: string | null) => formatActor(value),
              }),
              {
                title: "Action",
                dataIndex: "action",
                width: DOCUMENT_AUDIT_TRAIL_FIXED_WIDTHS[1],
                render: (value: string) => <Tag>{ACTIVITY_VERBS[value] ?? humanizeStatus(value)}</Tag>,
              },
              flexColumn<AuditEntryRow>({
                title: "Changed",
                key: "changes",
                floor: DOCUMENT_AUDIT_TRAIL_ELASTIC_FLOORS[1],
                render: (_: unknown, entry) => summarizeAuditChanges(diffAuditEntry(entry)),
              }),
            ]}
          />
        </div>
      ) : (
        <Alert
          type="info"
          showIcon
          message="Your role cannot read the change history"
          description="Ask an administrator for the audit.read permission to see every change made to this document."
        />
      )}
    </Space>
  );
}

function FieldChanges({ changes }: { changes: AuditFieldChange[] }) {
  return (
    <DataTable<AuditFieldChange>
      rowKey="field"
      pagination={false}
      rows={changes}
      columns={[
        { title: "Field", dataIndex: "field", width: DOCUMENT_AUDIT_FIELD_CHANGES_FIXED_WIDTHS[0] },
        flexColumn<AuditFieldChange>({
          title: "Old value",
          dataIndex: "before",
          render: (value: string | null) => formatAuditValue(value),
        }),
        flexColumn<AuditFieldChange>({
          title: "New value",
          dataIndex: "after",
          render: (value: string | null) => formatAuditValue(value),
        }),
      ]}
    />
  );
}
