"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  App,
  Button,
  Card,
  DatePicker,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Tag,
  Typography,
} from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import DataTable from "@/components/ui/DataTable";
import FilterBar from "@/components/ui/FilterBar";
import IconActionButton from "@/components/ui/IconActionButton";
import type { FinancialAnalysisRow } from "@/lib/db/types";
import {
  buildWhatIfAnalysis,
  validateAdjustment,
  type AdjustableAccount,
  type AnalysisAdjustment,
  type WhatIfAnalysis,
} from "@/lib/domain/financial-analysis";
import { fromMinor, toMinor } from "@/lib/domain/money";
import type { LedgerBalance } from "@/lib/domain/reports";
import { archiveAnalysisAction, freezeAnalysisAction, getAnalysisDataAction } from "./actions";
import AnalysisReportTables from "./AnalysisReportTables";

interface LoadedData {
  pnlRows: LedgerBalance[];
  bsRows: LedgerBalance[];
  accounts: AdjustableAccount[];
}

interface LineFields {
  account_id?: string;
  side?: "debit" | "credit";
  amount?: number;
}

/** A stored jsonb is data from the wire: check its shape, never assume it. */
function parseSnapshot(value: unknown): WhatIfAnalysis | null {
  if (
    typeof value === "object" &&
    value !== null &&
    "pnl" in value &&
    "balanceSheet" in value
  ) {
    return value as WhatIfAnalysis;
  }
  return null;
}

function parseAdjustments(value: unknown): AnalysisAdjustment[] | null {
  if (!Array.isArray(value)) return null;
  return value.every(
    (a) => typeof a === "object" && a !== null && Array.isArray((a as AnalysisAdjustment).lines),
  )
    ? (value as AnalysisAdjustment[])
    : null;
}

