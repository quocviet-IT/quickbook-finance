"use client";
import { useEffect, useState } from "react";
import {
  Alert,
  App,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Segmented,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import DataTable from "@/components/ui/DataTable";
import FilterBar from "@/components/ui/FilterBar";
import { downloadCsvFile } from "@/lib/client/report-export";
import { csvWithReportIdentity } from "@/lib/domain/report-export";
import {
  describeSequenceIntegrity,
  sequenceCsv,
  sequenceCsvFileName,
  sequenceStateLabel,
  totalUnexplained,
  type SequenceAudit,
  type SequenceDefinition,
  type SequenceRow,
} from "@/lib/domain/sequence";
import {
  recordGapNoteAction,
  sequenceAuditAction,
  sequenceOverviewAction,
} from "./actions";

type View = "breaks" | "all";

const STATE_COLOR: Record<SequenceRow["state"], string> = {
  present: "default",
  missing: "red",
  beyond_sequence: "volcano",
};

export default function NumberSequenceClient({
  catalog,
  canDocumentGaps,
  companyName,
}: {
  catalog: SequenceDefinition[];
  canDocumentGaps: boolean;
  /** Whose books the exported file belongs to. */
  companyName: string;
}) {
  const { message } = App.useApp();
  const [sequenceKey, setSequenceKey] = useState<string>(
    catalog.find((row) => row.sequence_key === "invoice")?.sequence_key ??
      catalog[0]?.sequence_key ??
      "",
  );
  // Both loading flags are derived rather than stored: the overview is loading
  // until it arrives, and the detail is loading until the one held matches the
  // document type selected.
  const [overview, setOverview] = useState<SequenceAudit[] | null>(null);
  const [detail, setDetail] = useState<{ key: string; audit: SequenceAudit } | null>(null);
  const [view, setView] = useState<View>("breaks");
  const [noteFor, setNoteFor] = useState<SequenceRow | null>(null);
  const [noteForm] = Form.useForm();
  const [savingNote, setSavingNote] = useState(false);

  const overviewLoading = overview === null;
  const audit = detail?.key === sequenceKey ? detail.audit : null;
  const loading = Boolean(sequenceKey) && audit === null;

  useEffect(() => {
    let live = true;
    sequenceOverviewAction().then((res) => {
      if (!live) return;
      if (res.ok && res.data) setOverview(res.data);
      else {
        setOverview([]);
        message.error(res.error ?? "Failed to read the document sequences");
      }
    });
    return () => {
      live = false;
    };
  }, [message]);

  useEffect(() => {
    if (!sequenceKey) return;
    let live = true;
    sequenceAuditAction(sequenceKey).then((res) => {
      if (!live) return;
      if (res.ok && res.data) setDetail({ key: sequenceKey, audit: res.data });
      else message.error(res.error ?? "Failed to read the sequence");
    });
    return () => {
      live = false;
    };
  }, [sequenceKey, message]);

  async function refresh() {
    const [detailResult, all] = await Promise.all([
      sequenceAuditAction(sequenceKey),
      sequenceOverviewAction(),
    ]);
    if (detailResult.ok && detailResult.data) {
      setDetail({ key: sequenceKey, audit: detailResult.data });
    }
    if (all.ok && all.data) setOverview(all.data);
  }

  async function saveNote() {
    if (!noteFor || !audit) return;
    const values = await noteForm.validateFields();
    setSavingNote(true);
    const res = await recordGapNoteAction({
      sequenceKey: audit.definition.sequence_key,
      numberValue: noteFor.value,
      reason: values.reason,
    });
    setSavingNote(false);
    if (!res.ok) {
      message.error(res.error ?? "Failed to record the reason");
      return;
    }
    message.success(`${noteFor.number} documented`);
    setNoteFor(null);
    noteForm.resetFields();
    await refresh();
  }

  const openBreaks = totalUnexplained(overview ?? []);
  const rows = audit
    ? view === "breaks"
      ? audit.rows.filter((row) => row.state !== "present")
      : audit.rows
    : [];

  return (
    <Space direction="vertical" size="large" style={{ display: "flex" }}>
      {!overviewLoading && (
        <Alert
          type={openBreaks === 0 ? "success" : "error"}
          showIcon
          message={
            openBreaks === 0
              ? "Every issued number is accounted for"
              : `${openBreaks} number${openBreaks === 1 ? "" : "s"} across all document types ${
                  openBreaks === 1 ? "is" : "are"
                } unaccounted for`
          }
          description={
            openBreaks === 0
              ? "No document type has a break in its numbering that nobody has explained."
              : "A number the system issued is on no document. Investigate it, then record why it is missing so the exception closes."
          }
        />
      )}

      <Card size="small" title="All document types">
        <Table<SequenceAudit>
          rowKey={(row) => row.definition.sequence_key}
          size="small"
          loading={overviewLoading}
          dataSource={overview ?? []}
          pagination={false}
          onRow={(row) => ({
            onClick: () => setSequenceKey(row.definition.sequence_key),
            style: { cursor: "pointer" },
          })}
          columns={[
            { title: "Document type", render: (_: unknown, row) => row.definition.label },
            { title: "Prefix", width: 100, render: (_: unknown, row) => row.definition.prefix },
            {
              title: "Issued",
              width: 100,
              align: "right",
              render: (_: unknown, row) => row.summary.allocated,
            },
            {
              title: "On file",
              width: 100,
              align: "right",
              render: (_: unknown, row) => row.summary.present,
            },
            {
              title: "Explained gaps",
              width: 140,
              align: "right",
              render: (_: unknown, row) => row.summary.explained,
            },
            {
              title: "Unaccounted for",
              width: 150,
              align: "right",
              render: (_: unknown, row) => {
                const open = row.summary.unexplained + row.summary.beyondSequence;
                return open === 0 ? (
                  <Tag color="green">0</Tag>
                ) : (
                  <Tag color="red">{open}</Tag>
                );
              },
            },
            {
              title: "Next number",
              width: 160,
              render: (_: unknown, row) => row.summary.nextNumber,
            },
          ]}
        />
      </Card>

      <FilterBar
        resultCount={rows.length}
        ariaLabel="Document sequence filters"
        actions={
          <Button
            icon={<DownloadOutlined />}
            disabled={!audit || audit.rows.length === 0}
            onClick={() => {
              if (!audit) return;
              downloadCsvFile(
                csvWithReportIdentity(sequenceCsv(audit), {
                  companyName,
                  title: "Document Number Sequence",
                  subtitle: audit.definition.label,
                  currencyCode: "USD",
                }),
                sequenceCsvFileName(audit),
              );
            }}
          >
            Export CSV
          </Button>
        }
      >
        <Select
          style={{ width: 240 }}
          value={sequenceKey}
          onChange={setSequenceKey}
          options={catalog.map((row) => ({ value: row.sequence_key, label: row.label }))}
          aria-label="Document type"
        />
        <Segmented
          value={view}
          onChange={(value) => setView(value as View)}
          options={[
            { label: "Breaks only", value: "breaks" },
            { label: "Every number", value: "all" },
          ]}
        />
      </FilterBar>

      {audit ? (
        <>
          <Space size="large" wrap>
            <Statistic title="Issued so far" value={audit.summary.allocated} />
            <Statistic title="On file" value={audit.summary.present} />
            <Statistic title="Missing" value={audit.summary.missing} />
            <Statistic
              title="Unaccounted for"
              value={audit.summary.unexplained + audit.summary.beyondSequence}
              valueStyle={
                audit.summary.unexplained + audit.summary.beyondSequence > 0
                  ? { color: "#cf1322" }
                  : undefined
              }
            />
            <Statistic title="Next number" value={audit.summary.nextNumber} />
          </Space>

          {describeSequenceIntegrity(audit) ? (
            <Alert type="warning" showIcon message={describeSequenceIntegrity(audit)} />
          ) : null}
        </>
      ) : null}

      <DataTable<SequenceRow>
        rowKey="value"
        loading={loading}
        dataSource={rows}
        columns={[
          { title: "Number", dataIndex: "number", width: 180 },
          {
            title: "State",
            dataIndex: "state",
            width: 180,
            render: (state: SequenceRow["state"]) => (
              <Tag color={STATE_COLOR[state]}>{sequenceStateLabel(state)}</Tag>
            ),
          },
          { title: "Date", dataIndex: "documentDate", width: 130, render: (v: string | null) => v ?? "—" },
          {
            title: "Status",
            dataIndex: "documentStatus",
            width: 130,
            render: (v: string | null) => v ?? "—",
          },
          {
            title: "Documented reason",
            key: "note",
            render: (_: unknown, row) =>
              row.note ? (
                <Typography.Text>{row.note.reason}</Typography.Text>
              ) : row.state === "present" ? (
                "—"
              ) : (
                <Typography.Text type="danger">Not explained</Typography.Text>
              ),
          },
          ...(canDocumentGaps
            ? [
                {
                  title: "Action",
                  key: "action",
                  width: 150,
                  render: (_: unknown, row: SequenceRow) =>
                    row.state === "present" ? null : (
                      <Button
                        size="small"
                        onClick={() => {
                          setNoteFor(row);
                          noteForm.setFieldsValue({ reason: row.note?.reason ?? "" });
                        }}
                      >
                        {row.note ? "Edit reason" : "Explain"}
                      </Button>
                    ),
                },
              ]
            : []),
        ]}
        emptyTitle={view === "breaks" ? "No break in this sequence" : "No number issued yet"}
        emptyDescription={
          view === "breaks"
            ? "Every number this sequence has issued is on a document."
            : "This document type has not issued a number yet."
        }
      />

      <Modal
        title={`Explain ${noteFor?.number ?? ""}`}
        open={noteFor !== null}
        onOk={saveNote}
        confirmLoading={savingNote}
        onCancel={() => setNoteFor(null)}
        okText="Record reason"
        cancelText="Cancel"
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary">
          The reason is stored against the number and audited. It closes the exception in this
          report; it does not recreate the document.
        </Typography.Paragraph>
        <Form form={noteForm} layout="vertical" requiredMark={false}>
          <Form.Item
            name="reason"
            label="Why is this number missing?"
            rules={[{ required: true, min: 10, message: "Explain the gap in at least ten characters" }]}
          >
            <Input.TextArea rows={3} placeholder="e.g. Draft removed during the July data migration" />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
