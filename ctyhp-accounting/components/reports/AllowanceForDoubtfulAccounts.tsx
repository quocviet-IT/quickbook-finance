"use client";
import { useEffect, useState } from "react";
import { App, Alert, Button, Card, Space, Table, Tag } from "antd";
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
      <Table
        size="small"
        loading={loading}
        pagination={false}
        rowKey="bucketKey"
        dataSource={evaluation?.buckets ?? []}
        columns={[
          {
            title: "Bucket",
            dataIndex: "bucketKey",
            render: (key: string) => BUCKET_LABEL[key] ?? key,
          },
          {
            title: "Open balance",
            dataIndex: "balanceMinor",
            align: "right",
            render: (minor: number) => money(minor),
          },
          {
            title: "Reserve rate",
            dataIndex: "rateBps",
            align: "right",
            width: 130,
            render: (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`,
          },
          {
            title: "Reserve",
            dataIndex: "requiredMinor",
            align: "right",
            render: (minor: number) => money(minor),
          },
        ]}
        summary={() =>
          evaluation ? (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0}>
                <b>Required allowance</b>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={1} align="right" />
              <Table.Summary.Cell index={2} align="right" />
              <Table.Summary.Cell index={3} align="right">
                <b>{money(evaluation.requiredMinor)}</b>
              </Table.Summary.Cell>
            </Table.Summary.Row>
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
                ? `The allowance already stands at what this aging implies, in ${currencyCode}.`
                : adjustment > 0
                  ? `Posting debits 6900 Bad Debt Expense and credits 1190 Allowance for Doubtful Accounts by ${money(adjustment)}. Receivables stay on the books; what they are carried at falls.`
                  : `Posting debits 1190 and credits 6900 by ${money(-adjustment)}, releasing reserve the aging no longer supports.`
            }
            description="Rates are set per bucket by an administrator. Ages are measured from the due date, so an invoice still inside its terms is not delinquent — which is why the not-yet-due rate starts at zero."
          />
        </Space>
      ) : null}
    </Card>
  );
}
