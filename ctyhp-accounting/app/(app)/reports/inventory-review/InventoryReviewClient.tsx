"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, App, Button, Form, Input, InputNumber, Modal, Space, Statistic, Tag, Tooltip, Typography } from "antd";
import DataTable from "@/components/ui/DataTable";
import { flexColumn } from "@/components/ui/columns";
import { COLUMN } from "@/lib/design/table-metrics";
import ReportBar, { reportFieldLabel } from "@/components/reports/ReportBar";
import { sanitizeExportFileName, type ReportExportSheet } from "@/lib/domain/report-export";
import { fromMinor } from "@/lib/domain/money";
import { useCompanyClock } from "@/components/CompanyClock";
import { formatDate, formatMoney, pluralWord } from "@/lib/format";
import {
  inventoryReviewHeadline,
  METHOD_LABEL,
  SELLING_COST_RATE,
  VERDICT_LABEL,
  type InventoryReview,
  type ReviewedStock,
  type StockVerdict,
} from "@/lib/domain/inventory-review";
import { inventoryReviewAction, writeDownInventoryAction } from "./actions";
import { tokenVar } from "@/lib/design/tokens";

const VERDICT_COLOR: Record<StockVerdict, string> = {
  above_nrv: "red",
  stale: "volcano",
  slow_moving: "gold",
  moving: "green",
  empty: "default",
};

/**
 * Status (with Write down under the tag, for someone who may post it), On
 * hand, Unit cost, Value, Realizable, Last moved. Item takes what is left, at
 * least COLUMN.TEXT_MIN, with the assessment under the name. As two columns of
 * their own beside a button column, Item and Assessment had 188px between them
 * at 1280.
 */
export const INVENTORY_REVIEW_FIXED_WIDTHS = [
  COLUMN.STATUS,
  COLUMN.QTY,
  COLUMN.MONEY,
  COLUMN.MONEY,
  COLUMN.MONEY,
  COLUMN.CODE,
] as const;

/**
 * The quarterly obsolescence review.
 *
 * Everything a reviewer needs to decide whether a line of stock is still worth
 * what the books say: how long it has sat, how fast it is selling, and what it
 * would actually fetch. Where the answer is "less than we paid", the write-down
 * can be taken from here — and never reversed, which the database enforces.
 */