export default function AnalysisClient({
  canFreeze,
  frozenReports,
  baseCurrency,
  baseDecimals,
}: {
  canFreeze: boolean;
  frozenReports: FinancialAnalysisRow[];
  baseCurrency: string;
  baseDecimals: number;
}) {
  const { message, modal } = App.useApp();
  const router = useRouter();
  const today = dayjs();
  const [range, setRange] = useState<[Dayjs, Dayjs]>([today.startOf("year"), today]);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<LoadedData | null>(null);
  const [adjustments, setAdjustments] = useState<AnalysisAdjustment[]>([]);
  const [editing, setEditing] = useState<AnalysisAdjustment | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [freezeOpen, setFreezeOpen] = useState(false);
  const [freezing, setFreezing] = useState(false);
  const [viewing, setViewing] = useState<FinancialAnalysisRow | null>(null);
  const [editorForm] = Form.useForm();
  const [freezeForm] = Form.useForm();

  async function run() {
    setLoading(true);
    const res = await getAnalysisDataAction(
      range[0].format("YYYY-MM-DD"),
      range[1].format("YYYY-MM-DD"),
    );
    setLoading(false);
    if (res.ok && res.data) setData(res.data);
    else message.error(res.error ?? "Failed to load the ledger");
  }

  const analysis = useMemo(() => {
    if (!data) return null;
    try {
      return buildWhatIfAnalysis(data.pnlRows, data.bsRows, adjustments, data.accounts);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "The analysis could not be built");
      return null;
    }
  }, [data, adjustments, message]);

  function openEditor(adjustment: AnalysisAdjustment | null) {
    setEditing(adjustment);
    editorForm.setFieldsValue(
      adjustment
        ? {
            label: adjustment.label,
            lines: adjustment.lines.map((l) => ({
              account_id: l.accountId,
              side: l.deltaMinor > 0 ? "debit" : "credit",
              amount: fromMinor(Math.abs(l.deltaMinor), baseDecimals),
            })),
          }
        : { label: "", lines: [{ side: "debit" }, { side: "credit" }] },
    );
    setEditorOpen(true);
  }

  async function saveAdjustment() {
    const values = await editorForm.validateFields();
    const candidate: AnalysisAdjustment = {
      key: editing?.key ?? `adj-${Date.now()}`,
      label: values.label ?? "",
      lines: (values.lines as LineFields[]).map((l) => {
        const minor = toMinor(l.amount ?? 0, baseDecimals);
        return { accountId: l.account_id ?? "", deltaMinor: l.side === "credit" ? -minor : minor };
      }),
    };
    const problem = validateAdjustment(candidate);
    if (problem) {
      message.error(problem);
      return;
    }
    setAdjustments((prev) =>
      editing ? prev.map((a) => (a.key === editing.key ? candidate : a)) : [...prev, candidate],
    );
    setEditorOpen(false);
  }

  async function freeze() {
    const values = await freezeForm.validateFields();
    setFreezing(true);
    const res = await freezeAnalysisAction({
      title: values.title,
      notes: values.notes?.trim() ? values.notes.trim() : null,
      periodStart: range[0].format("YYYY-MM-DD"),
      periodEnd: range[1].format("YYYY-MM-DD"),
      adjustments,
    });
    setFreezing(false);
    if (res.ok) {
      message.success("Analysis frozen");
      setFreezeOpen(false);
      freezeForm.resetFields();
      router.refresh();
    } else {
      message.error(res.error ?? "Failed to freeze the analysis");
    }
  }

  function confirmArchive(row: FinancialAnalysisRow) {
    let reason = "";
    modal.confirm({
      title: "Archive this frozen analysis?",
      content: (
        <Input
          placeholder="Why it is being retired (optional)"
          onChange={(e) => {
            reason = e.target.value;
          }}
        />
      ),
      okButtonProps: { danger: true },
      onOk: async () => {
        const res = await archiveAnalysisAction(row.id, reason || null);
        if (res.ok) {
          message.success("Analysis archived");
          router.refresh();
        } else {
          message.error(res.error ?? "Failed to archive");
        }
      },
    });
  }

  function loadAssumptions(row: FinancialAnalysisRow) {
    const stored = parseAdjustments(row.adjustments);
    if (!stored) {
      message.error("This frozen report's assumptions could not be read");
      return;
    }
    setAdjustments(stored);
    setRange([dayjs(row.period_start), dayjs(row.period_end)]);
    setViewing(null);
    message.success("Assumptions loaded into the workspace — run the report to apply them");
  }

  const accountOptions =
    data?.accounts.map((a) => ({ value: a.accountId, label: `${a.accountCode} — ${a.name}` })) ??
    [];

  const describeLines = (adjustment: AnalysisAdjustment) =>
    adjustment.lines
      .map((l) => {
        const account = data?.accounts.find((a) => a.accountId === l.accountId);
        const name = account ? account.accountCode : "?";
        const amount = fromMinor(Math.abs(l.deltaMinor), baseDecimals).toFixed(baseDecimals);
        return `${l.deltaMinor > 0 ? "DR" : "CR"} ${name} ${amount}`;
      })
      .join(" · ");

  const viewingSnapshot = viewing ? parseSnapshot(viewing.snapshot) : null;
  const viewingAdjustments = viewing ? parseAdjustments(viewing.adjustments) : null;

  return (
    <Space direction="vertical" size="large" style={{ display: "flex" }}>
      <FilterBar
        actions={
          canFreeze && analysis && adjustments.length > 0 ? (
            <Button type="primary" onClick={() => setFreezeOpen(true)}>
              Freeze as report
            </Button>
          ) : null
        }
      >
        <DatePicker.RangePicker
          aria-label="Analysis period"
          value={range}
          allowClear={false}
          onChange={(value) => value && setRange([value[0]!, value[1]!])}
        />
        <Button type="primary" ghost onClick={() => void run()} loading={loading}>
          Run
        </Button>
      </FilterBar>

      {data && (
        <Card
          size="small"
          title="Adjustments"
          extra={
            <Button size="small" icon={<PlusOutlined />} onClick={() => openEditor(null)}>
              Add adjustment
            </Button>
          }
        >
          {adjustments.length === 0 ? (
            <Typography.Text type="secondary">
              No adjustments yet — the Adjusted column equals the Actual column until you assume
              something.
            </Typography.Text>
          ) : (
            <Space direction="vertical" style={{ display: "flex" }}>
              {adjustments.map((a) => (
                <Space key={a.key} wrap>
                  <Tag color="blue">{a.label}</Tag>
                  <Typography.Text type="secondary">{describeLines(a)}</Typography.Text>
                  <IconActionButton
                    label={`Edit adjustment ${a.label}`}
                    icon={<EditOutlined />}
                    onClick={() => openEditor(a)}
                  />
                  <IconActionButton
                    label={`Remove adjustment ${a.label}`}
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => setAdjustments((prev) => prev.filter((x) => x.key !== a.key))}
                  />
                </Space>
              ))}
            </Space>
          )}
        </Card>
      )}

      {analysis ? (
        <AnalysisReportTables
          analysis={analysis}
          baseCurrency={baseCurrency}
          baseDecimals={baseDecimals}
        />
      ) : (
        <Card size="small">
          <Empty description="Pick a period and press Run to load the actual figures." />
        </Card>
      )}

      <Card size="small" title="Frozen reports">
        <DataTable<FinancialAnalysisRow>
          rowKey="id"
          dataSource={frozenReports}
          emptyTitle="No frozen reports yet"
          emptyDescription="Freeze a scenario above to keep it exactly as it was computed."
          columns={[
            { title: "Title", dataIndex: "title" },
            {
              title: "Period",
              key: "period",
              render: (_, r) => `${r.period_start} → ${r.period_end}`,
            },
            {
              title: "Created",
              dataIndex: "created_at",
              render: (v: string) => v.slice(0, 16).replace("T", " "),
            },
            {
              title: "Status",
              dataIndex: "status",
              render: (s: string) => <Tag color={s === "active" ? "green" : "default"}>{s}</Tag>,
            },
            {
              title: "Actions",
              key: "actions",
              width: 200,
              render: (_, r) => (
                <Space>
                  <Button size="small" onClick={() => setViewing(r)}>
                    View
                  </Button>
                  {canFreeze && r.status === "active" ? (
                    <Button size="small" danger onClick={() => confirmArchive(r)}>
                      Archive
                    </Button>
                  ) : null}
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title={editing ? "Edit adjustment" : "New adjustment"}
        open={editorOpen}
        onOk={() => void saveAdjustment()}
        onCancel={() => setEditorOpen(false)}
        okText="Save"
        width={640}
      >
        <Form form={editorForm} layout="vertical">
          <Form.Item
            name="label"
            label="What is being assumed"
            rules={[{ required: true, message: "Give the adjustment a label" }]}
          >
            <Input placeholder="e.g. Recognize December revenue" />
          </Form.Item>
          <Form.List name="lines">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <Space key={field.key} align="baseline" style={{ display: "flex", marginBottom: 8 }}>
                    <Form.Item
                      name={[field.name, "account_id"]}
                      rules={[{ required: true, message: "Account" }]}
                      style={{ marginBottom: 0 }}
                    >
                      <Select
                        placeholder="Account"
                        style={{ width: 280 }}
                        showSearch
                        optionFilterProp="label"
                        options={accountOptions}
                      />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, "side"]}
                      rules={[{ required: true, message: "Side" }]}
                      style={{ marginBottom: 0 }}
                    >
                      <Select
                        style={{ width: 100 }}
                        options={[
                          { value: "debit", label: "Debit" },
                          { value: "credit", label: "Credit" },
                        ]}
                      />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, "amount"]}
                      rules={[{ required: true, message: "Amount" }]}
                      style={{ marginBottom: 0 }}
                    >
                      <InputNumber
                        min={0.01}
                        precision={baseDecimals}
                        placeholder="Amount"
                        style={{ width: 130 }}
                      />
                    </Form.Item>
                    {fields.length > 2 && (
                      <IconActionButton
                        label="Remove line"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => remove(field.name)}
                      />
                    )}
                  </Space>
                ))}
                <Button type="dashed" onClick={() => add({ side: "credit" })} icon={<PlusOutlined />}>
                  Add line
                </Button>
              </>
            )}
          </Form.List>
          <Alert
            style={{ marginTop: 16 }}
            type="info"
            showIcon
            message="Debits must equal credits — the same rule a journal entry lives by."
          />
        </Form>
      </Modal>

      <Modal
        title="Freeze this analysis"
        open={freezeOpen}
        onOk={() => void freeze()}
        onCancel={() => setFreezeOpen(false)}
        okText="Freeze"
        confirmLoading={freezing}
      >
        <Form form={freezeForm} layout="vertical">
          <Form.Item
            name="title"
            label="Title"
            rules={[{ required: true, message: "Give the analysis a title" }]}
          >
            <Input placeholder="e.g. FY2026 margin scenario" />
          </Form.Item>
          <Form.Item name="notes" label="Notes">
            <Input.TextArea rows={3} placeholder="What this scenario assumes and why" />
          </Form.Item>
          <Alert
            type="info"
            showIcon
            message="A frozen report is a photograph"
            description="The figures are recomputed on the server as of now and kept exactly as they are. Nothing posts to the ledger."
          />
        </Form>
      </Modal>

      <Drawer
        title={viewing?.title}
        open={Boolean(viewing)}
        onClose={() => setViewing(null)}
        width={860}
      >
        {viewing && (
          <Space direction="vertical" size="large" style={{ display: "flex" }}>
            <Space wrap>
              <Tag>
                {viewing.period_start} → {viewing.period_end}
              </Tag>
              <Tag color={viewing.status === "active" ? "green" : "default"}>{viewing.status}</Tag>
              <Button size="small" onClick={() => loadAssumptions(viewing)}>
                Load assumptions into workspace
              </Button>
            </Space>
            {viewing.notes ? <Typography.Paragraph>{viewing.notes}</Typography.Paragraph> : null}
            {viewingAdjustments ? (
              <Card size="small" title="Assumptions">
                <Space direction="vertical">
                  {viewingAdjustments.map((a) => (
                    <Typography.Text key={a.key}>
                      <Tag color="blue">{a.label}</Tag> {describeLines(a)}
                    </Typography.Text>
                  ))}
                </Space>
              </Card>
            ) : null}
            {viewingSnapshot ? (
              <AnalysisReportTables
                analysis={viewingSnapshot}
                baseCurrency={baseCurrency}
                baseDecimals={baseDecimals}
              />
            ) : (
              <Alert type="error" showIcon message="This frozen report's snapshot could not be read." />
            )}
          </Space>
        )}
      </Drawer>
    </Space>
  );
}
