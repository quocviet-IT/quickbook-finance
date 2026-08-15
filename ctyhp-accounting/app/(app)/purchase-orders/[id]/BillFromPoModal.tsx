"use client";
import { useMemo, useState } from "react";
import { Alert, App, DatePicker, Form, Input, InputNumber, Modal, Table, Tag } from "antd";
import dayjs from "dayjs";
import type { PurchaseOrderLineRow, PurchasingConfigRow } from "@/lib/db/types";
import { threeWayMatchLine, type ThreeWayMatchResult } from "@/lib/domain/purchasing";
import { createBillFromPoAction } from "../actions";
import { longTextColumn } from "@/components/ui/long-text-column";

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
}: Props) {
  const { message } = App.useApp();
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
      width={860}
    >
      <Form form={form} layout="vertical" initialValues={{ bill_date: dayjs() }}>
        <Form.Item name="bill_date" label="Bill date" rules={[{ required: true, message: "Bill date" }]}>
          <DatePicker />
        </Form.Item>
        <Form.Item name="due_date" label="Due date">
          <DatePicker />
        </Form.Item>
        <Form.Item name="vendor_ref" label="Vendor Reference Number">
          <Input placeholder="Vendor invoice number" />
        </Form.Item>

        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={billable}
          scroll={{ x: "max-content" }}
          locale={{ emptyText: "Nothing received is waiting to be billed" }}
          columns={[
            { title: "#", dataIndex: "line_order", render: (v: number) => v + 1 },
            { title: "Description", dataIndex: "description", ...longTextColumn() },
            { title: "Received", dataIndex: "qty_received", align: "right", render: (v: number) => Number(v) },
            { title: "Already billed", dataIndex: "qty_billed", align: "right", render: (v: number) => Number(v) },
            {
              title: "Bill quantity",
              key: "qty",
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
              render: (_, r) => {
                const m = matches[r.id];
                if (!m) return "—";
                if (!m.requiresApproval) return <Tag color="green">matched</Tag>;
                return (
                  <>
                    {m.exceptions.map((e) => (
                      <Tag color="orange" key={e.kind}>
                        {e.kind} {(e.varianceBps / 100).toFixed(2)}%
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
            description={`Tolerances in force: price ${(config.price_tolerance_bps / 100).toFixed(2)}%, quantity ${(config.qty_tolerance_bps / 100).toFixed(2)}%. An approval reason is required and will be recorded against this bill.`}
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
