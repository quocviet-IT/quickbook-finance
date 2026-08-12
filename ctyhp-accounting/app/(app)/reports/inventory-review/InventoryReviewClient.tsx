"use client";
import { useCallback, useEffect, useState } from "react";
import { Alert, App, Button, DatePicker, Form, Input, InputNumber, Modal, Space, Statistic, Table, Tag, Tooltip, Typography } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { fromMinor } from "@/lib/domain/money";
import {
  describeInventoryReview,
  METHOD_LABEL,
  SELLING_COST_RATE,
  VERDICT_LABEL,
  type InventoryReview,
  type ReviewedStock,
  type StockVerdict,
} from "@/lib/domain/inventory-review";
import { inventoryReviewAction, writeDownInventoryAction } from "./actions";
import { TOKENS } from "@/lib/design/tokens";

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
}: {
  canWrite: boolean;
  baseCurrency: string;
  baseDecimals: number;
}) {
  const { message } = App.useApp();
  const [asOf, setAsOf] = useState<Dayjs>(dayjs());
  const [windowDays, setWindowDays] = useState(90);
  const [review, setReview] = useState<InventoryReview | null>(null);
  const [loading, setLoading] = useState(false);
  const [writeDownFor, setWriteDownFor] = useState<ReviewedStock | null>(null);
  const [form] = Form.useForm();

  const money = useCallback(
    (minor: number) =>
      fromMinor(minor, baseDecimals).toLocaleString(undefined, {
        minimumFractionDigits: baseDecimals,
      }),
    [baseDecimals],
  );

  const load = useCallback(async () => {
    setLoading(true);
    const res = await inventoryReviewAction(asOf.format("YYYY-MM-DD"), windowDays);
    setLoading(false);
    if (res.ok && res.data) setReview(res.data);
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
      date: asOf.format("YYYY-MM-DD"),
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

  const warning = review ? describeInventoryReview(review) : null;

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Space wrap>
        <DatePicker value={asOf} onChange={(d) => d && setAsOf(d)} allowClear={false} />
        <Tooltip title="How far back to measure the selling rate">
          <InputNumber
            addonBefore="Window"
            addonAfter="days"
            min={30}
            max={365}
            value={windowDays}
            onChange={(v) => setWindowDays(Number(v ?? 90))}
            style={{ width: 200 }}
          />
        </Tooltip>
        <Button type="primary" loading={loading} onClick={load}>
          Run review
        </Button>
      </Space>

      {review ? (
        <Alert
          type={warning ? "warning" : "success"}
          showIcon
          message={
            warning ??
            "Every line of stock is moving and none is carried above what it would fetch."
          }
          description={
            <>
              Inventory is measured at <b>{METHOD_LABEL[review.method] ?? review.method}</b>, at the
              lower of cost and net realisable value. Realisable value is taken as the selling price
              less {Math.round(SELLING_COST_RATE * 100)}% for the cost of selling.
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
            valueStyle={review.totals.slowMovingMinor > 0 ? { color: TOKENS.intent.warning } : undefined}
          />
          <Statistic
            title="Write-down due"
            value={money(review.totals.shortfallMinor)}
            valueStyle={review.totals.shortfallMinor > 0 ? { color: TOKENS.intent.danger } : undefined}
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
            render: (value: number) => value.toLocaleString(),
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
            title: "Realisable",
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
                  <Typography.Text type="secondary">{row.daysSinceMovement} days</Typography.Text>
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
                label={`Net realisable value (${baseCurrency})`}
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
