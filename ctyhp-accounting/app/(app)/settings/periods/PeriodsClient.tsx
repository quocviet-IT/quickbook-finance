"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Alert, App, Button, Card, Input, InputNumber, Space, Table, Tag } from "antd";
import {
  listPeriodsAction,
  generatePeriodsAction,
  closePeriodAction,
  reopenPeriodAction,
  periodCloseBlockersAction,
} from "./actions";
import type { AccountingPeriodRow } from "@/lib/db/types";

export default function PeriodsClient({
  canEdit,
  fiscalStartMonth,
}: {
  canEdit: boolean;
  fiscalStartMonth: number;
}) {
  const { message, modal } = App.useApp();
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [rows, setRows] = useState<AccountingPeriodRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async (fy: number) => {
    setLoading(true);
    const r = await listPeriodsAction(fy);
    setLoading(false);
    if (r.ok && r.data) setRows(r.data);
    else message.error(r.error ?? "Failed to load");
  };
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(year);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  const generate = async () => {
    const r = await generatePeriodsAction(year);
    if (r.ok) {
      message.success(`Generated ${r.data?.created ?? 0} period(s)`);
      void load(year);
    } else {
      message.error(r.error ?? "Failed");
    }
  };

  /**
   * Closing asks the database what stands in the way first, so the person sees
   * the variance before they commit rather than as a refusal afterwards. A
   * period that does not tie out can still be closed — with the difference
   * written down, which is then kept with the period.
   */
  const close = async (row: AccountingPeriodRow) => {
    const blockers = await periodCloseBlockersAction(row.id);
    if (!blockers.ok) {
      message.error(blockers.error ?? "Could not check the control accounts");
      return;
    }
    const problem = blockers.data ?? null;
    let reason = "";
    let varianceNote = "";

    modal.confirm({
      title: `Close ${row.label}?`,
      width: problem ? 560 : undefined,
      okText: problem ? "Close over the variance" : "Close",
      okButtonProps: problem ? { danger: true } : undefined,
      content: (
        <Space direction="vertical" style={{ width: "100%" }} size="small">
          {problem ? (
            <Alert
              type="error"
              showIcon
              message="The books do not tie out at this period end"
              description={
                <>
                  <div>{problem}</div>
                  <div style={{ marginTop: 8 }}>
                    Closing now seals that difference behind a closed period. Explain it, or
                    fix it first — the <Link href="/reports/gl-posting">posting report</Link> shows
                    where it is.
                  </div>
                </>
              }
            />
          ) : (
            <Alert
              type="success"
              showIcon
              message="Every control account ties to its subledger at this period end."
            />
          )}
          <Input
            placeholder="Reason for closing"
            onChange={(e) => {
              reason = e.target.value;
            }}
          />
          {problem ? (
            <Input.TextArea
              rows={3}
              placeholder="Explain the difference — what it is, and why closing over it is acceptable"
              onChange={(e) => {
                varianceNote = e.target.value;
              }}
            />
          ) : null}
        </Space>
      ),
      onOk: async () => {
        const r = await closePeriodAction(row.id, {
          reason,
          ...(problem ? { variance_note: varianceNote } : {}),
        });
        if (r.ok) {
          message.success(problem ? "Period closed over a recorded variance" : "Period closed");
          void load(year);
        } else {
          message.error(r.error ?? "Failed");
          throw new Error(r.error);
        }
      },
    });
  };

  const act = (row: AccountingPeriodRow, kind: "close" | "reopen") => {
    if (kind === "close") {
      void close(row);
      return;
    }
    let reason = "";
    modal.confirm({
      title: `Reopen ${row.label}?`,
      content: (
        <Input
          placeholder="Reason"
          onChange={(e) => {
            reason = e.target.value;
          }}
        />
      ),
      onOk: async () => {
        const r = await reopenPeriodAction(row.id, { reason });
        if (r.ok) {
          message.success(
            r.data?.submittedForApproval
              ? "Period reopen submitted for approval"
              : "Period reopened",
          );
          if (!r.data?.submittedForApproval) void load(year);
        } else {
          message.error(r.error ?? "Failed");
          throw new Error(r.error);
        }
      },
    });
  };

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="large">
      <Space wrap>
        <span>Fiscal year:</span>
        <InputNumber value={year} onChange={(v) => setYear((v as number) ?? year)} />
        <Tag>Fiscal year starts month {fiscalStartMonth}</Tag>
        {canEdit && (
          <Button type="primary" onClick={generate}>
            Generate periods
          </Button>
        )}
      </Space>
      <Table<AccountingPeriodRow>
        rowKey="id"
        loading={loading}
        dataSource={rows}
        pagination={false}
        columns={[
          { title: "Period", dataIndex: "label" },
          { title: "Start", dataIndex: "period_start" },
          { title: "End", dataIndex: "period_end" },
          {
            title: "Status",
            dataIndex: "status",
            render: (s: string) => <Tag color={s === "closed" ? "red" : "green"}>{s}</Tag>,
          },
          {
            title: "",
            render: (_, r) =>
              canEdit ? (
                r.status === "open" ? (
                  <Button size="small" onClick={() => act(r, "close")}>
                    Close
                  </Button>
                ) : (
                  <Button size="small" onClick={() => act(r, "reopen")}>
                    Reopen
                  </Button>
                )
              ) : null,
          },
        ]}
      />
      <Card title="Closing checklist" size="small">
        <p>Review these controls before closing a period:</p>
        <ul>
          <li>
            <Link href="/reports/ar-aging">
              Accounts Receivable aging reconciles to the Accounts Receivable control account
            </Link>
          </li>
          <li>
            <Link href="/reports/ap-aging">
              Accounts Payable aging reconciles to the Accounts Payable control account
            </Link>
          </li>
          <li><Link href="/banking/reconcile">Bank accounts are reconciled</Link></li>
          <li><Link href="/sales-tax">Sales-tax liability is reviewed</Link></li>
        </ul>
      </Card>
    </Space>
  );
}
