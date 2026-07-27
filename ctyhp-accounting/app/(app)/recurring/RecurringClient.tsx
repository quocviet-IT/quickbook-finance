"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Divider,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Statistic,
  Tag,
  Typography,
  type TableColumnsType,
} from "antd";
import {
  CalendarOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import DataTable from "@/components/ui/DataTable";
import FilterBar from "@/components/ui/FilterBar";
import type {
  AccountRow,
  CustomerRow,
  RecurringDocumentType,
  RecurringFrequency,
  RecurringRunRow,
  RecurringRunStatus,
  RecurringTemplateRow,
  RecurringTemplateStatus,
  TaxCodeRow,
  VendorRow,
} from "@/lib/db/types";
import {
  DOCUMENT_TYPE_LABELS,
  FREQUENCY_LABELS,
  type RecurringTemplateCreateInput,
} from "@/lib/domain/recurring";
import { formatMoney, toMinorUnits } from "@/lib/format";
import {
  createRecurringTemplateAction,
  generateRecurringTemplateAction,
  postRecurringDraftAction,
  setRecurringTemplateStatusAction,
} from "./actions";

const TEMPLATE_STATUS: Record<RecurringTemplateStatus, { label: string; color: string }> = {
  active: { label: "Active", color: "green" },
  paused: { label: "Paused", color: "gold" },
  ended: { label: "Ended", color: "default" },
};

const RUN_STATUS: Record<RecurringRunStatus, { label: string; color: string }> = {
  processing: { label: "Processing", color: "processing" },
  generated: { label: "Generated", color: "green" },
  pending_review: { label: "Review required", color: "gold" },
  awaiting_approval: { label: "Awaiting approval", color: "blue" },
  failed: { label: "Failed", color: "red" },
};

interface LineFormValue {
  description?: string;
  quantity?: number;
  unit_price?: number;
  amount?: number;
  income_account_id?: string;
  expense_account_id?: string;
  tax_code_id?: string;
  account_id?: string;
  debit?: number;
  credit?: number;
}

interface RecurringFormValues {
  name: string;
  document_type: RecurringDocumentType;
  frequency: RecurringFrequency;
  interval_count: number;
  start_date: Dayjs;
  end_date?: Dayjs;
  customer_id?: string;
  vendor_id?: string;
  vendor_ref?: string;
  payment_account_id?: string;
  due_days?: number;
  description?: string;
  source_ref?: string;
  memo?: string;
  lines: LineFormValue[];
}

interface RecurringClientProps {
  templates: RecurringTemplateRow[];
  runs: RecurringRunRow[];
  customers: CustomerRow[];
  vendors: VendorRow[];
  incomeAccounts: AccountRow[];
  expenseAccounts: AccountRow[];
  paymentAccounts: AccountRow[];
  journalAccounts: AccountRow[];
  taxCodes: TaxCodeRow[];
  canManage: boolean;
}

function accountOptions(accounts: AccountRow[]) {
  return accounts.map((account) => ({
    value: account.id,
    label: `${account.account_code} — ${account.name}`,
  }));
}

function defaultLine(type: RecurringDocumentType): LineFormValue {
  if (type === "invoice") return { quantity: 1, unit_price: 0 };
  if (type === "journal") return { debit: 0, credit: 0 };
  return { amount: 0 };
}

function documentHref(run: RecurringRunRow): string {
  switch (run.document_type) {
    case "invoice":
      return "/invoices";
    case "bill":
      return "/bills";
    case "expense":
      return "/expenses";
    case "journal":
      return run.document_id ? `/journal?entry=${run.document_id}` : "/journal";
  }
}

function scheduleLabel(template: RecurringTemplateRow): string {
  const unit = FREQUENCY_LABELS[template.frequency];
  return template.interval_count === 1
    ? `Every ${unit}`
    : `Every ${template.interval_count} ${unit}s`;
}

export default function RecurringClient({
  templates,
  runs,
  customers,
  vendors,
  incomeAccounts,
  expenseAccounts,
  paymentAccounts,
  journalAccounts,
  taxCodes,
  canManage,
}: RecurringClientProps) {
  const { message } = App.useApp();
  const router = useRouter();
  const [form] = Form.useForm<RecurringFormValues>();
  const documentType = Form.useWatch("document_type", form) ?? "invoice";
  const [createOpen, setCreateOpen] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<RecurringDocumentType | "all">("all");
  const [statusFilter, setStatusFilter] = useState<RecurringTemplateStatus | "all">("all");

  const today = dayjs().format("YYYY-MM-DD");
  const activeCount = templates.filter((template) => template.status === "active").length;
  const dueCount = templates.filter(
    (template) => template.status === "active" && template.next_run_date <= today,
  ).length;
  const reviewCount = runs.filter(
    (run) => run.status === "pending_review" || run.status === "awaiting_approval",
  ).length;
  const failedCount = runs.filter((run) => run.status === "failed").length;

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return templates.filter((template) => {
      const matchesSearch =
        !query ||
        `${template.name} ${DOCUMENT_TYPE_LABELS[template.document_type]}`
          .toLowerCase()
          .includes(query);
      return (
        matchesSearch &&
        (typeFilter === "all" || template.document_type === typeFilter) &&
        (statusFilter === "all" || template.status === statusFilter)
      );
    });
  }, [search, statusFilter, templates, typeFilter]);

  async function submitTemplate(values: RecurringFormValues) {
    setBusyKey("create");
    try {
      const common = {
        name: values.name,
        document_type: values.document_type,
        frequency: values.frequency,
        interval_count: values.interval_count,
        start_date: values.start_date.format("YYYY-MM-DD"),
        end_date: values.end_date?.format("YYYY-MM-DD") ?? null,
      };
      const lineValues = values.lines ?? [];
      let input: RecurringTemplateCreateInput;

      if (values.document_type === "invoice") {
        input = {
          ...common,
          document_type: "invoice",
          payload: {
            customer_id: values.customer_id ?? "",
            due_days: values.due_days ?? 30,
            memo: values.memo || null,
            lines: lineValues.map((line) => ({
              description: line.description ?? "",
              quantity: Number(line.quantity ?? 0),
              unit_price_minor: toMinorUnits(Number(line.unit_price ?? 0), 2),
              income_account_id: line.income_account_id ?? "",
              tax_code_id: line.tax_code_id || null,
              item_id: null,
            })),
          },
        };
      } else if (values.document_type === "bill") {
        input = {
          ...common,
          document_type: "bill",
          payload: {
            vendor_id: values.vendor_id ?? "",
            vendor_ref: values.vendor_ref || null,
            due_days: values.due_days ?? 30,
            memo: values.memo || null,
            lines: lineValues.map((line) => ({
              description: line.description ?? "",
              expense_account_id: line.expense_account_id ?? "",
              amount_minor: toMinorUnits(Number(line.amount ?? 0), 2),
              item_id: null,
            })),
          },
        };
      } else if (values.document_type === "expense") {
        input = {
          ...common,
          document_type: "expense",
          payload: {
            vendor_id: values.vendor_id || null,
            payment_account_id: values.payment_account_id ?? "",
            memo: values.memo || null,
            lines: lineValues.map((line) => ({
              description: line.description ?? "",
              expense_account_id: line.expense_account_id ?? "",
              amount_minor: toMinorUnits(Number(line.amount ?? 0), 2),
            })),
          },
        };
      } else {
        input = {
          ...common,
          document_type: "journal",
          payload: {
            description: values.description ?? "",
            source_ref: values.source_ref || null,
            lines: lineValues.map((line) => ({
              account_id: line.account_id ?? "",
              debit_minor: toMinorUnits(Number(line.debit ?? 0), 2),
              credit_minor: toMinorUnits(Number(line.credit ?? 0), 2),
            })),
          },
        };
      }

      const result = await createRecurringTemplateAction(input);
      if (!result.ok) {
        message.error(result.error);
        return;
      }
      message.success("Recurring schedule created");
      setCreateOpen(false);
      form.resetFields();
      router.refresh();
    } finally {
      setBusyKey(null);
    }
  }

  async function changeStatus(template: RecurringTemplateRow) {
    const status = template.status === "active" ? "paused" : "active";
    setBusyKey(`status-${template.id}`);
    try {
      const result = await setRecurringTemplateStatusAction(template.id, status);
      if (!result.ok) message.error(result.error);
      else {
        message.success(status === "paused" ? "Schedule paused" : "Schedule resumed");
        router.refresh();
      }
    } finally {
      setBusyKey(null);
    }
  }

  async function generate(template: RecurringTemplateRow) {
    setBusyKey(`run-${template.id}`);
    try {
      const result = await generateRecurringTemplateAction(template.id);
      if (!result.ok) {
        message.error(result.error);
      } else if (!result.data?.claimed) {
        message.info("This occurrence has already been generated or is processing");
      } else if (result.data.status === "generated") {
        message.success(`${DOCUMENT_TYPE_LABELS[template.document_type]} draft generated`);
      } else {
        message.success("Occurrence generated and queued for review");
      }
      router.refresh();
    } finally {
      setBusyKey(null);
    }
  }

  async function postDraft(run: RecurringRunRow) {
    setBusyKey(`post-${run.id}`);
    try {
      const result = await postRecurringDraftAction(run.id);
      if (!result.ok) {
        message.error(result.error);
      } else if (result.data?.submittedForApproval) {
        message.success("Journal submitted for approval");
      } else {
        message.success(`${DOCUMENT_TYPE_LABELS[run.document_type]} posted`);
      }
      router.refresh();
    } finally {
      setBusyKey(null);
    }
  }

  const templateColumns: TableColumnsType<RecurringTemplateRow> = [
    {
      title: "Schedule",
      key: "schedule",
      width: 250,
      render: (_, template) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{template.name}</Typography.Text>
          <Typography.Text type="secondary">
            {DOCUMENT_TYPE_LABELS[template.document_type]}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: "Frequency",
      key: "frequency",
      render: (_, template) => scheduleLabel(template),
    },
    {
      title: "Next occurrence",
      dataIndex: "next_run_date",
      render: (value: string, template) => (
        <Space direction="vertical" size={0}>
          <Typography.Text>{dayjs(value).format("MMM D, YYYY")}</Typography.Text>
          {template.status === "active" && value <= today ? <Tag color="gold">Due</Tag> : null}
        </Space>
      ),
    },
    {
      title: "Amount",
      dataIndex: "total_minor",
      align: "right",
      render: (value: number) => formatMoney(value, "USD", 2),
    },
    {
      title: "Status",
      dataIndex: "status",
      render: (value: RecurringTemplateStatus) => (
        <Tag color={TEMPLATE_STATUS[value].color}>{TEMPLATE_STATUS[value].label}</Tag>
      ),
    },
    {
      title: "Last result",
      key: "last",
      render: (_, template) =>
        template.last_run_status ? (
          <Space direction="vertical" size={0}>
            <Tag color={RUN_STATUS[template.last_run_status].color}>
              {RUN_STATUS[template.last_run_status].label}
            </Tag>
            {template.last_error ? (
              <Typography.Text type="danger" ellipsis={{ tooltip: template.last_error }}>
                {template.last_error}
              </Typography.Text>
            ) : null}
          </Space>
        ) : (
          <Typography.Text type="secondary">Not run</Typography.Text>
        ),
    },
    {
      title: "Actions",
      key: "actions",
      fixed: "right",
      render: (_, template) => (
        <Space>
          <Popconfirm
            title={`Generate the ${dayjs(template.next_run_date).format("MMM D, YYYY")} occurrence?`}
            description={
              template.document_type === "invoice" || template.document_type === "bill"
                ? "A draft document will be created."
                : "A review item will be created before anything posts."
            }
            onConfirm={() => void generate(template)}
          >
            <Button
              size="small"
              type="primary"
              icon={<PlayCircleOutlined />}
              loading={busyKey === `run-${template.id}`}
              disabled={!canManage || template.status !== "active"}
            >
              Generate next
            </Button>
          </Popconfirm>
          {template.status !== "ended" ? (
            <Button
              size="small"
              icon={
                template.status === "active" ? <PauseCircleOutlined /> : <ReloadOutlined />
              }
              loading={busyKey === `status-${template.id}`}
              disabled={!canManage}
              onClick={() => void changeStatus(template)}
            >
              {template.status === "active" ? "Pause" : "Resume"}
            </Button>
          ) : null}
        </Space>
      ),
    },
  ];

  const runColumns: TableColumnsType<RecurringRunRow> = [
    {
      title: "Scheduled date",
      dataIndex: "scheduled_date",
      render: (value: string) => dayjs(value).format("MMM D, YYYY"),
    },
    {
      title: "Schedule",
      dataIndex: "template_name",
      render: (value?: string) => value ?? "Recurring transaction",
    },
    {
      title: "Type",
      dataIndex: "document_type",
      render: (value: RecurringDocumentType) => DOCUMENT_TYPE_LABELS[value],
    },
    {
      title: "Result",
      dataIndex: "status",
      render: (value: RecurringRunStatus, run) => (
        <Space direction="vertical" size={0}>
          <Tag color={RUN_STATUS[value].color}>{RUN_STATUS[value].label}</Tag>
          {run.error_message ? (
            <Typography.Text type="danger" ellipsis={{ tooltip: run.error_message }}>
              {run.error_message}
            </Typography.Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: "Completed",
      dataIndex: "completed_at",
      render: (value: string | null) =>
        value ? dayjs(value).format("MMM D, YYYY h:mm A") : "—",
    },
    {
      title: "Action",
      key: "action",
      fixed: "right",
      render: (_, run) => {
        if (run.status === "pending_review") {
          return (
            <Button
              type="primary"
              size="small"
              loading={busyKey === `post-${run.id}`}
              disabled={!canManage}
              onClick={() => void postDraft(run)}
            >
              Review and post
            </Button>
          );
        }
        if (run.status === "awaiting_approval") {
          return <Link href="/approvals">Open approval</Link>;
        }
        if (run.status === "generated" && run.document_id) {
          return <Link href={documentHref(run)}>Open document</Link>;
        }
        return null;
      },
    },
  ];

  function openCreate() {
    form.setFieldsValue({
      document_type: "invoice",
      frequency: "monthly",
      interval_count: 1,
      start_date: dayjs(),
      due_days: 30,
      lines: [defaultLine("invoice")],
    });
    setCreateOpen(true);
  }

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Row gutter={[12, 12]}>
        <Col xs={12} lg={6}>
          <Card size="small">
            <Statistic title="Active schedules" value={activeCount} prefix={<CalendarOutlined />} />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card size="small">
            <Statistic title="Due now" value={dueCount} prefix={<ClockCircleOutlined />} />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card size="small">
            <Statistic title="Needs attention" value={reviewCount} prefix={<WarningOutlined />} />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card size="small">
            <Statistic
              title="Failed runs"
              value={failedCount}
              prefix={failedCount ? <WarningOutlined /> : <CheckCircleOutlined />}
              valueStyle={failedCount ? { color: "#b42318" } : undefined}
            />
          </Card>
        </Col>
      </Row>

      <Alert
        type="info"
        showIcon
        message="Safe automation"
        description="Invoice and bill occurrences create drafts. Expense and journal occurrences wait for a user review; journal approval policies continue to apply."
      />

      <section>
        <Typography.Title level={3}>Schedules</Typography.Title>
        <FilterBar
          resultCount={filtered.length}
          actions={
            <Button
              type="primary"
              icon={<PlusOutlined />}
              disabled={!canManage}
              onClick={openCreate}
            >
              New schedule
            </Button>
          }
        >
          <Input.Search
            allowClear
            placeholder="Search schedules"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            style={{ width: 240 }}
          />
          <Select
            value={typeFilter}
            onChange={setTypeFilter}
            style={{ width: 170 }}
            options={[
              { value: "all", label: "All transaction types" },
              ...Object.entries(DOCUMENT_TYPE_LABELS).map(([value, label]) => ({ value, label })),
            ]}
          />
          <Select
            value={statusFilter}
            onChange={setStatusFilter}
            style={{ width: 140 }}
            options={[
              { value: "all", label: "All statuses" },
              { value: "active", label: "Active" },
              { value: "paused", label: "Paused" },
              { value: "ended", label: "Ended" },
            ]}
          />
        </FilterBar>
        <DataTable
          rowKey="id"
          columns={templateColumns}
          dataSource={filtered}
          emptyTitle="No recurring schedules"
          emptyDescription="Create a schedule for work that repeats weekly, monthly, quarterly, or yearly."
          pagination={{ pageSize: 15 }}
          scroll={{ x: 1120 }}
        />
      </section>

      <section>
        <Typography.Title level={3}>Occurrence history</Typography.Title>
        <DataTable
          rowKey="id"
          columns={runColumns}
          dataSource={runs}
          emptyTitle="No occurrences yet"
          emptyDescription="Generated drafts and review items will appear here."
          pagination={{ pageSize: 15 }}
          scroll={{ x: 860 }}
        />
      </section>

      <Modal
        title="New recurring schedule"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => form.submit()}
        okText="Create schedule"
        okButtonProps={{ loading: busyKey === "create" }}
        width={980}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          requiredMark={false}
          onFinish={(values) => void submitTemplate(values)}
        >
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item
                name="name"
                label="Schedule name"
                rules={[{ required: true, message: "Enter a schedule name" }]}
              >
                <Input placeholder="Monthly showroom rent" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="document_type" label="Transaction type" rules={[{ required: true }]}>
                <Select
                  onChange={(value: RecurringDocumentType) => {
                    form.setFieldValue(
                      "lines",
                      value === "journal"
                        ? [defaultLine(value), defaultLine(value)]
                        : [defaultLine(value)],
                    );
                    form.setFieldValue("due_days", 30);
                  }}
                  options={Object.entries(DOCUMENT_TYPE_LABELS).map(([value, label]) => ({
                    value,
                    label,
                  }))}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} md={6}>
              <Form.Item name="frequency" label="Frequency" rules={[{ required: true }]}>
                <Select
                  options={[
                    { value: "weekly", label: "Weekly" },
                    { value: "monthly", label: "Monthly" },
                    { value: "quarterly", label: "Quarterly" },
                    { value: "yearly", label: "Yearly" },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item name="interval_count" label="Repeat every" rules={[{ required: true }]}>
                <InputNumber min={1} max={24} precision={0} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item name="start_date" label="First occurrence" rules={[{ required: true }]}>
                <DatePicker format="MM/DD/YYYY" style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item name="end_date" label="End date">
                <DatePicker
                  allowClear
                  format="MM/DD/YYYY"
                  style={{ width: "100%" }}
                  disabledDate={(date) => {
                    const start = form.getFieldValue("start_date");
                    return Boolean(start && date.isBefore(start, "day"));
                  }}
                />
              </Form.Item>
            </Col>
          </Row>

          <Divider titlePlacement="left">Transaction template</Divider>
          {documentType === "invoice" ? (
            <Row gutter={16}>
              <Col xs={24} md={16}>
                <Form.Item name="customer_id" label="Customer" rules={[{ required: true }]}>
                  <Select
                    showSearch
                    optionFilterProp="label"
                    options={customers.map((customer) => ({
                      value: customer.id,
                      label: customer.name,
                    }))}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item name="due_days" label="Payment terms (days)" rules={[{ required: true }]}>
                  <InputNumber min={0} max={365} precision={0} style={{ width: "100%" }} />
                </Form.Item>
              </Col>
            </Row>
          ) : null}
          {documentType === "bill" || documentType === "expense" ? (
            <Row gutter={16}>
              <Col xs={24} md={documentType === "bill" ? 12 : 24}>
                <Form.Item
                  name="vendor_id"
                  label="Vendor"
                  rules={documentType === "bill" ? [{ required: true }] : undefined}
                >
                  <Select
                    allowClear={documentType === "expense"}
                    showSearch
                    optionFilterProp="label"
                    options={vendors.map((vendor) => ({ value: vendor.id, label: vendor.name }))}
                  />
                </Form.Item>
              </Col>
              {documentType === "bill" ? (
                <Col xs={24} md={12}>
                  <Form.Item name="due_days" label="Payment terms (days)" rules={[{ required: true }]}>
                    <InputNumber min={0} max={365} precision={0} style={{ width: "100%" }} />
                  </Form.Item>
                </Col>
              ) : (
                <Col xs={24}>
                  <Form.Item
                    name="payment_account_id"
                    label="Payment account"
                    rules={[{ required: true }]}
                  >
                    <Select
                      showSearch
                      optionFilterProp="label"
                      options={accountOptions(paymentAccounts)}
                    />
                  </Form.Item>
                </Col>
              )}
            </Row>
          ) : null}
          {documentType === "journal" ? (
            <Row gutter={16}>
              <Col xs={24} md={16}>
                <Form.Item
                  name="description"
                  label="Journal description"
                  rules={[{ required: true }]}
                >
                  <Input placeholder="Monthly prepaid insurance allocation" />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item name="source_ref" label="Reference">
                  <Input />
                </Form.Item>
              </Col>
            </Row>
          ) : (
            <Form.Item name="memo" label="Memo">
              <Input.TextArea rows={2} />
            </Form.Item>
          )}

          <Form.List name="lines">
            {(fields, { add, remove }) => (
              <Space direction="vertical" size="small" style={{ width: "100%" }}>
                {fields.map((field, index) => (
                  <Card
                    key={field.key}
                    size="small"
                    title={`Line ${index + 1}`}
                    extra={
                      fields.length > (documentType === "journal" ? 2 : 1) ? (
                        <Button danger type="link" onClick={() => remove(field.name)}>
                          Remove
                        </Button>
                      ) : null
                    }
                  >
                    {documentType === "invoice" ? (
                      <Row gutter={12}>
                        <Col xs={24} md={7}>
                          <Form.Item
                            name={[field.name, "description"]}
                            label="Description"
                            rules={[{ required: true }]}
                          >
                            <Input />
                          </Form.Item>
                        </Col>
                        <Col xs={12} md={3}>
                          <Form.Item
                            name={[field.name, "quantity"]}
                            label="Quantity"
                            rules={[{ required: true }]}
                          >
                            <InputNumber min={0.0001} style={{ width: "100%" }} />
                          </Form.Item>
                        </Col>
                        <Col xs={12} md={4}>
                          <Form.Item
                            name={[field.name, "unit_price"]}
                            label="Unit price (USD)"
                            rules={[{ required: true }]}
                          >
                            <InputNumber min={0} precision={2} style={{ width: "100%" }} />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={6}>
                          <Form.Item
                            name={[field.name, "income_account_id"]}
                            label="Income account"
                            rules={[{ required: true }]}
                          >
                            <Select
                              showSearch
                              optionFilterProp="label"
                              options={accountOptions(incomeAccounts)}
                            />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={4}>
                          <Form.Item name={[field.name, "tax_code_id"]} label="Sales tax">
                            <Select
                              allowClear
                              options={taxCodes.map((taxCode) => ({
                                value: taxCode.id,
                                label: `${taxCode.code} · ${taxCode.rate_percent}%`,
                              }))}
                            />
                          </Form.Item>
                        </Col>
                      </Row>
                    ) : documentType === "bill" || documentType === "expense" ? (
                      <Row gutter={12}>
                        <Col xs={24} md={10}>
                          <Form.Item
                            name={[field.name, "description"]}
                            label="Description"
                            rules={[{ required: true }]}
                          >
                            <Input />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={9}>
                          <Form.Item
                            name={[field.name, "expense_account_id"]}
                            label="Expense account"
                            rules={[{ required: true }]}
                          >
                            <Select
                              showSearch
                              optionFilterProp="label"
                              options={accountOptions(expenseAccounts)}
                            />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={5}>
                          <Form.Item
                            name={[field.name, "amount"]}
                            label="Amount (USD)"
                            rules={[{ required: true }]}
                          >
                            <InputNumber min={0.01} precision={2} style={{ width: "100%" }} />
                          </Form.Item>
                        </Col>
                      </Row>
                    ) : (
                      <Row gutter={12}>
                        <Col xs={24} md={12}>
                          <Form.Item
                            name={[field.name, "account_id"]}
                            label="Account"
                            rules={[{ required: true }]}
                          >
                            <Select
                              showSearch
                              optionFilterProp="label"
                              options={accountOptions(journalAccounts)}
                            />
                          </Form.Item>
                        </Col>
                        <Col xs={12} md={6}>
                          <Form.Item name={[field.name, "debit"]} label="Debit (USD)">
                            <InputNumber min={0} precision={2} style={{ width: "100%" }} />
                          </Form.Item>
                        </Col>
                        <Col xs={12} md={6}>
                          <Form.Item name={[field.name, "credit"]} label="Credit (USD)">
                            <InputNumber min={0} precision={2} style={{ width: "100%" }} />
                          </Form.Item>
                        </Col>
                      </Row>
                    )}
                  </Card>
                ))}
                <Button
                  block
                  type="dashed"
                  icon={<PlusOutlined />}
                  onClick={() => add(defaultLine(documentType))}
                >
                  Add line
                </Button>
              </Space>
            )}
          </Form.List>
        </Form>
      </Modal>
    </Space>
  );
}
