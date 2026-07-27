"use client";

import { useMemo, useState } from "react";
import {
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Progress,
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
  DollarOutlined,
  PlusOutlined,
  ScheduleOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import DataTable from "@/components/ui/DataTable";
import FilterBar from "@/components/ui/FilterBar";
import type {
  AccountRow,
  AssetDepreciationScheduleRow,
  CurrencyRow,
  FixedAssetMethod,
  FixedAssetStatus,
  VendorRow,
} from "@/lib/db/types";
import type { BillWithVendor } from "@/lib/services/payables";
import type { FixedAssetView } from "@/lib/services/fixed-assets";
import { formatMoney, toMinorUnits } from "@/lib/format";
import {
  getAssetScheduleAction,
  postAssetDepreciationAction,
  registerFixedAssetAction,
} from "./actions";

const CATEGORIES = [
  "Jewelry Production Equipment",
  "Store Fixtures & Showcases",
  "Security & Surveillance",
  "Computer & Point of Sale",
  "Leasehold Improvements",
  "Vehicles",
  "Land",
  "Other",
];

const STATUS_LABELS: Record<FixedAssetStatus, { label: string; color: string }> = {
  in_service: { label: "In service", color: "blue" },
  fully_depreciated: { label: "Fully depreciated", color: "green" },
  disposed: { label: "Disposed", color: "default" },
};

interface AssetFormValues {
  name: string;
  description?: string;
  category: string;
  serial_number?: string;
  location?: string;
  acquisition_date: Dayjs;
  in_service_date: Dayjs;
  cost: number;
  salvage_value: number;
  useful_life_months?: number;
  depreciation_method: FixedAssetMethod;
  asset_account_id: string;
  accumulated_depreciation_account_id?: string;
  depreciation_expense_account_id?: string;
  vendor_id?: string;
  source_bill_id?: string;
  notes?: string;
}

export default function FixedAssetsClient({
  assets,
  assetAccounts,
  expenseAccounts,
  vendors,
  bills,
  currency,
  canManage,
  canPost,
}: {
  assets: FixedAssetView[];
  assetAccounts: AccountRow[];
  expenseAccounts: AccountRow[];
  vendors: VendorRow[];
  bills: BillWithVendor[];
  currency: CurrencyRow;
  canManage: boolean;
  canPost: boolean;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm<AssetFormValues>();
  const depreciationMethod = Form.useWatch("depreciation_method", form) ?? "straight_line";
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<FixedAssetStatus | "all">("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scheduleAsset, setScheduleAsset] = useState<FixedAssetView | null>(null);
  const [schedule, setSchedule] = useState<AssetDepreciationScheduleRow[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [postAsset, setPostAsset] = useState<FixedAssetView | null>(null);
  const [throughDate, setThroughDate] = useState<Dayjs>(dayjs());

  const money = (value: number) => formatMoney(value, currency.code, currency.decimal_places);
  const filteredAssets = useMemo(() => {
    const query = search.trim().toLowerCase();
    return assets.filter((asset) => {
      const matchesStatus = status === "all" || asset.status === status;
      const matchesSearch =
        !query ||
        `${asset.asset_number} ${asset.name} ${asset.category} ${asset.serial_number ?? ""} ${asset.location ?? ""}`
          .toLowerCase()
          .includes(query);
      return matchesStatus && matchesSearch;
    });
  }, [assets, search, status]);

  const totals = useMemo(
    () => ({
      cost: assets.reduce((sum, asset) => sum + Number(asset.cost_minor), 0),
      accumulated: assets.reduce(
        (sum, asset) => sum + Number(asset.accumulated_depreciation_minor),
        0,
      ),
      netBookValue: assets.reduce((sum, asset) => sum + Number(asset.net_book_value_minor), 0),
      due: assets.reduce((sum, asset) => sum + Number(asset.due_depreciation_minor), 0),
    }),
    [assets],
  );

  function openCreate() {
    form.setFieldsValue({
      acquisition_date: dayjs(),
      in_service_date: dayjs(),
      depreciation_method: "straight_line",
      salvage_value: 0,
      useful_life_months: 60,
    });
    setCreateOpen(true);
  }

  async function submitAsset() {
    const values = await form.validateFields();
    setBusy(true);
    const result = await registerFixedAssetAction({
      name: values.name,
      description: values.description,
      category: values.category,
      serial_number: values.serial_number,
      location: values.location,
      acquisition_date: values.acquisition_date.format("YYYY-MM-DD"),
      in_service_date: values.in_service_date.format("YYYY-MM-DD"),
      currency_code: currency.code,
      cost_minor: toMinorUnits(values.cost, currency.decimal_places),
      salvage_value_minor: toMinorUnits(values.salvage_value ?? 0, currency.decimal_places),
      useful_life_months:
        values.depreciation_method === "straight_line" ? values.useful_life_months : null,
      depreciation_method: values.depreciation_method,
      asset_account_id: values.asset_account_id,
      accumulated_depreciation_account_id:
        values.depreciation_method === "straight_line"
          ? values.accumulated_depreciation_account_id
          : null,
      depreciation_expense_account_id:
        values.depreciation_method === "straight_line"
          ? values.depreciation_expense_account_id
          : null,
      vendor_id: values.vendor_id,
      source_bill_id: values.source_bill_id,
      notes: values.notes,
    });
    setBusy(false);
    if (!result.ok) {
      message.error(result.error ?? "Unable to register the asset");
      return;
    }
    message.success("Fixed asset registered and depreciation schedule created");
    setCreateOpen(false);
    form.resetFields();
    window.location.reload();
  }

  async function openSchedule(asset: FixedAssetView) {
    setScheduleAsset(asset);
    setSchedule([]);
    setScheduleLoading(true);
    const result = await getAssetScheduleAction(asset.id);
    setScheduleLoading(false);
    if (result.ok && result.data) setSchedule(result.data);
    else message.error(result.error ?? "Unable to load the depreciation schedule");
  }

  async function confirmPost() {
    if (!postAsset) return;
    setBusy(true);
    const result = await postAssetDepreciationAction(postAsset.id, throughDate.format("YYYY-MM-DD"));
    setBusy(false);
    if (!result.ok || !result.data) {
      message.error(result.error ?? "Unable to post depreciation");
      return;
    }
    message.success(
      `Posted ${result.data.postedCount} period(s) totaling ${money(result.data.postedTotalMinor)}`,
    );
    setPostAsset(null);
    window.location.reload();
  }

  const columns: TableColumnsType<FixedAssetView> = [
    {
      title: "Asset",
      key: "asset",
      width: 260,
      render: (_value, asset) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{asset.asset_number} · {asset.name}</Typography.Text>
          <Typography.Text type="secondary">{asset.category}</Typography.Text>
        </Space>
      ),
    },
    {
      title: "In service",
      dataIndex: "in_service_date",
      width: 115,
    },
    {
      title: "Cost",
      dataIndex: "cost_minor",
      width: 130,
      align: "right",
      render: (value: number) => money(value),
    },
    {
      title: "Accumulated depreciation",
      dataIndex: "accumulated_depreciation_minor",
      width: 180,
      align: "right",
      render: (value: number) => money(value),
    },
    {
      title: "Net book value",
      dataIndex: "net_book_value_minor",
      width: 140,
      align: "right",
      render: (value: number) => <Typography.Text strong>{money(value)}</Typography.Text>,
    },
    {
      title: "Depreciation progress",
      key: "progress",
      width: 190,
      render: (_value, asset) =>
        asset.total_periods ? (
          <Progress
            percent={Math.round((asset.posted_periods / asset.total_periods) * 100)}
            size="small"
            format={() => `${asset.posted_periods}/${asset.total_periods}`}
          />
        ) : (
          <Typography.Text type="secondary">Not depreciated</Typography.Text>
        ),
    },
    {
      title: "Status",
      dataIndex: "status",
      width: 135,
      render: (value: FixedAssetStatus, asset) => (
        <Space direction="vertical" size={2}>
          <Tag color={STATUS_LABELS[value].color}>{STATUS_LABELS[value].label}</Tag>
          {asset.due_depreciation_minor > 0 ? <Tag color="orange">Posting due</Tag> : null}
        </Space>
      ),
    },
    {
      title: "Action",
      key: "action",
      width: 180,
      fixed: "right",
      render: (_value, asset) => (
        <Space>
          <Button size="small" icon={<ScheduleOutlined />} onClick={() => openSchedule(asset)}>
            Schedule
          </Button>
          {canPost && asset.due_depreciation_minor > 0 ? (
            <Button
              size="small"
              type="primary"
              onClick={() => {
                setThroughDate(dayjs());
                setPostAsset(asset);
              }}
            >
              Post
            </Button>
          ) : null}
        </Space>
      ),
    },
  ];

  const scheduleColumns: TableColumnsType<AssetDepreciationScheduleRow> = [
    { title: "Period", dataIndex: "sequence_number", width: 80 },
    { title: "From", dataIndex: "period_start", width: 115 },
    { title: "Through", dataIndex: "period_end", width: 115 },
    {
      title: "Planned",
      dataIndex: "planned_amount_minor",
      align: "right",
      render: (value: number) => money(value),
    },
    {
      title: "Status",
      dataIndex: "status",
      width: 105,
      render: (value: string) => <Tag color={value === "posted" ? "green" : "default"}>{value}</Tag>,
    },
    {
      title: "Journal",
      dataIndex: "journal_entry_id",
      width: 115,
      render: (value: string | null) => value ? "Posted" : "—",
    },
  ];

  return (
    <div>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} xl={6}>
          <Card size="small">
            <Statistic title="Registered assets" value={assets.length} prefix={<ToolOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card size="small">
            <Statistic title="Asset cost" value={money(totals.cost)} prefix={<DollarOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card size="small">
            <Statistic title="Net book value" value={money(totals.netBookValue)} />
            <Typography.Text type="secondary">
              Accumulated: {money(totals.accumulated)}
            </Typography.Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card size="small">
            <Statistic
              title="Depreciation due"
              value={money(totals.due)}
              prefix={<CalendarOutlined />}
              valueStyle={{ color: totals.due > 0 ? "#b45309" : undefined }}
            />
          </Card>
        </Col>
      </Row>

      <FilterBar
        resultCount={filteredAssets.length}
        actions={
          canManage ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              Register asset
            </Button>
          ) : null
        }
      >
        <Space wrap>
          <Input.Search
            allowClear
            placeholder="Search asset, serial, category, or location"
            style={{ width: 330 }}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Select
            value={status}
            style={{ width: 180 }}
            onChange={setStatus}
            options={[
              { value: "all", label: "All statuses" },
              { value: "in_service", label: "In service" },
              { value: "fully_depreciated", label: "Fully depreciated" },
              { value: "disposed", label: "Disposed" },
            ]}
          />
        </Space>
      </FilterBar>

      <DataTable
        rowKey="id"
        columns={columns}
        dataSource={filteredAssets}
        pagination={{ pageSize: 20 }}
        scroll={{ x: 1380 }}
        sticky
        emptyTitle="No fixed assets"
        emptyDescription="Register equipment, fixtures, security systems, and other long-lived assets."
      />

      <Modal
        title="Register fixed asset"
        open={createOpen}
        onOk={submitAsset}
        onCancel={() => {
          setCreateOpen(false);
          form.resetFields();
        }}
        okText="Register asset"
        okButtonProps={{ loading: busy }}
        width={820}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" requiredMark={false}>
          <Row gutter={16}>
            <Col xs={24} md={16}>
              <Form.Item name="name" label="Asset name" rules={[{ required: true, message: "Enter the asset name" }]}>
                <Input placeholder="e.g. GIA Diamond Microscope" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="category" label="Category" rules={[{ required: true, message: "Select a category" }]}>
                <Select showSearch options={CATEGORIES.map((category) => ({ value: category, label: category }))} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item name="serial_number" label="Serial number">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="location" label="Location">
                <Input placeholder="Store, vault, workshop..." />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="vendor_id" label="Vendor">
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  options={vendors.map((vendor) => ({ value: vendor.id, label: vendor.name }))}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item name="acquisition_date" label="Acquisition date" rules={[{ required: true }]}>
                <DatePicker style={{ width: "100%" }} format="MM/DD/YYYY" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="in_service_date" label="In-service date" rules={[{ required: true }]}>
                <DatePicker style={{ width: "100%" }} format="MM/DD/YYYY" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="source_bill_id" label="Source bill">
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  options={bills.map((bill) => ({
                    value: bill.id,
                    label: `${bill.bill_number ?? "Draft bill"} · ${bill.vendor_name} · ${money(bill.total_minor)}`,
                  }))}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item name="cost" label={`Cost (${currency.code})`} rules={[{ required: true }]}>
                <InputNumber min={0.01} precision={currency.decimal_places} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="salvage_value" label={`Salvage value (${currency.code})`} rules={[{ required: true }]}>
                <InputNumber min={0} precision={currency.decimal_places} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="depreciation_method" label="Depreciation method" rules={[{ required: true }]}>
                <Select
                  options={[
                    { value: "straight_line", label: "Straight-line (monthly)" },
                    { value: "none", label: "Not depreciated" },
                  ]}
                />
              </Form.Item>
            </Col>
          </Row>
          {depreciationMethod === "straight_line" ? (
            <Row gutter={16}>
              <Col xs={24} md={8}>
                <Form.Item name="useful_life_months" label="Useful life" rules={[{ required: true }]}>
                  <Select
                    options={[
                      { value: 36, label: "3 years (36 months)" },
                      { value: 60, label: "5 years (60 months)" },
                      { value: 84, label: "7 years (84 months)" },
                      { value: 120, label: "10 years (120 months)" },
                    ]}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item
                  name="accumulated_depreciation_account_id"
                  label="Accumulated depreciation"
                  rules={[{ required: true }]}
                >
                  <Select
                    showSearch
                    optionFilterProp="label"
                    options={assetAccounts.map((account) => ({
                      value: account.id,
                      label: `${account.account_code} — ${account.name}`,
                    }))}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item
                  name="depreciation_expense_account_id"
                  label="Depreciation expense"
                  rules={[{ required: true }]}
                >
                  <Select
                    showSearch
                    optionFilterProp="label"
                    options={expenseAccounts.map((account) => ({
                      value: account.id,
                      label: `${account.account_code} — ${account.name}`,
                    }))}
                  />
                </Form.Item>
              </Col>
            </Row>
          ) : null}
          <Form.Item name="asset_account_id" label="Fixed asset cost account" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={assetAccounts.map((account) => ({
                value: account.id,
                label: `${account.account_code} — ${account.name}`,
              }))}
            />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="notes" label="Internal notes">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Typography.Text type="secondary">
            Straight-line depreciation uses a full-month convention beginning in the in-service month.
            Registering an asset does not duplicate the acquisition journal from its source bill.
          </Typography.Text>
        </Form>
      </Modal>

      <Modal
        title={scheduleAsset ? `${scheduleAsset.asset_number} · Depreciation schedule` : "Depreciation schedule"}
        open={Boolean(scheduleAsset)}
        onCancel={() => setScheduleAsset(null)}
        footer={<Button onClick={() => setScheduleAsset(null)}>Close</Button>}
        width={820}
        destroyOnHidden
      >
        <DataTable
          rowKey="id"
          columns={scheduleColumns}
          dataSource={schedule}
          loading={scheduleLoading}
          pagination={{ pageSize: 12 }}
          scroll={{ x: 680 }}
          emptyTitle="No depreciation schedule"
          emptyDescription="This asset is configured as non-depreciable."
        />
      </Modal>

      <Modal
        title={postAsset ? `Post depreciation · ${postAsset.asset_number}` : "Post depreciation"}
        open={Boolean(postAsset)}
        onOk={confirmPost}
        onCancel={() => setPostAsset(null)}
        okText="Post to General Ledger"
        okButtonProps={{ loading: busy }}
        destroyOnHidden
      >
        <Typography.Paragraph>
          This posts every unposted monthly period through the selected date. The transaction is atomic:
          if any month is in a closed accounting period, nothing will be posted.
        </Typography.Paragraph>
        <Typography.Paragraph strong>
          Currently due: {postAsset ? money(postAsset.due_depreciation_minor) : money(0)}
        </Typography.Paragraph>
        <Typography.Text>Post through</Typography.Text>
        <DatePicker
          value={throughDate}
          onChange={(value) => value && setThroughDate(value)}
          disabledDate={(date) => date.isAfter(dayjs(), "day")}
          format="MM/DD/YYYY"
          style={{ width: "100%", marginTop: 6 }}
        />
      </Modal>
    </div>
  );
}