export default function InventoryReviewClient({
  canWrite,
  baseCurrency,
  baseDecimals,
  companyName,
}: {
  canWrite: boolean;
  baseCurrency: string;
  baseDecimals: number;
  companyName: string;
}) {
  const { message } = App.useApp();
  const { today } = useCompanyClock();
  const [asOf, setAsOf] = useState(today);
  const [windowDays, setWindowDays] = useState(90);
  const [review, setReview] = useState<InventoryReview | null>(null);
  // The date and window the shown review was run for.
  const [ran, setRan] = useState<{ asOf: string; windowDays: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [writeDownFor, setWriteDownFor] = useState<ReviewedStock | null>(null);
  const [form] = Form.useForm();

  const money = useCallback(
    (minor: number) =>
      formatMoney(minor, baseCurrency, baseDecimals),
    [baseCurrency, baseDecimals],
  );

  const load = useCallback(async () => {
    setLoading(true);
    const res = await inventoryReviewAction(asOf, windowDays);
    setLoading(false);
    if (res.ok && res.data) {
      setReview(res.data);
      setRan({ asOf, windowDays });
    }
    else message.error(res.error ?? "Failed to review inventory");
  }, [asOf, windowDays, message]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // Loads once; the button re-runs it after a change of date or window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openWriteDown(row: ReviewedStock) {
    setWriteDownFor(row);
    form.setFieldsValue({
      nrv: fromMinor(row.nrvMinor ?? 0, baseDecimals),
      reason: "",
    });
  }

  async function submitWriteDown() {
    if (!writeDownFor) return;
    const values = await form.validateFields();
    const res = await writeDownInventoryAction({
      itemId: writeDownFor.itemId,
      date: asOf,
      nrvMinor: Math.round((values.nrv ?? 0) * 10 ** baseDecimals),
      reason: values.reason,
    });
    if (res.ok) {
      message.success("Inventory written down");
      setWriteDownFor(null);
      void load();
    } else {
      message.error(res.error ?? "Failed to write down inventory");
    }
  }

  const sheet = useMemo<ReportExportSheet | null>(() => {
    if (!review || !ran) return null;
    const major = (minor: number) => fromMinor(minor, baseDecimals);
    return {
      fileName: sanitizeExportFileName(`inventory-review-${ran.asOf}`),
      companyName,
      title: "Inventory Review",
      subtitle: `As of ${formatDate(ran.asOf)} · ${ran.windowDays}-day window`,
      currencyCode: baseCurrency,
      columns: [
        { key: "status", header: "Status", kind: "text" },
        { key: "item", header: "Item", kind: "text" },
        { key: "qty", header: "On hand", kind: "number" },
        { key: "unit", header: "Unit cost", kind: "money" },
        { key: "value", header: "Value", kind: "money" },
        { key: "nrv", header: "Realizable", kind: "money" },
        { key: "last", header: "Last moved", kind: "text" },
        { key: "reason", header: "Assessment", kind: "text" },
      ],
      rows: review.rows.map((row) => ({
        status: VERDICT_LABEL[row.verdict],
        item: row.name,
        qty: row.qtyOnHand,
        unit: major(row.unitCostMinor),
        value: major(row.valueMinor),
        nrv: row.nrvMinor === null ? null : major(row.nrvMinor),
        last: row.lastMovementOn ?? "never",
        reason: row.reason,
      })),
    };
  }, [review, ran, companyName, baseCurrency, baseDecimals]);

  const headline = review ? inventoryReviewHeadline(review) : null;

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <ReportBar
        dates={{ kind: "asOf", to: asOf, onTo: setAsOf }}
        filters={
          <Tooltip title="How far back to measure the selling rate">
            <InputNumber
              aria-label="Window in days"
              prefix={reportFieldLabel("Window")}
              suffix={reportFieldLabel("days")}
              min={30}
              max={365}
              value={windowDays}
              onChange={(v) => setWindowDays(Number(v ?? 90))}
              style={{ width: 160 }}
            />
          </Tooltip>
        }
        onRun={() => void load()}
        loading={loading}
        sheet={sheet}
        resultCount={review?.rows.length}
      />

      <div className="report-print-area">
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      {review && headline ? (
        <Alert
          type={headline.tone}
          showIcon
          message={headline.message}
          description={
            <>
              Measured at <b>{METHOD_LABEL[review.method] ?? review.method}</b>, at the lower of cost
              and selling price less {Math.round(SELLING_COST_RATE * 100)}%.
            </>
          }
        />
      ) : null}

      {review ? (
        <Space size="large" wrap>
          <Statistic title={`Inventory value (${baseCurrency})`} value={money(review.totals.valueMinor)} />
          <Statistic
            title="Slow moving or stale"
            value={money(review.totals.slowMovingMinor)}
            valueStyle={review.totals.slowMovingMinor > 0 ? { color: tokenVar("intent.warning") } : undefined}
          />
          <Statistic
            title="Write-down due"
            value={money(review.totals.shortfallMinor)}
            valueStyle={review.totals.shortfallMinor > 0 ? { color: tokenVar("intent.danger") } : undefined}
          />
          <Statistic title="Written down to date" value={money(review.totals.writtenDownMinor)} />
        </Space>
      ) : null}

      <DataTable<ReviewedStock>
        rowKey="itemId"
        loading={loading}
        pagination={false}
        rows={review?.rows ?? []}
        emptyTitle="No inventory items"
        rowClassName={(row) => (row.verdict === "above_nrv" ? "report-table-row--exception" : "")}
        columns={[
          {
            title: "Status",
            dataIndex: "verdict",
            width: INVENTORY_REVIEW_FIXED_WIDTHS[0],
            render: (value: StockVerdict, row) => (
              <Space direction="vertical" size={4}>
                <Tag color={VERDICT_COLOR[value]}>{VERDICT_LABEL[value]}</Tag>
                {canWrite && value === "above_nrv" ? (
                  <Button size="small" danger onClick={() => openWriteDown(row)}>
                    Write down
                  </Button>
                ) : null}
              </Space>
            ),
          },
          {
            ...flexColumn<ReviewedStock>({ title: "Item", dataIndex: "name" }),
            // The assessment is a sentence, so it wraps under the name rather
            // than being cut; the name alone is cut, whole on hover.
            ellipsis: false,
            render: (_: unknown, row: ReviewedStock) => (
              <>
                <div title={row.name} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {row.name}
                </div>
                {row.reason ? <Typography.Text type="secondary">{row.reason}</Typography.Text> : null}
              </>
            ),
          },
          {
            title: "On hand",
            dataIndex: "qtyOnHand",
            width: INVENTORY_REVIEW_FIXED_WIDTHS[1],
            align: "right",
            render: (value: number) => value.toLocaleString("en-US"),
          },
          {
            title: "Unit cost",
            dataIndex: "unitCostMinor",
            width: INVENTORY_REVIEW_FIXED_WIDTHS[2],
            align: "right",
            render: (value: number) => money(value),
          },
          {
            title: "Value",
            dataIndex: "valueMinor",
            width: INVENTORY_REVIEW_FIXED_WIDTHS[3],
            align: "right",
            render: (value: number) => <b>{money(value)}</b>,
          },
          {
            title: "Realizable",
            key: "nrv",
            width: INVENTORY_REVIEW_FIXED_WIDTHS[4],
            align: "right",
            render: (_: unknown, row) =>
              row.nrvMinor === null ? (
                <Tooltip title="No selling price, so nothing to measure against">
                  <Typography.Text type="secondary">—</Typography.Text>
                </Tooltip>
              ) : (
                money(row.nrvMinor)
              ),
          },
          {
            title: "Last moved",
            dataIndex: "lastMovementOn",
            width: INVENTORY_REVIEW_FIXED_WIDTHS[5],
            render: (value: string | null, row) =>
              value ? (
                <>
                  {value}
                  <br />
                  <Typography.Text type="secondary">{row.daysSinceMovement} {pluralWord(row.daysSinceMovement ?? 0, "day")}</Typography.Text>
                </>
              ) : (
                "never"
              ),
          },
        ]}
      />
      </Space>
      </div>

      <Modal
        title={writeDownFor ? `Write down ${writeDownFor.name}` : "Write down"}
        open={Boolean(writeDownFor)}
        onCancel={() => setWriteDownFor(null)}
        onOk={submitWriteDown}
        okText="Post the write-down"
        okButtonProps={{ danger: true }}
        destroyOnHidden
      >
        {writeDownFor ? (
          <Space direction="vertical" size="small" style={{ width: "100%" }}>
            <Alert
              type="warning"
              showIcon
              message="This cannot be undone"
              description={
                <>
                  Inventory written down is never written back up (ASC 330-10-35-14). The
                  difference posts to cost of sales as{" "}
                  <b>{money(writeDownFor.valueMinor - (writeDownFor.nrvMinor ?? 0))}</b> against{" "}
                  {writeDownFor.qtyOnHand} on hand carried at {money(writeDownFor.valueMinor)}.
                </>
              }
            />
            <Form form={form} layout="vertical" requiredMark={false}>
              <Form.Item
                name="nrv"
                label={`Net realizable value (${baseCurrency})`}
                tooltip="What the stock on hand would actually fetch, after the cost of selling it"
                rules={[{ required: true, message: "Enter what the stock would fetch" }]}
              >
                <InputNumber min={0} precision={baseDecimals} style={{ width: 220 }} />
              </Form.Item>
              <Form.Item
                name="reason"
                label="Why"
                rules={[{ required: true, min: 10, message: "Explain it in at least ten characters" }]}
              >
                <Input.TextArea
                  rows={3}
                  placeholder="Damaged, out of fashion, superseded by a new range…"
                />
              </Form.Item>
            </Form>
          </Space>
        ) : null}
      </Modal>
    </Space>
  );
}
