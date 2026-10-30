"use client";
import { useMemo, useState } from "react";
import { Alert, App, DatePicker, Form, Input, InputNumber, Modal, Tag } from "antd";
import dayjs from "dayjs";
import { useCompanyClock } from "@/components/CompanyClock";
import type { PurchaseOrderLineRow, PurchasingConfigRow } from "@/lib/db/types";
import { threeWayMatchLine, type ThreeWayMatchResult } from "@/lib/domain/purchasing";
import { humanizeStatus } from "@/lib/domain/status-label";
import { createBillFromPoAction } from "../actions";
import DataTable from "@/components/ui/DataTable";
import { flexColumn } from "@/components/ui/columns";
import { COLUMN } from "@/lib/design/table-metrics";

/** The dialog's width; its body, where the lines sit, is 48px less. */
export const BILL_FROM_PO_MODAL_WIDTH = 860;

/**
 * #, Received, Already billed, Bill quantity, Unit cost and Match. Description
 * takes what is left, at least COLUMN.TEXT_MIN. The two boxes are the width of
 * an amount; Match holds up to two tags, which wrap.
 */
export const BILL_FROM_PO_FIXED_WIDTHS = [
  COLUMN.ACTION,
  COLUMN.QTY,
  COLUMN.QTY,
  COLUMN.MONEY,
  COLUMN.MONEY,
  COLUMN.STATUS,
] as const;

interface LineState {
  quantity: number;
  unitCost: number; // decimal
}

interface Props {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  purchaseOrderId: string;
  lines: PurchaseOrderLineRow[];
  config: PurchasingConfigRow;
  currencyCode: string;
  decimals: number;
  /** Holds `po.variance_approve`: may bill past the tolerance, with a reason. */
  canApproveVariance: boolean;
}

/**
 * Convert received PO lines into a draft bill. The three-way-match preview here
 * uses the same domain helper the server re-derives in SQL — the preview only
 * decides whether to ask for a reason; the server decides whether to accept it.
 *
 * The body mounts only while the dialog is open, so its state initializes from
 * the current lines without an effect.
 */
export default function BillFromPoModal(props: Props) {
  if (!props.open) return null;
  return <BillFromPoModalBody {...props} />;
}

