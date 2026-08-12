"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Col,
  DatePicker,
  Divider,
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
  Upload,
  type TableColumnsType,
  type UploadProps,
} from "antd";
import {
  BarChartOutlined,
  CalendarOutlined,
  CloudUploadOutlined,
  DollarOutlined,
  PaperClipOutlined,
  PlusOutlined,
  ScheduleOutlined,
  StopOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import DataTable from "@/components/ui/DataTable";
import FilterBar from "@/components/ui/FilterBar";
import IconActionButton from "@/components/ui/IconActionButton";
import AttachmentDrawer, {
  type AttachmentTarget,
} from "@/components/documents/AttachmentDrawer";
import type {
  AccountRow,
  AssetDepreciationScheduleRow,
  CurrencyRow,
  FixedAssetMethod,
  FixedAssetStatus,
  VendorRow,
} from "@/lib/db/types";
import type { BillWithVendor } from "@/lib/services/payables";
import type {
  FixedAssetView,
  ImportFixedAssetRow,
} from "@/lib/services/fixed-assets";
import { calculateAssetDisposal } from "@/lib/domain/fixed-assets";
import { parseCsv } from "@/lib/csv";
import { formatMoney, toMinorUnits } from "@/lib/format";
import { TOKENS } from "@/lib/design/tokens";
import {
  disposeFixedAssetAction,
  getAssetScheduleAction,
  getBillAssetSourceAction,
  importFixedAssetsAction,
  postAssetDepreciationAction,
  postAssetDepreciationBatchAction,
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

const SCHEDULE_STATUS: Record<string, { label: string; color: string }> = {
  planned: { label: "Planned", color: "default" },
  opening: { label: "Opening balance", color: "cyan" },
  posted: { label: "Posted", color: "green" },
  cancelled: { label: "Cancelled", color: "default" },
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

interface DisposalFormValues {
  disposal_date: Dayjs;
  sale_price: number;
  disposal_cost: number;
  proceeds_account_id?: string;
  gain_account_id: string;
  loss_account_id: string;
  reason: string;
}

interface FixedAssetsClientProps {
  assets: FixedAssetView[];
  assetAccounts: AccountRow[];
  expenseAccounts: AccountRow[];
  vendors: VendorRow[];
  bills: BillWithVendor[];
  currency: CurrencyRow;
  canManage: boolean;
  canPost: boolean;
  canImport: boolean;
  canDispose: boolean;
  canReadDocuments: boolean;
  canManageDocuments: boolean;
  canGovernDocuments: boolean;
  scannerConfigured: boolean;
  proceedsAccounts: AccountRow[];
  gainAccounts: AccountRow[];
  lossAccounts: AccountRow[];
  initialBillId?: string;
}

function accountOptions(accounts: AccountRow[]) {
  return accounts.map((account) => ({
    value: account.id,
    label: `${account.account_code} — ${account.name}`,
  }));
}

function validIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = dayjs(value);
  return parsed.isValid() && parsed.format("YYYY-MM-DD") === value;
}

function downloadImportTemplate(): void {
  const columns = [
    "name",
    "category",
    "description",
    "serial_number",
    "location",
    "acquisition_date",
    "in_service_date",
    "cost",
    "salvage_value",
    "useful_life_months",
    "depreciation_method",
    "asset_account_code",
    "accumulated_depreciation_account_code",
    "depreciation_expense_account_code",
    "opening_accumulated_depreciation",
    "opening_as_of_date",
    "vendor",
    "notes",
  ];
  const example = [
    "GIA Diamond Microscope",
    "Jewelry Production Equipment",
    "Gem inspection microscope",
    "GIA-001",
    "Workshop",
    "2025-01-15",
    "2025-02-01",
    "8500.00",
    "500.00",
    "60",
    "straight_line",
    "1500",
    "1590",
    "6800",
    "1600.00",
    "2026-01-31",
    "GIA Instruments",
    "Imported from prior asset register",
  ];
  const csv = `${columns.join(",")}\r\n${example.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")}\r\n`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "fixed-assets-import-template.csv";
  link.click();
  URL.revokeObjectURL(url);
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
  canImport,
  canDispose,
  canReadDocuments,
  canManageDocuments,
  canGovernDocuments,
  scannerConfigured,
  proceedsAccounts,
  gainAccounts,
  lossAccounts,
  initialBillId,
}: FixedAssetsClientProps) {
  const { message } = App.useApp();
  const [form] = Form.useForm<AssetFormValues>();
  const [disposalForm] = Form.useForm<DisposalFormValues>();
  const depreciationMethod = Form.useWatch("depreciation_method", form) ?? "straight_line";
  const disposalDate = Form.useWatch("disposal_date", disposalForm);
  const disposalSalePrice = Form.useWatch("sale_price", disposalForm) ?? 0;
  const disposalCost = Form.useWatch("disposal_cost", disposalForm) ?? 0;
  const initialBillHandled = useRef(false);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<FixedAssetStatus | "all">("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [billLoading, setBillLoading] = useState(false);
  const [scheduleAsset, setScheduleAsset] = useState<FixedAssetView | null>(null);
  const [schedule, setSchedule] = useState<AssetDepreciationScheduleRow[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [postAsset, setPostAsset] = useState<FixedAssetView | null>(null);
  const [throughDate, setThroughDate] = useState<Dayjs>(dayjs());
  const [selectedAssetIds, setSelectedAssetIds] = useState<React.Key[]>([]);
  const [batchOpen, setBatchOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState<ImportFixedAssetRow[]>([]);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [postOpeningEntries, setPostOpeningEntries] = useState(false);
  const [importFileName, setImportFileName] = useState("");
  const [disposalAsset, setDisposalAsset] = useState<FixedAssetView | null>(null);
  const [disposalSchedule, setDisposalSchedule] = useState<AssetDepreciationScheduleRow[]>([]);
  const [disposalScheduleLoading, setDisposalScheduleLoading] = useState(false);
  const [attachmentTarget, setAttachmentTarget] = useState<AttachmentTarget | null>(null);

  const money = (value: number) => formatMoney(value, currency.code, currency.decimal_places);
  const toMinor = (value: number) => toMinorUnits(value, currency.decimal_places);
  const toMajor = (value: number) => value / 10 ** currency.decimal_places;

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

  const selectedDueTotal = useMemo(
    () =>
      assets
        .filter((asset) => selectedAssetIds.includes(asset.id))
        .reduce((sum, asset) => sum + asset.due_depreciation_minor, 0),
    [assets, selectedAssetIds],
  );

  const disposalPreview = useMemo(() => {
    if (!disposalAsset) return null;
    const through = disposalDate?.format("YYYY-MM-DD");
    const additionalDepreciation = through
      ? disposalSchedule
          .filter(
            (row) =>
              row.status !== "cancelled" &&
              row.period_end <= through &&
              Number(row.posted_amount_minor) < Number(row.planned_amount_minor),
          )
          .reduce(
            (sum, row) =>
              sum + Number(row.planned_amount_minor) - Number(row.posted_amount_minor),
            0,
          )
      : 0;
    return calculateAssetDisposal(
      Number(disposalAsset.cost_minor),
      Number(disposalAsset.accumulated_depreciation_minor) + additionalDepreciation,
      toMinorUnits(disposalSalePrice, currency.decimal_places),
      toMinorUnits(disposalCost, currency.decimal_places),
    );
  }, [
    disposalAsset,
    disposalCost,
    disposalDate,
    disposalSalePrice,
    disposalSchedule,
    currency.decimal_places,
  ]);

  function resetAssetForm() {
    form.resetFields();
    form.setFieldsValue({
      acquisition_date: dayjs(),
      in_service_date: dayjs(),
      depreciation_method: "straight_line",
      salvage_value: 0,
      useful_life_months: 60,
    });
  }

  function openCreate() {
    resetAssetForm();
    setCreateOpen(true);
  }

  async function prefillFromBill(billId: string): Promise<void> {
    setBillLoading(true);
    const result = await getBillAssetSourceAction(billId);
    setBillLoading(false);
    if (!result.ok || !result.data) {
      message.error(result.error ?? "Unable to load the source bill");
      return;
    }
    const source = result.data;
    const fixedAssetLines = source.lines.filter((line) =>
      assetAccounts.some((account) => account.id === line.expenseAccountId),
    );
    const distinctAssetAccounts = [...new Set(fixedAssetLines.map((line) => line.expenseAccountId))];
    const description = fixedAssetLines.find((line) => line.description.trim())?.description;
    const values: Partial<AssetFormValues> = {
      source_bill_id: billId,
      vendor_id: source.vendorId,
      acquisition_date: dayjs(source.billDate),
      in_service_date: dayjs(source.billDate),
      description,
    };
    if (source.currencyCode === currency.code) {
      values.cost = toMajor(
        fixedAssetLines.length
          ? fixedAssetLines.reduce((sum, line) => sum + line.amountMinor, 0)
          : source.totalMinor,
      );
    } else {
      message.warning(
        `The bill is in ${source.currencyCode}. Enter the asset cost in ${currency.code} using the posted base-currency value.`,
      );
    }
    if (distinctAssetAccounts.length === 1) values.asset_account_id = distinctAssetAccounts[0];
    form.setFieldsValue(values);
  }

  useEffect(() => {
    if (!initialBillId || initialBillHandled.current) return;
    initialBillHandled.current = true;
    resetAssetForm();
    setCreateOpen(true);
    void prefillFromBill(initialBillId);
    // The initial bill is intentionally handled only once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBillId]);

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
      cost_minor: toMinor(values.cost),
      salvage_value_minor: toMinor(values.salvage_value ?? 0),
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

  async function confirmBatchPost() {
    setBusy(true);
    const result = await postAssetDepreciationBatchAction(
      selectedAssetIds.map(String),
      throughDate.format("YYYY-MM-DD"),
    );
    setBusy(false);
    if (!result.ok || !result.data) {
      message.error(result.error ?? "Unable to post the depreciation batch");
      return;
    }
    message.success(
      `Posted ${result.data.periodCount} period(s) for ${result.data.assetCount} asset(s), totaling ${money(result.data.totalMinor)}`,
    );
    setBatchOpen(false);
    setSelectedAssetIds([]);
    window.location.reload();
  }

  function parseImportFile(text: string): void {
    const records = parseCsv(text);
    const errors: string[] = [];
    const allAccountRows = [...assetAccounts, ...expenseAccounts];
    const accountByCode = new Map(
      allAccountRows.map((account) => [account.account_code.trim().toLowerCase(), account]),
    );
    const vendorByName = new Map(
      vendors.map((vendor) => [vendor.name.trim().toLowerCase(), vendor]),
    );
    const parsed: ImportFixedAssetRow[] = [];

    records.forEach((record, index) => {
      const rowNumber = index + 2;
      const method = (record.depreciation_method || "straight_line") as FixedAssetMethod;
      const cost = Number(record.cost);
      const salvage = Number(record.salvage_value || 0);
      const opening = Number(record.opening_accumulated_depreciation || 0);
      const usefulLife = Number(record.useful_life_months);
      const assetAccount = accountByCode.get(record.asset_account_code?.toLowerCase());
      const accumulatedAccount = accountByCode.get(
        record.accumulated_depreciation_account_code?.toLowerCase(),
      );
      const depreciationExpenseAccount = accountByCode.get(
        record.depreciation_expense_account_code?.toLowerCase(),
      );
      const vendor = record.vendor
        ? vendorByName.get(record.vendor.trim().toLowerCase())
        : undefined;
      const rowErrors: string[] = [];

      if (!record.name) rowErrors.push("name is required");
      if (!record.category) rowErrors.push("category is required");
      if (!validIsoDate(record.acquisition_date)) rowErrors.push("invalid acquisition_date");
      if (!validIsoDate(record.in_service_date)) rowErrors.push("invalid in_service_date");
      if (validIsoDate(record.acquisition_date) && validIsoDate(record.in_service_date) &&
          record.in_service_date < record.acquisition_date) {
        rowErrors.push("in_service_date is before acquisition_date");
      }
      if (!Number.isFinite(cost) || cost <= 0) rowErrors.push("cost must be greater than zero");
      if (
        !Number.isFinite(salvage) ||
        salvage < 0 ||
        salvage > cost ||
        (method === "straight_line" && salvage === cost)
      ) {
        rowErrors.push(
          method === "straight_line"
            ? "salvage_value must be non-negative and below cost"
            : "salvage_value must be non-negative and no greater than cost",
        );
      }
      if (!["straight_line", "none"].includes(method)) {
        rowErrors.push("depreciation_method must be straight_line or none");
      }
      if (!assetAccount || assetAccount.account_type !== "fixed_asset") {
        rowErrors.push("asset_account_code was not found as a fixed-asset account");
      }
      if (method === "straight_line") {
        if (!Number.isInteger(usefulLife) || usefulLife < 1) {
          rowErrors.push("useful_life_months must be a positive whole number");
        }
        if (!accumulatedAccount || accumulatedAccount.account_type !== "fixed_asset") {
          rowErrors.push("accumulated_depreciation_account_code is invalid");
        }
        if (
          !depreciationExpenseAccount ||
          !["expense", "other_expense"].includes(depreciationExpenseAccount.account_type)
        ) {
          rowErrors.push("depreciation_expense_account_code is invalid");
        }
      }
      if (!Number.isFinite(opening) || opening < 0 || opening > cost - salvage) {
        rowErrors.push("opening accumulated depreciation exceeds the depreciable basis");
      }
      if (method === "none" && opening !== 0) {
        rowErrors.push("a non-depreciable asset cannot have opening depreciation");
      }
      if (
        opening > 0 &&
        (!validIsoDate(record.opening_as_of_date) ||
          record.opening_as_of_date < record.in_service_date)
      ) {
        rowErrors.push("opening_as_of_date is required and cannot precede in_service_date");
      }
      if (record.vendor && !vendor) rowErrors.push(`vendor "${record.vendor}" was not found`);

      if (rowErrors.length) {
        errors.push(`Row ${rowNumber}: ${rowErrors.join("; ")}`);
        return;
      }
      parsed.push({
        name: record.name,
        description: record.description || null,
        category: record.category,
        serial_number: record.serial_number || null,
        location: record.location || null,
        acquisition_date: record.acquisition_date,
        in_service_date: record.in_service_date,
        currency_code: currency.code,
        cost_minor: toMinor(cost),
        salvage_value_minor: toMinor(salvage),
        useful_life_months: method === "straight_line" ? usefulLife : null,
        depreciation_method: method,
        asset_account_id: assetAccount!.id,
        accumulated_depreciation_account_id:
          method === "straight_line" ? accumulatedAccount!.id : null,
        depreciation_expense_account_id:
          method === "straight_line" ? depreciationExpenseAccount!.id : null,
        vendor_id: vendor?.id ?? null,
        opening_accumulated_depreciation_minor: toMinor(opening),
        opening_as_of_date: record.opening_as_of_date || null,
        notes: record.notes || null,
      });
    });

    if (records.length === 0) errors.push("The CSV must contain a header row and at least one asset.");
    setImportRows(parsed);
    setImportErrors(errors);
  }

  const importUploadProps: UploadProps = {
    accept: ".csv,text/csv",
    maxCount: 1,
    showUploadList: false,
    beforeUpload: async (file) => {
      setImportFileName(file.name);
      setImportRows([]);
      setImportErrors([]);
      try {
        parseImportFile(await file.text());
      } catch (error) {
        setImportErrors([error instanceof Error ? error.message : "Unable to read the CSV file"]);
      }
      return false;
    },
  };

  async function confirmImport() {
    if (postOpeningEntries && importRows.some((row) => !row.opening_as_of_date)) {
      message.error("Every row needs opening_as_of_date when opening journal entries are posted");
      return;
    }
    setBusy(true);
    const result = await importFixedAssetsAction(importRows, postOpeningEntries);
    setBusy(false);
    if (!result.ok || !result.data) {
      message.error(result.error ?? "Unable to import fixed assets");
      return;
    }
    message.success(
      `Imported ${result.data.importedCount} asset(s) and posted ${result.data.openingJournalCount} opening journal(s)`,
    );
    setImportOpen(false);
    window.location.reload();
  }

  async function openDisposal(asset: FixedAssetView) {
    setDisposalAsset(asset);
    setDisposalSchedule([]);
    disposalForm.resetFields();
    disposalForm.setFieldsValue({
      disposal_date: dayjs(),
      sale_price: 0,
      disposal_cost: 0,
      proceeds_account_id: proceedsAccounts[0]?.id,
      gain_account_id:
        gainAccounts.find((account) => account.account_code === "7990")?.id ??
        gainAccounts[0]?.id,
      loss_account_id:
        lossAccounts.find((account) => account.account_code === "8990")?.id ??
        lossAccounts[0]?.id,
      reason: "",
    });
    setDisposalScheduleLoading(true);
    const result = await getAssetScheduleAction(asset.id);
    setDisposalScheduleLoading(false);
    if (result.ok && result.data) setDisposalSchedule(result.data);
    else message.error(result.error ?? "Unable to load depreciation before disposal");
  }

  async function confirmDisposal() {
    if (!disposalAsset || !disposalPreview) return;
    const values = await disposalForm.validateFields();
    if (disposalPreview.netProceedsMinor !== 0 && !values.proceeds_account_id) {
      message.error("Select the account that receives or pays the net disposal amount");
      return;
    }
    setBusy(true);
    const result = await disposeFixedAssetAction({
      assetId: disposalAsset.id,
      disposalDate: values.disposal_date.format("YYYY-MM-DD"),
      salePriceMinor: toMinor(values.sale_price),
      disposalCostMinor: toMinor(values.disposal_cost),
      proceedsAccountId:
        disposalPreview.netProceedsMinor !== 0 ? values.proceeds_account_id ?? null : null,
      gainAccountId: values.gain_account_id,
      lossAccountId: values.loss_account_id,
      reason: values.reason,
    });
    setBusy(false);
    if (!result.ok || !result.data) {
      message.error(result.error ?? "Unable to dispose the fixed asset");
      return;
    }
    message.success(
      `${disposalAsset.asset_number} disposed with ${
        result.data.gainLossMinor > 0
          ? `a gain of ${money(result.data.gainLossMinor)}`
          : result.data.gainLossMinor < 0
            ? `a loss of ${money(Math.abs(result.data.gainLossMinor))}`
            : "no gain or loss"
      }`,
    );
    setDisposalAsset(null);
    window.location.reload();
  }

  const columns: TableColumnsType<FixedAssetView> = [
    {
      title: "Asset",
      key: "asset",
      width: 280,
      render: (_value, asset) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>
            {asset.asset_number} · {asset.name}
          </Typography.Text>
          <Typography.Text type="secondary">{asset.category}</Typography.Text>
        </Space>
      ),
    },
    { title: "In service", dataIndex: "in_service_date", width: 115 },
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
      title: "Actions",
      key: "action",
      width: 315,
      fixed: "right",
      render: (_value, asset) => (
        <Space size={4}>
          {canReadDocuments ? (
            <IconActionButton
              label="View fixed asset attachments"
              icon={<PaperClipOutlined />}
              onClick={() =>
                setAttachmentTarget({
                  entityType: "fixed_asset",
                  entityId: asset.id,
                  label: `${asset.asset_number} · ${asset.name}`,
                })
              }
            />
          ) : null}
          <Button size="small" icon={<ScheduleOutlined />} onClick={() => void openSchedule(asset)}>
            Schedule
          </Button>
          {canPost && asset.due_depreciation_minor > 0 && asset.status !== "disposed" ? (
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
          {canDispose && asset.status !== "disposed" ? (
            <Button
              size="small"
              icon={<StopOutlined />}
              onClick={() => void openDisposal(asset)}
            >
              Dispose
            </Button>
          ) : null}
        </Space>
      ),
    },
  ];

  const scheduleColumns: TableColumnsType<AssetDepreciationScheduleRow> = [
    { title: "Period", dataIndex: "sequence_number", width: 75 },
    { title: "From", dataIndex: "period_start", width: 110 },
    { title: "Through", dataIndex: "period_end", width: 110 },
    {
      title: "Planned",
      dataIndex: "planned_amount_minor",
      align: "right",
      render: (value: number) => money(value),
    },
    {
      title: "Recognized",
      dataIndex: "posted_amount_minor",
      align: "right",
      render: (value: number) => money(value),
    },
    {
      title: "Status",
      dataIndex: "status",
      width: 135,
      render: (value: string) => {
        const config = SCHEDULE_STATUS[value] ?? { label: value, color: "default" };
        return <Tag color={config.color}>{config.label}</Tag>;
      },
    },
    {
      title: "Journal",
      dataIndex: "journal_entry_id",
      width: 105,
      render: (value: string | null) =>
        value ? <Link href={`/journal?entry=${value}`}>View entry</Link> : "—",
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
              valueStyle={{ color: totals.due > 0 ? TOKENS.intent.warning : undefined }}
            />
          </Card>
        </Col>
      </Row>

      <FilterBar
        resultCount={filteredAssets.length}
        actions={
          <Space wrap>
            <Link href="/reports/fixed-assets">
              <Button icon={<BarChartOutlined />}>Reports</Button>
            </Link>
            {canImport ? (
              <Button icon={<CloudUploadOutlined />} onClick={() => setImportOpen(true)}>
                Import
              </Button>
            ) : null}
            {canManage ? (
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                Register asset
              </Button>
            ) : null}
          </Space>
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
          {canPost && selectedAssetIds.length > 0 ? (
            <Button
              icon={<CalendarOutlined />}
              onClick={() => {
                setThroughDate(dayjs());
                setBatchOpen(true);
              }}
            >
              Post selected ({selectedAssetIds.length})
            </Button>
          ) : null}
        </Space>
      </FilterBar>

      <DataTable
        rowKey="id"
        rowSelection={
          canPost
            ? {
                selectedRowKeys: selectedAssetIds,
                onChange: setSelectedAssetIds,
                getCheckboxProps: (asset) => ({
                  disabled: asset.status === "disposed" || asset.due_depreciation_minor <= 0,
                  name: asset.asset_number,
                }),
              }
            : undefined
        }
        columns={columns}
        dataSource={filteredAssets}
        pagination={{ pageSize: 20 }}
        scroll={{ x: 1450 }}
        sticky
        emptyTitle="No fixed assets"
        emptyDescription="Register equipment, fixtures, security systems, and other long-lived assets."
      />

      <AttachmentDrawer
        target={attachmentTarget}
        canManage={canManageDocuments}
        canGovern={canGovernDocuments}
        scannerConfigured={scannerConfigured}
        onClose={() => setAttachmentTarget(null)}
      />

      <Modal
        title="Register fixed asset"
        open={createOpen}
        onOk={() => void submitAsset()}
        onCancel={() => {
          setCreateOpen(false);
          form.resetFields();
        }}
        okText="Register asset"
        okButtonProps={{ loading: busy }}
        width={860}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" requiredMark={false}>
          <Row gutter={16}>
            <Col xs={24} md={16}>
              <Form.Item
                name="name"
                label="Asset name"
                rules={[{ required: true, message: "Enter the asset name" }]}
              >
                <Input placeholder="e.g. GIA Diamond Microscope" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item
                name="category"
                label="Category"
                rules={[{ required: true, message: "Select a category" }]}
              >
                <Select
                  showSearch
                  options={CATEGORIES.map((category) => ({ value: category, label: category }))}
                />
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
              <Form.Item
                name="acquisition_date"
                label="Acquisition date"
                rules={[{ required: true }]}
              >
                <DatePicker style={{ width: "100%" }} format="MM/DD/YYYY" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item
                name="in_service_date"
                label="In-service date"
                dependencies={["acquisition_date"]}
                rules={[
                  { required: true },
                  ({ getFieldValue }) => ({
                    validator(_, value: Dayjs) {
                      const acquisition = getFieldValue("acquisition_date") as Dayjs | undefined;
                      return !value || !acquisition || !value.isBefore(acquisition, "day")
                        ? Promise.resolve()
                        : Promise.reject(
                            new Error("In-service date cannot precede acquisition date"),
                          );
                    },
                  }),
                ]}
              >
                <DatePicker style={{ width: "100%" }} format="MM/DD/YYYY" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="source_bill_id" label="Source bill">
                <Select
                  allowClear
                  showSearch
                  loading={billLoading}
                  optionFilterProp="label"
                  onChange={(billId) => billId && void prefillFromBill(billId)}
                  options={bills.map((bill) => ({
                    value: bill.id,
                    label: `${bill.bill_number ?? "Bill"} · ${bill.vendor_name} · ${money(bill.total_minor)}`,
                  }))}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item
                name="cost"
                label={`Cost (${currency.code})`}
                dependencies={["salvage_value", "depreciation_method"]}
                rules={[
                  { required: true },
                  ({ getFieldValue }) => ({
                    validator(_, value: number) {
                      const salvage = Number(getFieldValue("salvage_value") ?? 0);
                      const method = getFieldValue(
                        "depreciation_method",
                      ) as FixedAssetMethod;
                      return value > 0 &&
                        (method === "straight_line" ? value > salvage : value >= salvage)
                        ? Promise.resolve()
                        : Promise.reject(
                            new Error(
                              method === "straight_line"
                                ? "Cost must exceed salvage value"
                                : "Cost cannot be below salvage value",
                            ),
                          );
                    },
                  }),
                ]}
              >
                <InputNumber
                  min={0.01}
                  precision={currency.decimal_places}
                  style={{ width: "100%" }}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item
                name="salvage_value"
                label={`Salvage value (${currency.code})`}
                rules={[{ required: true }]}
              >
                <InputNumber
                  min={0}
                  precision={currency.decimal_places}
                  style={{ width: "100%" }}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item
                name="depreciation_method"
                label="Depreciation method"
                rules={[{ required: true }]}
              >
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
                <Form.Item
                  name="useful_life_months"
                  label="Useful life"
                  rules={[{ required: true }]}
                >
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
                  <Select showSearch optionFilterProp="label" options={accountOptions(assetAccounts)} />
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
                    options={accountOptions(expenseAccounts)}
                  />
                </Form.Item>
              </Col>
            </Row>
          ) : null}
          <Form.Item
            name="asset_account_id"
            label="Fixed asset cost account"
            rules={[{ required: true }]}
          >
            <Select showSearch optionFilterProp="label" options={accountOptions(assetAccounts)} />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="notes" label="Internal notes">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Alert
            type="info"
            showIcon
            message="Book depreciation"
            description="Straight-line depreciation uses a full-month convention beginning in the in-service month. Registering an asset from a posted bill links the records without duplicating the acquisition journal."
          />
        </Form>
      </Modal>

      <Modal
        title={
          scheduleAsset
            ? `${scheduleAsset.asset_number} · Depreciation schedule`
            : "Depreciation schedule"
        }
        open={Boolean(scheduleAsset)}
        onCancel={() => setScheduleAsset(null)}
        footer={<Button onClick={() => setScheduleAsset(null)}>Close</Button>}
        width={900}
        destroyOnHidden
      >
        <DataTable
          rowKey="id"
          columns={scheduleColumns}
          dataSource={schedule}
          loading={scheduleLoading}
          pagination={{ pageSize: 12 }}
          scroll={{ x: 780 }}
          emptyTitle="No depreciation schedule"
          emptyDescription="This asset is configured as non-depreciable."
        />
      </Modal>

      <Modal
        title={postAsset ? `Post depreciation · ${postAsset.asset_number}` : "Post depreciation"}
        open={Boolean(postAsset)}
        onOk={() => void confirmPost()}
        onCancel={() => setPostAsset(null)}
        okText="Post to General Ledger"
        okButtonProps={{ loading: busy }}
        destroyOnHidden
      >
        <Typography.Paragraph>
          This posts every unposted monthly period through the selected date. The transaction is
          atomic: if any month is in a closed accounting period, nothing will be posted.
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

      <Modal
        title="Post monthly depreciation batch"
        open={batchOpen}
        onOk={() => void confirmBatchPost()}
        onCancel={() => setBatchOpen(false)}
        okText={`Post ${selectedAssetIds.length} asset(s)`}
        okButtonProps={{ loading: busy, disabled: selectedAssetIds.length === 0 }}
        destroyOnHidden
      >
        <Alert
          type="warning"
          showIcon
          message="Atomic General Ledger posting"
          description="Every due month for the selected assets is posted together. A closed period or invalid asset stops the entire batch."
          style={{ marginBottom: 16 }}
        />
        <Row gutter={16}>
          <Col span={12}>
            <Statistic title="Selected assets" value={selectedAssetIds.length} />
          </Col>
          <Col span={12}>
            <Statistic title="Currently due" value={money(selectedDueTotal)} />
          </Col>
        </Row>
        <Divider />
        <Typography.Text>Post through</Typography.Text>
        <DatePicker
          value={throughDate}
          onChange={(value) => value && setThroughDate(value)}
          disabledDate={(date) => date.isAfter(dayjs(), "day")}
          format="MM/DD/YYYY"
          style={{ width: "100%", marginTop: 6 }}
        />
      </Modal>

      <Modal
        title="Import existing fixed assets"
        open={importOpen}
        onOk={() => void confirmImport()}
        onCancel={() => {
          setImportOpen(false);
          setImportRows([]);
          setImportErrors([]);
          setImportFileName("");
        }}
        okText={`Import ${importRows.length} asset(s)`}
        okButtonProps={{
          loading: busy,
          disabled: importRows.length === 0 || importErrors.length > 0,
        }}
        width={900}
        destroyOnHidden
      >
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Alert
            type="info"
            showIcon
            message="Bring forward the existing asset register"
            description="Use account codes and vendor names already configured in this company. Dates must use YYYY-MM-DD and monetary values use dollars, not cents."
          />
          <Space wrap>
            <Upload {...importUploadProps}>
              <Button icon={<CloudUploadOutlined />}>Choose CSV</Button>
            </Upload>
            <Button type="link" onClick={downloadImportTemplate}>
              Download CSV template
            </Button>
            {importFileName ? <Typography.Text>{importFileName}</Typography.Text> : null}
          </Space>
          <Checkbox
            checked={postOpeningEntries}
            onChange={(event) => setPostOpeningEntries(event.target.checked)}
          >
            Post opening cost, accumulated depreciation, and net book value to the General Ledger
          </Checkbox>
          {postOpeningEntries ? (
            <Alert
              type="warning"
              showIcon
              message="Opening entries will affect the General Ledger"
              description="Use this only when these balances have not already been posted. Every imported row must include opening_as_of_date."
            />
          ) : (
            <Typography.Text type="secondary">
              Without opening entries, the import builds the subledger only. Reconcile the register
              to existing General Ledger balances after import.
            </Typography.Text>
          )}
          {importErrors.length ? (
            <Alert
              type="error"
              showIcon
              message={`${importErrors.length} validation issue(s)`}
              description={
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  {importErrors.slice(0, 10).map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                  {importErrors.length > 10 ? (
                    <li>{importErrors.length - 10} additional issue(s)</li>
                  ) : null}
                </ul>
              }
            />
          ) : null}
          {importRows.length ? (
            <DataTable
              rowKey={(_row, index) => String(index)}
              dataSource={importRows.slice(0, 10)}
              pagination={false}
              columns={[
                { title: "Asset", dataIndex: "name" },
                { title: "Category", dataIndex: "category" },
                { title: "In service", dataIndex: "in_service_date" },
                {
                  title: "Cost",
                  dataIndex: "cost_minor",
                  align: "right",
                  render: (value: number) => money(value),
                },
                {
                  title: "Opening depreciation",
                  dataIndex: "opening_accumulated_depreciation_minor",
                  align: "right",
                  render: (value: number) => money(value),
                },
              ]}
              emptyTitle="No valid import rows"
            />
          ) : null}
        </Space>
      </Modal>

      <Modal
        title={
          disposalAsset
            ? `Dispose ${disposalAsset.asset_number} · ${disposalAsset.name}`
            : "Dispose fixed asset"
        }
        open={Boolean(disposalAsset)}
        onOk={() => void confirmDisposal()}
        onCancel={() => setDisposalAsset(null)}
        okText="Post disposal"
        okButtonProps={{ loading: busy || disposalScheduleLoading }}
        width={760}
        destroyOnHidden
      >
        <Alert
          type="warning"
          showIcon
          message="This retires the asset permanently"
          description="The system first posts completed depreciation through the disposal date, removes cost and accumulated depreciation, then records net proceeds and the resulting gain or loss."
          style={{ marginBottom: 16 }}
        />
        <Form form={disposalForm} layout="vertical" requiredMark={false}>
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item
                name="disposal_date"
                label="Disposal date"
                rules={[
                  { required: true },
                  {
                    validator(_, value: Dayjs) {
                      if (!value || !disposalAsset) return Promise.resolve();
                      if (value.isBefore(dayjs(disposalAsset.in_service_date), "day")) {
                        return Promise.reject(
                          new Error("Disposal cannot precede the in-service date"),
                        );
                      }
                      return Promise.resolve();
                    },
                  },
                ]}
              >
                <DatePicker
                  style={{ width: "100%" }}
                  format="MM/DD/YYYY"
                  disabledDate={(date) => date.isAfter(dayjs(), "day")}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item
                name="sale_price"
                label={`Sale price (${currency.code})`}
                rules={[{ required: true }]}
              >
                <InputNumber
                  min={0}
                  precision={currency.decimal_places}
                  style={{ width: "100%" }}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item
                name="disposal_cost"
                label={`Disposal cost (${currency.code})`}
                rules={[{ required: true }]}
              >
                <InputNumber
                  min={0}
                  precision={currency.decimal_places}
                  style={{ width: "100%" }}
                />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="proceeds_account_id" label="Cash / proceeds account">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              options={accountOptions(proceedsAccounts)}
            />
          </Form.Item>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item
                name="gain_account_id"
                label="Gain account"
                rules={[{ required: true }]}
              >
                <Select
                  showSearch
                  optionFilterProp="label"
                  options={accountOptions(gainAccounts)}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="loss_account_id"
                label="Loss account"
                rules={[{ required: true }]}
              >
                <Select
                  showSearch
                  optionFilterProp="label"
                  options={accountOptions(lossAccounts)}
                />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            name="reason"
            label="Reason"
            rules={[{ required: true, message: "Enter the sale, retirement, or loss reason" }]}
          >
            <Input.TextArea rows={2} placeholder="Sold, retired, lost, damaged..." />
          </Form.Item>
        </Form>
        {disposalPreview ? (
          <Card size="small" loading={disposalScheduleLoading}>
            <Row gutter={[16, 16]}>
              <Col xs={24} sm={8}>
                <Statistic
                  title="Book value at disposal"
                  value={money(disposalPreview.netBookValueMinor)}
                />
              </Col>
              <Col xs={24} sm={8}>
                <Statistic title="Net proceeds" value={money(disposalPreview.netProceedsMinor)} />
              </Col>
              <Col xs={24} sm={8}>
                <Statistic
                  title={disposalPreview.gainLossMinor >= 0 ? "Estimated gain" : "Estimated loss"}
                  value={money(Math.abs(disposalPreview.gainLossMinor))}
                  valueStyle={{
                    color: disposalPreview.gainLossMinor >= 0 ? TOKENS.money.positive : TOKENS.money.negative,
                  }}
                />
              </Col>
            </Row>
          </Card>
        ) : null}
      </Modal>
    </div>
  );
}
