"use client";
import { Alert, Select, Space, Table, Tag, Typography } from "antd";
import type { FieldSpec } from "@/lib/domain/import-mapping";

export interface ImportColumnsTableProps {
  fields: readonly FieldSpec[];
  headers: string[];
  /** Field key → column index in the file, or null when nothing is chosen. */
  mapping: Record<string, number | null>;
  unmapped: string[];
  /** Field keys the alias matcher could not place and the model proposed. */
  aiFields: string[];
  aiBusy: boolean;
  aiNote: string | null;
  onChange: (fieldKey: string, columnIndex: number | null) => void;
}

/**
 * Which column in the file is which field here.
 *
 * Lifted out of `ImportClient` — which was 413 lines against a 400-line ceiling —
 * so the guidance panel had somewhere to land. Every string, width and control
 * arrived unchanged from that file.
 */
export default function ImportColumnsTable({
  fields,
  headers,
  mapping,
  unmapped,
  aiFields,
  aiBusy,
  aiNote,
  onChange,
}: ImportColumnsTableProps) {
  return (
    <>
      <Typography.Title level={5} style={{ margin: 0 }}>
        Columns
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
        Proposed from the file&apos;s own headings. Change anything that is wrong — nothing is read
        until you do.
      </Typography.Paragraph>
      <Table
        size="small"
        rowKey="key"
        pagination={false}
        dataSource={fields.map((field) => ({ ...field }))}
        columns={[
          {
            title: "Field",
            dataIndex: "label",
            width: 200,
            render: (label: string, field) => (
              <Space size={6}>
                {label}
                {field.required ? <Tag color="red">required</Tag> : null}
              </Space>
            ),
          },
          {
            title: "Column in your file",
            key: "column",
            render: (_: unknown, field) => (
              <Select
                allowClear
                style={{ minWidth: 260 }}
                placeholder="Not imported"
                value={mapping[field.key] ?? undefined}
                onChange={(value) => onChange(field.key, value ?? null)}
                options={headers.map((header, index) => ({ value: index, label: header }))}
              />
            ),
          },
          {
            // Marks what the alias matcher could not place. These are the
            // columns worth a second look before importing.
            title: "",
            key: "source",
            width: 130,
            render: (_: unknown, field) =>
              aiFields.includes(field.key) ? <Tag color="purple">matched by AI</Tag> : null,
          },
          { title: "", dataIndex: "hint", render: (hint: string | undefined) => hint ?? "" },
        ]}
      />

      {aiBusy ? (
        <Typography.Text type="secondary">
          Asking the model about the columns it could not place by name…
        </Typography.Text>
      ) : null}

      {aiNote ? <Alert type="info" showIcon message={aiNote} /> : null}

      {unmapped.length > 0 ? (
        <Alert
          type="info"
          showIcon
          message={`${unmapped.length} column(s) in the file are not used: ${unmapped.join(", ")}`}
        />
      ) : null}
    </>
  );
}