function BillFromPoModalBody({
  onClose,
  onDone,
  purchaseOrderId,
  lines,
  config,
  currencyCode,
  decimals,
  canApproveVariance,
}: Props) {
  const { message } = App.useApp();
  const { today } = useCompanyClock();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  const billable = useMemo(
    () => lines.filter((l) => Number(l.qty_received) > Number(l.qty_billed)),
    [lines],
  );
  const [state, setState] = useState<Record<string, LineState>>(() =>
    Object.fromEntries(
      lines
        .filter((l) => Number(l.qty_received) > Number(l.qty_billed))
        .map((l) => [
          l.id,
          {
            quantity: Number(l.qty_received) - Number(l.qty_billed),
            unitCost: l.unit_cost_minor / 10 ** decimals,
          },
        ]),
    ),
  );

  const matches = useMemo(() => {
    const out: Record<string, ThreeWayMatchResult> = {};
    for (const l of billable) {
      const s = state[l.id];
      if (!s || s.quantity <= 0) continue;
      out[l.id] = threeWayMatchLine(
        {
          orderedQty: Number(l.quantity),
          receivedQty: Number(l.qty_received),
          alreadyBilledQty: Number(l.qty_billed),
          billQty: s.quantity,
          poUnitCostMinor: l.unit_cost_minor,
          billUnitCostMinor: Math.round(s.unitCost * 10 ** decimals),
        },
        { priceToleranceBps: config.price_tolerance_bps, qtyToleranceBps: config.qty_tolerance_bps },
      );
    }
    return out;
  }, [billable, state, config, decimals]);

  const needsReason = Object.values(matches).some((m) => m.requiresApproval);
  // Past the tolerance, only someone holding po.variance_approve may bill it.
  const varianceBlocked = needsReason && !canApproveVariance;

  async function submit() {
    const values = await form.validateFields();
    const payload = Object.entries(state)
      .filter(([, s]) => s.quantity > 0)
      .map(([id, s]) => ({
        purchase_order_line_id: id,
        quantity: s.quantity,
        unit_cost_minor: Math.round(s.unitCost * 10 ** decimals),
      }));
    if (payload.length === 0) {
      message.error("Bill at least one line");
      return;
    }
    setSaving(true);
    const res = await createBillFromPoAction(purchaseOrderId, {
      bill_date: values.bill_date.format("YYYY-MM-DD"),
      due_date: values.due_date ? values.due_date.format("YYYY-MM-DD") : null,
      vendor_ref: values.vendor_ref ?? null,
      memo: values.memo ?? null,
      lines: payload,
      variance_reason: values.variance_reason ?? null,
    });
    setSaving(false);
    if (res.ok) {
      message.success("Draft bill created — review and post it from the Bills page");
      onDone();
    } else {
      message.error(res.error ?? "Failed to create bill");
    }
  }

  return (
    <Modal
      title="Create a bill from this purchase order"
      open
      onOk={submit}
      onCancel={onClose}
      confirmLoading={saving}
      okText="Create draft bill"
      okButtonProps={{ disabled: varianceBlocked }}
      width={BILL_FROM_PO_MODAL_WIDTH}
    >
      <Form form={form} layout="vertical" initialValues={{ bill_date: dayjs(today) }}>
        <Form.Item name="bill_date" label="Bill date" rules={[{ required: true, message: "Bill date" }]}>
          <DatePicker />
        </Form.Item>
        <Form.Item name="due_date" label="Due date">
          <DatePicker />
        </Form.Item>
        <Form.Item name="vendor_ref" label="Vendor Reference Number">
          <Input placeholder="Vendor invoice number" />
        </Form.Item>

        {/* Every row stays visible: the quantities and costs are edited here. */}
        <DataTable<PurchaseOrderLineRow>
          rowKey="id"
          pagination={false}
          rows={billable}
          emptyTitle="Nothing received is waiting to be billed"
          columns={[
            { title: "#", dataIndex: "line_order", width: BILL_FROM_PO_FIXED_WIDTHS[0], render: (v: number) => v + 1 },
            flexColumn<PurchaseOrderLineRow>({ title: "Description", dataIndex: "description" }),
            { title: "Received", dataIndex: "qty_received", width: BILL_FROM_PO_FIXED_WIDTHS[1], align: "right", render: (v: number) => Number(v) },
            { title: "Already billed", dataIndex: "qty_billed", width: BILL_FROM_PO_FIXED_WIDTHS[2], align: "right", render: (v: number) => Number(v) },
            {
              title: "Bill quantity",
              key: "qty",
              width: BILL_FROM_PO_FIXED_WIDTHS[3],
              align: "right",
              render: (_, r) => (
                <InputNumber
                  min={0}
                  value={state[r.id]?.quantity ?? 0}
                  aria-label={`Quantity to bill for line ${r.line_order + 1}`}
                  onChange={(v) =>
                    setState((s) => ({ ...s, [r.id]: { ...s[r.id], quantity: Number(v ?? 0) } }))
                  }
                />
              ),
            },
            {
              title: `Unit cost (${currencyCode})`,
              key: "cost",
              width: BILL_FROM_PO_FIXED_WIDTHS[4],
              align: "right",
              render: (_, r) => (
                <InputNumber
                  min={0}
                  precision={decimals}
                  value={state[r.id]?.unitCost ?? 0}
                  aria-label={`Billed unit cost for line ${r.line_order + 1}`}
                  onChange={(v) =>
                    setState((s) => ({ ...s, [r.id]: { ...s[r.id], unitCost: Number(v ?? 0) } }))
                  }
                />
              ),
            },
            {
              title: "Match",
              key: "match",
              width: BILL_FROM_PO_FIXED_WIDTHS[5],
              render: (_, r) => {
                const m = matches[r.id];
                if (!m) return "—";
                if (!m.requiresApproval) return <Tag color="green">Matched</Tag>;
                return (
                  <>
                    {m.exceptions.map((e) => (
                      <Tag color="orange" key={e.kind}>
                        {humanizeStatus(e.kind)} {(e.varianceBps / 100).toFixed(2)}%
                      </Tag>
                    ))}
                  </>
                );
              },
            },
          ]}
        />

        {needsReason && (
          <Alert
            type="warning"
            showIcon
            style={{ marginTop: 12 }}
            message="Outside the matching tolerance"
            description={`Tolerances in force: price ${(config.price_tolerance_bps / 100).toFixed(2)}%, quantity ${(config.qty_tolerance_bps / 100).toFixed(2)}%. ${
              varianceBlocked
                ? "Billing past them needs the Approve match variances permission. Bill within them, or ask someone who holds it."
                : "An approval reason is required and will be recorded against this bill."
            }`}
          />
        )}

        <Form.Item
          name="variance_reason"
          label="Variance approval reason"
          style={{ marginTop: 12 }}
          rules={needsReason ? [{ required: true, message: "A reason is required to approve the variance" }] : []}
        >
          <Input.TextArea rows={2} placeholder="Why is this variance acceptable?" />
        </Form.Item>
        <Form.Item name="memo" label="Memo">
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
