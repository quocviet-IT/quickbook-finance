"use client";
import { plural, pluralWord } from "@/lib/format";
import { Alert, Select, Space, Tag, Typography } from "antd";
import type { FieldSpec } from "@/lib/domain/import-mapping";
import DataTable from "@/components/ui/DataTable";
import { flexColumn } from "@/components/ui/columns";
import { COLUMN } from "@/lib/design/table-metrics";

/**
 * Field, then the "Matched by AI" mark. The rows are the fields One Book
 * imports, fixed by design, so the table is fitted; it is the file's headings
 * that are data, and they sit inside the picker. Column in your file and the
 * hint share what is left: the picker is 260px wide, so its column floors at
 * 276, and the hint is free text at COLUMN.TEXT_MIN.
 */
export const IMPORT_COLUMNS_FIXED_WIDTHS = [200, COLUMN.STATUS] as const;
/** The floors of Column in your file and the hint, in that order. */
export const IMPORT_COLUMNS_ELASTIC_FLOORS = [276, COLUMN.TEXT_MIN] as const;

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
      <DataTable<FieldSpec>
        rowKey="key"
        pagination={false}
        rows={fields.map((field) => ({ ...field }))}
        columns={[
          {
            title: "Field",
            dataIndex: "label",
            width: IMPORT_COLUMNS_FIXED_WIDTHS[0],
            render: (label: string, field) => (
              <Space size={6}>
                {label}
                {field.required ? <Tag color="red">Required</Tag> : null}
              </Space>
            ),
          },
          flexColumn<FieldSpec>({
            title: "Column in your file",
            key: "column",
            floor: IMPORT_COLUMNS_ELASTIC_FLOORS[0],
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
          }),
          {
            // Marks what the alias matcher could not place. These are the
            // columns worth a second look before importing.
            title: "",
            key: "source",
            width: IMPORT_COLUMNS_FIXED_WIDTHS[1],
            render: (_: unknown, field) =>
              aiFields.includes(field.key) ? <Tag color="purple">Matched by AI</Tag> : null,
          },
          flexColumn<FieldSpec>({
            title: "",
            dataIndex: "hint",
            floor: IMPORT_COLUMNS_ELASTIC_FLOORS[1],
            render: (hint: string | undefined) => hint ?? "",
          }),
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
          message={`${plural(unmapped.length, "column")} in the file ${pluralWord(unmapped.length, "is", "are")} not used: ${unmapped.join(", ")}`}
        />
      ) : null}
    </>
  );
}
