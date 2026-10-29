"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, App, Button, Form, Input, InputNumber, Modal, Space, Statistic, Table, Tag, Tooltip, Typography } from "antd";
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

      <Table<ReviewedStock>
        rowKey="itemId"
        size="small"
        loading={loading}
        pagination={false}
        dataSource={review?.rows ?? []}
        locale={{ emptyText: "No inventory items" }}
        rowClassName={(row) => (row.verdict === "above_nrv" ? "report-table-row--exception" : "")}
        columns={[
          {
            title: "Status",
            dataIndex: "verdict",
            width: 190,
            render: (value: StockVerdict) => (
              <Tag color={VERDICT_COLOR[value]}>{VERDICT_LABEL[value]}</Tag>
            ),
          },
          { title: "Item", dataIndex: "name" },
          {
            title: "On hand",
            dataIndex: "qtyOnHand",
            width: 90,
            align: "right",
            render: (value: number) => value.toLocaleString("en-US"),
          },
          {
            title: "Unit cost",
            dataIndex: "unitCostMinor",
            width: 110,
            align: "right",
            render: (value: number) => money(value),
          },
          {
            title: "Value",
            dataIndex: "valueMinor",
            width: 120,
            align: "right",
            render: (value: number) => <b>{money(value)}</b>,
          },
          {
            title: "Realizable",
            key: "nrv",
            width: 120,
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
            width: 120,
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
          { title: "Assessment", dataIndex: "reason" },
          ...(canWrite
            ? [
                {
                  title: "",
                  key: "action",
                  width: 130,
                  render: (_: unknown, row: ReviewedStock) =>
                    row.verdict === "above_nrv" ? (
                      <Button size="small" danger onClick={() => openWriteDown(row)}>
                        Write down
                      </Button>
                    ) : null,
                },
              ]
            : []),
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
