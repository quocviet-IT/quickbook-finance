"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Progress, Select, Space, Typography, type TableColumnsType } from "antd";
import DataTable from "@/components/ui/DataTable";
import { flexColumn } from "@/components/ui/columns";
import { COLUMN } from "@/lib/design/table-metrics";
import { ruleSeedText } from "@/lib/domain/bank-rules";
import { batchResultSeverity, describeBatchResult, summarizeBatchResults, type BatchActionSummary } from "@/lib/domain/bank-transaction-batch";
import { directionOf } from "@/lib/domain/coding-names";
import { chunked, itemFromValue, proposalValue, type ReviewPostItem } from "@/lib/domain/statement-review";
import { formatMoney } from "@/lib/format";
import type { ImportReview, ReviewLineView, ReviewOutcome } from "@/lib/services/statement-review";
import RuleFormModal, { EMPTY_RULE, type RuleFormValues } from "../../rules/RuleFormModal";
import { postReviewItemsAction } from "../actions";
import styles from "./review-import.module.css";

/**
 * One import's lines, each with what OneBook proposes, and the one button that
 * posts what is ticked. A line left unticked, or with nothing chosen, stays
 * waiting on Bank Transactions exactly as an import has always left it.
 */
export default function ReviewImportClient({ review, canWrite }: { review: ImportReview; canWrite: boolean }) {
  const { message } = App.useApp();
  const router = useRouter();
  const { batch, lines, accounts } = review;
  const money = (minor: number) => formatMoney(minor, batch.currencyCode, 2);

  const [choices, setChoices] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(lines.map((line) => [line.id, proposalValue(line.proposal)])),
  );
  const [ticked, setTicked] = useState<string[]>(() =>
    lines.filter((line) => proposalValue(line.proposal) !== null).map((line) => line.id),
  );
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [summary, setSummary] = useState<BatchActionSummary | null>(null);
  const [ruleSeed, setRuleSeed] = useState<RuleFormValues | null>(null);

  const accountOptions = useMemo(() => accounts.map((a) => ({ value: `account:${a.id}`, label: a.label })), [accounts]);
  const byId = useMemo(() => new Map(lines.map((line) => [line.id, line])), [lines]);
  const counts = useMemo(() => {
    const c = { match: 0, document: 0, transfer: 0, funding: 0, account: 0, none: 0, handled: 0 };
    for (const line of lines) c[line.proposal.kind] += 1;
    return c;
  }, [lines]);
  // A line handled since the page loaded — posted here, or elsewhere — is never
  // posted again, whatever its tick says.
  const open = (id: string) => byId.get(id)?.proposal.kind !== "handled";
  const postable = ticked.filter((id) => choices[id] && open(id));
  const waiting = lines.filter((l) => l.proposal.kind !== "handled").length - postable.length;

  function choose(line: ReviewLineView, value: string | null) {
    setChoices((current) => ({ ...current, [line.id]: value }));
    setTicked((current) => (value ? Array.from(new Set([...current, line.id])) : current.filter((id) => id !== line.id)));
  }

  async function post() {
    const items = postable
      .map((id) => itemFromValue(id, choices[id] ?? null))
      .filter((item): item is ReviewPostItem => item !== null);
    if (!items.length) return;
    const outcomes: ReviewOutcome[] = [];
    setProgress({ done: 0, total: items.length });
    for (const chunk of chunked(items)) {
      const res = await postReviewItemsAction(batch.id, chunk);
      if (!res.ok || !res.data) {
        for (const item of chunk) outcomes.push({ id: item.transactionId, ok: false, error: res.error ?? "Could not post this line" });
      } else {
        outcomes.push(...res.data.outcomes);
      }
      setProgress({ done: outcomes.length, total: items.length });
    }
    setProgress(null);
    const posted = new Set(outcomes.filter((o) => o.ok).map((o) => o.id));
    setTicked((current) => current.filter((id) => !posted.has(id)));
    const result = summarizeBatchResults(outcomes, 0);
    setSummary(result);
    if (result.failureCount === 0) message.success(describeBatchResult(result));
    router.refresh();
  }

  const whyOf = (line: ReviewLineView) => {
    const own = proposalValue(line.proposal);
    const chosen = choices[line.id];
    if (chosen && chosen !== own) return "Chosen by you";
    return line.proposal.why;
  };

  const columns: TableColumnsType<ReviewLineView> = [
    { title: "Date", key: "date", dataIndex: "txnDate", width: COLUMN.DATE },
    {
      ...flexColumn<ReviewLineView>({
        title: "Description",
        key: "description",
        render: (_: unknown, line: ReviewLineView) => (
          <div style={{ minWidth: 0 }}>
            <Typography.Text ellipsis={{ tooltip: line.description }} style={{ display: "block" }}>
              {line.description}
            </Typography.Text>
            {line.reference ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {line.reference}
              </Typography.Text>
            ) : null}
          </div>
        ),
      }),
    },
    {
      title: "Amount",
      key: "amount",
      width: COLUMN.MONEY,
      align: "right",
      render: (_: unknown, line: ReviewLineView) => money(line.amountMinor),
    },
    {
      title: "Post as",
      key: "post",
      width: COLUMN.RICH_MIN + COLUMN.PICKER,
      render: (_: unknown, line: ReviewLineView) => {
        if (line.proposal.kind === "handled" || !canWrite) {
          return (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {line.proposal.kind === "handled" ? line.proposal.why : (line.proposal as { label?: string }).label ?? line.proposal.why}
            </Typography.Text>
          );
        }
        const own =
          line.proposal.kind === "match" || line.proposal.kind === "document"
            ? [{ value: proposalValue(line.proposal) as string, label: line.proposal.label }]
            : [];
        return (
          <div style={{ minWidth: 0 }}>
            <Select
              showSearch
              allowClear
              style={{ width: "100%" }}
              placeholder="Choose an account"
              optionFilterProp="label"
              value={choices[line.id] ?? undefined}
              onChange={(value: string | undefined) => choose(line, value ?? null)}
              options={[...own, ...accountOptions]}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12, display: "block" }} ellipsis={{ tooltip: whyOf(line) }}>
              {whyOf(line)}
            </Typography.Text>
            <Button
              type="link"
              size="small"
              style={{ padding: 0, height: "auto", fontSize: 12 }}
              onClick={() => {
                const chosen = choices[line.id];
                setRuleSeed({
                  ...EMPTY_RULE,
                  matchText: ruleSeedText(line.description),
                  direction: directionOf(line.amountMinor),
                  accountId: chosen?.startsWith("account:") ? chosen.slice("account:".length) : null,
                });
              }}
            >
              Create rule
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <div className={styles.review}>
      <Space direction="vertical" size={4} style={{ marginBottom: 12 }}>
        <Typography.Text strong>
          {batch.filename} · {batch.bankLabel} · imported {batch.importedAt.slice(0, 10)}
        </Typography.Text>
        <Typography.Text type="secondary">
          {batch.rowCount} row{batch.rowCount === 1 ? "" : "s"} in the file · {lines.length} line{lines.length === 1 ? "" : "s"} from this
          import · {counts.match} already in the books · {counts.document} pay a document · {counts.account} have an account ·{" "}
          {counts.none} need coding · {counts.handled} already handled
        </Typography.Text>
      </Space>

      {summary ? (
        <Alert
          style={{ marginBottom: 12 }}
          type={batchResultSeverity(summary)}
          showIcon
          title={describeBatchResult(summary)}
          description={
            summary.failures.length ? (
              <div>
                {summary.failures.map((failure) => {
                  const line = byId.get(failure.id);
                  return (
                    <div key={failure.id}>
                      {line ? `${line.txnDate} · ${line.description} · ${money(line.amountMinor)}` : failure.id}:{" "}
                      <Typography.Text type="danger">{failure.error}</Typography.Text>
                    </div>
                  );
                })}
              </div>
            ) : undefined
          }
        />
      ) : null}

      <DataTable<ReviewLineView>
        rowKey="id"
        columns={columns}
        dataSource={lines}
        emptyTitle="Nothing from this import is waiting"
        emptyDescription="Every line has been posted, matched or undone."
        rowSelection={
          canWrite
            ? {
                selectedRowKeys: ticked.filter(open),
                onChange: (keys) => setTicked(keys as string[]),
                getCheckboxProps: (line: ReviewLineView) => ({ disabled: line.proposal.kind === "handled" || !choices[line.id] }),
              }
            : undefined
        }
      />

      <Space style={{ marginTop: 12 }} wrap>
        {canWrite ? (
          <Button type="primary" disabled={!postable.length || progress !== null} loading={progress !== null} onClick={() => void post()}>
            Post {postable.length} line{postable.length === 1 ? "" : "s"}
          </Button>
        ) : null}
        <Typography.Text type="secondary">
          {Math.max(0, waiting)} line{waiting === 1 ? "" : "s"} will stay waiting on Bank Transactions
        </Typography.Text>
        <Link href="/banking">Back to Banking</Link>
      </Space>
      {progress ? <Progress style={{ maxWidth: 420 }} percent={Math.round((progress.done / progress.total) * 100)} /> : null}

      <RuleFormModal
        open={ruleSeed !== null}
        ruleId={null}
        initial={ruleSeed ?? EMPTY_RULE}
        accounts={review.ruleAccounts}
        onClose={() => setRuleSeed(null)}
        onSaved={() => {
          setRuleSeed(null);
          router.refresh();
        }}
      />
    </div>
  );
}
