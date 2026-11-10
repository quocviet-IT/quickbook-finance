"use client";
import { useCompanyClock } from "@/components/CompanyClock";
import { formatDateTime } from "@/lib/format";
import { useState, type CSSProperties } from "react";
import { Alert, Descriptions, Space, Tag, Typography } from "antd";
import type { AuditEntryRow } from "@/lib/db/types";
import {
  auditDisplayValue,
  auditEntryCurrency,
  diffAuditEntry,
  documentAttribution,
  formatActor,
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
          <ChangeHistoryTable entries={entries} loading={loading} style={{ marginTop: 8 }} />
        </div>
      ) : (
        <ChangeHistoryUnavailable />
      )}
    </Space>
  );
}

/**
 * Every change the audit log holds for one record: when, who, what kind of
 * change and a one-line summary, each row opening onto its fields one by one.
 * A document's dialog shows it under its attribution; a customer's page shows
 * it as its Activity tab (3.0.12).
 */
export function ChangeHistoryTable({
  entries,
  loading,
  currencyFallback,
  style,
}: {
  entries: AuditEntryRow[];
  loading: boolean;
  /**
   * The currency to read amounts in when an entry's snapshot names none. A
   * customer's record carries no currency of its own, but its credit limit is
   * in dollars.
   */
  currencyFallback?: string;
  style?: CSSProperties;
}) {
  const [pageSize, setPageSize] = useState<number>(CHANGE_HISTORY_DEFAULT_PAGE_SIZE);
  const { timeZone } = useCompanyClock();
  const currencyOf = (entry: AuditEntryRow) => auditEntryCurrency(entry) ?? currencyFallback ?? null;

  return (
    <DataTable<AuditEntryRow>
      rowKey="id"
      style={style}
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
        expandedRowRender: (entry) => (
          <FieldChanges changes={diffAuditEntry(entry)} currencyCode={currencyOf(entry)} />
        ),
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
          // Amounts are stored in cents; read them as money in the
          // document's own currency, not as 2680000 (3.0.8).
          render: (_: unknown, entry) =>
            summarizeAuditChanges(diffAuditEntry(entry), 3, currencyOf(entry)),
        }),
      ]}
    />
  );
}

/** What a role without audit.read sees where the change history would be. */
export function ChangeHistoryUnavailable({ subject = "this document" }: { subject?: string }) {
  return (
    <Alert
      type="info"
      showIcon
      title="Your role cannot read the change history"
      description={`Ask an administrator for the audit.read permission to see every change made to ${subject}.`}
    />
  );
}

function FieldChanges({ changes, currencyCode }: { changes: AuditFieldChange[]; currencyCode: string | null }) {
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
          render: (value: string | null, change: AuditFieldChange) =>
            auditDisplayValue(change.field, value, currencyCode),
        }),
        flexColumn<AuditFieldChange>({
          title: "New value",
          dataIndex: "after",
          render: (value: string | null, change: AuditFieldChange) =>
            auditDisplayValue(change.field, value, currencyCode),
        }),
      ]}
    />
  );
}
