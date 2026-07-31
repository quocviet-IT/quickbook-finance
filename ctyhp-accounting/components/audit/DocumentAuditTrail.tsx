"use client";
import { Alert, Descriptions, Space, Table, Tag, Typography } from "antd";
import type { AuditEntryRow } from "@/lib/db/types";
import {
  diffAuditEntry,
  documentAttribution,
  formatActor,
  formatAuditTimestamp,
  formatAuditValue,
  summarizeAuditChanges,
  type AttributionSource,
  type AuditFieldChange,
} from "@/lib/domain/audit";

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

  return (
    <Space direction="vertical" size="middle" style={{ display: "flex", marginBottom: 16 }}>
      <Descriptions size="small" column={2} bordered items={[
        { key: "created_by", label: "Created by", children: attribution.createdBy },
        {
          key: "created_at",
          label: "Created",
          children: formatAuditTimestamp(attribution.createdAt),
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
            ? formatAuditTimestamp(attribution.modifiedAt)
            : "Not modified since it was created",
        },
      ]} />

      {canReadAudit ? (
        <div>
          <Typography.Text strong>Change history</Typography.Text>
          <Table<AuditEntryRow>
            rowKey="id"
            size="small"
            style={{ marginTop: 8 }}
            loading={loading}
            dataSource={entries}
            pagination={entries.length > 10 ? { pageSize: 10 } : false}
            locale={{ emptyText: "No recorded change" }}
            expandable={{
              rowExpandable: (entry) => diffAuditEntry(entry).length > 0,
              expandedRowRender: (entry) => <FieldChanges changes={diffAuditEntry(entry)} />,
            }}
            columns={[
              {
                title: "When",
                dataIndex: "created_at",
                width: 170,
                render: (value: string) => formatAuditTimestamp(value),
              },
              {
                title: "Who",
                dataIndex: "actor_email",
                width: 200,
                render: (value: string | null) => formatActor(value),
              },
              {
                title: "Action",
                dataIndex: "action",
                width: 90,
                render: (value: string) => <Tag>{value}</Tag>,
              },
              {
                title: "Changed",
                key: "changes",
                render: (_: unknown, entry) => summarizeAuditChanges(diffAuditEntry(entry)),
              },
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
    <Table<AuditFieldChange>
      rowKey="field"
      size="small"
      pagination={false}
      dataSource={changes}
      columns={[
        { title: "Field", dataIndex: "field", width: 220 },
        {
          title: "Old value",
          dataIndex: "before",
          render: (value: string | null) => formatAuditValue(value),
        },
        {
          title: "New value",
          dataIndex: "after",
          render: (value: string | null) => formatAuditValue(value),
        },
      ]}
    />
  );
}
