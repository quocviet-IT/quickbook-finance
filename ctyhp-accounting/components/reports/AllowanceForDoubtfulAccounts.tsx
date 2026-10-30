"use client";
import { useEffect, useState } from "react";
import { App, Alert, Button, Card, Space, Tag } from "antd";
import ReportTable, { SummaryCell, SummaryRow } from "@/components/ui/ReportTable";
import { flexColumn } from "@/components/ui/columns";
import { COLUMN } from "@/lib/design/table-metrics";
import type { AfdaEvaluation } from "@/lib/services/aging";
import {
  afdaEvaluationAction,
  postAfdaAdjustmentAction,
} from "@/app/(app)/reports/ar-aging/actions";

const BUCKET_LABEL: Record<string, string> = {
  current: "Current",
  d1_30: "1–30",
  d31_60: "31–60",
  d61_90: "61–90",
  d90_plus: "90+",
};

/**
 * Open balance, Reserve rate, Reserve. The bucket's name takes what is left, at
 * least COLUMN.TEXT_MIN; it is short, but it also carries the total's label.
 */
export const AFDA_FIXED_WIDTHS = [COLUMN.MONEY, COLUMN.QTY, COLUMN.MONEY] as const;

/**
 * The estimate that sits beside the aging: how much of what is owed will not
 * arrive.
 *
 * The aging is the control — what is outstanding and how late. This is the
 * valuation, and the two belong on one screen because the reserve is derived
 * from the buckets directly above it. Both figures come from the database, so
 * what is shown and what would post cannot disagree.
 *
 * Nothing posts without being asked. A reserve is an accounting judgement with
 * a rate somebody chose, not a number a report should quietly book.
 */
export default function AllowanceForDoubtfulAccounts({
  asOf,
  money,
  currencyCode,
  canPost,
}: {
  asOf: string;
  money: (minor: number) => string;
  currencyCode: string;
  /** Holds `journal.post`; the RPC refuses anyone else regardless. */
  canPost: boolean;
}) {
  const { message } = App.useApp();
  const [evaluation, setEvaluation] = useState<AfdaEvaluation | null>(null);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    afdaEvaluationAction(asOf).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (result.ok && result.data) setEvaluation(result.data);
      else message.error(result.error ?? "Could not evaluate the allowance");
    });
    return () => {
      cancelled = true;
    };
  }, [asOf, message]);

  async function post() {
    setPosting(true);
    const result = await postAfdaAdjustmentAction(asOf, null);
    setPosting(false);
    if (!result.ok) {
      message.error(result.error ?? "Could not post the allowance adjustment");
      return;
    }
    message.success("Allowance adjustment posted");
    const refreshed = await afdaEvaluationAction(asOf);
    if (refreshed.ok && refreshed.data) setEvaluation(refreshed.data);
  }

  const adjustment = evaluation?.adjustmentMinor ?? 0;

  return (
    <Card
      size="small"
      title="Allowance for doubtful accounts"
      style={{ marginTop: 16 }}
      extra={
        canPost && evaluation && adjustment !== 0 ? (
          <Button type="primary" size="small" loading={posting} onClick={post}>
            {adjustment > 0 ? "Post top-up" : "Post release"}
          </Button>
        ) : null
      }
    >
      <ReportTable<AfdaEvaluation["buckets"][number]>
        loading={loading}
        rowKey="bucketKey"
        rows={evaluation?.buckets ?? []}
        columns={[
          flexColumn<AfdaEvaluation["buckets"][number]>({
            title: "Bucket",
            dataIndex: "bucketKey",
            render: (key: unknown) => BUCKET_LABEL[key as string] ?? (key as string),
          }),
          {
            title: "Open balance",
            dataIndex: "balanceMinor",
            width: AFDA_FIXED_WIDTHS[0],
            align: "right",
            render: (minor: number) => money(minor),
          },
          {
            title: "Reserve rate",
            dataIndex: "rateBps",
            align: "right",
            width: AFDA_FIXED_WIDTHS[1],
            render: (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`,
          },
          {
            title: "Reserve",
            dataIndex: "requiredMinor",
            width: AFDA_FIXED_WIDTHS[2],
            align: "right",
            render: (minor: number) => money(minor),
          },
        ]}
        summary={() =>
          evaluation ? (
            <SummaryRow>
              <SummaryCell index={0}>
                <b>Required allowance</b>
              </SummaryCell>
              <SummaryCell index={1} align="right" />
              <SummaryCell index={2} align="right" />
              <SummaryCell index={3} align="right">
                <b>{money(evaluation.requiredMinor)}</b>
              </SummaryCell>
            </SummaryRow>
          ) : null
        }
      />

      {evaluation ? (
        <Space direction="vertical" size={8} style={{ width: "100%", marginTop: 12 }}>
          <Space size="large" wrap>
            <Tag>Carried in 1190: {money(evaluation.carriedMinor)}</Tag>
            <Tag color={adjustment === 0 ? "green" : adjustment > 0 ? "orange" : "blue"}>
              {adjustment === 0
                ? "No adjustment needed"
                : adjustment > 0
                  ? `Top up by ${money(adjustment)}`
                  : `Release ${money(-adjustment)}`}
            </Tag>
          </Space>
          <Alert
            type="info"
            showIcon
            message={
              adjustment === 0
                ? `The allowance already matches this aging, in ${currencyCode}.`
                : adjustment > 0
                  ? `Post top-up debits 6900 Bad Debt Expense and credits 1190 Allowance for Doubtful Accounts by ${money(adjustment)}.`
                  : `Post release debits 1190 and credits 6900 by ${money(-adjustment)}, the reserve the aging no longer supports.`
            }
            description="An administrator sets each bucket's rate. Ages count from the due date."
          />
        </Space>
      ) : null}
    </Card>
  );
}
