"use client";
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Space, Spin, Tag, Typography, Upload } from "antd";
import { InboxOutlined } from "@ant-design/icons";
import DataTable from "@/components/ui/DataTable";
import { readRunFile } from "@/lib/client/run-files";
import { periodLabel, shortDate } from "@/lib/domain/pdf-statement-view";
import {
  checkRun,
  monthSentence,
  type CheckedStatement,
  type MonthOutcome,
  type RunContext,
  type RunMonth,
  type RunPreview,
  type RunStatement,
} from "@/lib/domain/statement-run";
import { formatMoney } from "@/lib/format";
import { previewRunAction, reconcileRunMonthAction } from "../statement-actions";
import StandingTag from "../StandingTag";

/**
 * Reconciling a run of statements: choose the files, check what was read,
 * preview every month against the books, then sign off the months that agree
 * in one click. Nothing is written before that click; the first month that
 * needs a look is then started as a reconciliation in progress.
 */
interface Props {
  canWrite: boolean;
  bankAccount: { id: string; label: string; maskedNumber: string | null; decimals: number; currencyCode: string };
  context: RunContext;
}

interface Done {
  signed: number;
  /** The month left in progress for a person, when there is one. */
  open: { id: string; date: string; sentence: string } | null;
  error: string | null;
  /** The account's earlier lines were brought forward before any month. */
  broughtForward: boolean;
}

/** What was done before a run stopped on an error, said after the error. */
function before(done: Done): string | null {
  const parts = [
    done.broughtForward ? "The earlier lines were brought forward" : null,
    done.signed > 0 ? `${done.signed} month${done.signed === 1 ? "" : "s"} signed off` : null,
  ].filter((p): p is string => p !== null);
  return parts.length ? `${parts.join(" and ")} before this.` : null;
}

const STATE_COLOR: Record<CheckedStatement["state"], string | undefined> = {
  usable: "green",
  unreadable: "red",
  notOver: undefined,
  already: "blue",
  before: undefined,
  duplicate: undefined,
};

function outcomeTag(outcome: MonthOutcome) {
  switch (outcome.kind) {
    case "agrees":
      return <Tag color="green">Agrees</Tag>;
    case "balanceOnly":
      return <Tag color="gold">Needs a look</Tag>;
    case "outBy":
      return <Tag color="red">Does not agree</Tag>;
    case "waiting":
      return <Tag>Waiting</Tag>;
  }
}

export default function FromFilesClient({ canWrite, bankAccount, context }: Props) {
  const { message } = App.useApp();
  const router = useRouter();
  const [statements, setStatements] = useState<RunStatement[]>([]);
  const [reading, setReading] = useState(0);
  const [preview, setPreview] = useState<RunPreview | null>(null);
  // The statements the preview was walked on. Signing uses these and nothing
  // else, so a file added after the preview can never be signed unseen.
  const [previewed, setPreviewed] = useState<RunStatement[]>([]);
  const [previewing, setPreviewing] = useState(false);
  // A preview is asked for, then answered; a file added or a fresh start in
  // between makes the answer stale, and it is dropped.
  const asked = useRef(0);
  const [progress, setProgress] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const { currencyCode, decimals } = bankAccount;
  const money = (minor: number) => formatMoney(minor, currencyCode, decimals);
  const check = useMemo(
    () => checkRun(statements, context, (minor) => formatMoney(minor, currencyCode, decimals)),
    [statements, context, currencyCode, decimals],
  );
  const previewedByKey = useMemo(() => new Map(previewed.map((s) => [s.key, s])), [previewed]);
  const busy = progress !== null;

  if (!canWrite) {
    return <Alert type="info" showIcon title="Reconciling statements needs permission to write in this company." />;
  }

  async function add(file: File) {
    asked.current += 1;
    setReading((n) => n + 1);
    setPreview(null);
    setDone(null);
    try {
      const read = await readRunFile(file, bankAccount);
      setStatements((current) => {
        // A file chosen twice, or two files of one name, stay as rows: the
        // table says "Same month as another file" rather than one vanishing.
        const keys = new Set(current.map((s) => s.key));
        const fresh = read.map((s) => {
          let key = s.key;
          for (let n = 2; keys.has(key); n += 1) key = `${s.key}~${n}`;
          keys.add(key);
          return key === s.key ? s : { ...s, key };
        });
        return [...current, ...fresh];
      });
    } finally {
      setReading((n) => n - 1);
    }
  }

  function startAgain() {
    asked.current += 1;
    setStatements([]);
    setPreview(null);
    setDone(null);
  }

  async function runPreview() {
    const token = ++asked.current;
    const run = check.usable;
    setPreviewing(true);
    setPreview(null);
    setDone(null);
    const res = await previewRunAction({
      bank_account_id: bankAccount.id,
      statements: run.map((s) => ({
        key: s.key,
        from: s.from,
        to: s.to,
        opening_minor: s.openingMinor,
        closing_minor: s.closingMinor,
        lines: s.lines.map((l) => ({ txn_date: l.txn_date, amount_minor: l.amount_minor, reference: l.reference })),
      })),
    });
    setPreviewing(false);
    if (token !== asked.current) return;
    if (!res.ok || !res.data) {
      message.error(res.error ?? "The statements could not be previewed");
      return;
    }
    setPreviewed(run);
    setPreview(res.data);
  }

  const needsLook = preview?.months[preview.toSign]?.outcome.kind !== "waiting" ? preview?.months[preview.toSign] ?? null : null;
  const bringForward = preview?.broughtForward?.canBringForward ? preview.broughtForward : null;
  const signLabel = preview?.toSign
    ? `Sign off ${preview.toSign} month${preview.toSign === 1 ? "" : "s"}`
    : needsLook
      ? bringForward
        ? "Bring the earlier lines forward and start the month that needs a look"
        : "Start the month that needs a look"
      : null;

  async function signOff() {
    if (!preview || previewing || check.stops.length > 0) return;
    // A preview still on its way was walked before these months were signed.
    asked.current += 1;
    const toSign = preview.months.slice(0, preview.toSign);
    const total = toSign.length + (bringForward ? 1 : 0);
    let step = 0;
    let signed = 0;
    let broughtForward = false;
    const finish = (result: Done) => {
      setProgress(null);
      setDone(result);
      setPreview(null);
      if (result.error === null && result.open === null) {
        // Every month is signed: the table would only say "Already signed off".
        setStatements([]);
        setPreviewed([]);
      }
      router.refresh();
    };
    const first = previewed[0];
    if (bringForward && first?.from && first.openingMinor !== null) {
      step += 1;
      setProgress(`Bringing the earlier lines forward — ${step} of ${total}`);
      const res = await reconcileRunMonthAction({
        kind: "bring_forward",
        bank_account_id: bankAccount.id,
        period_from: first.from,
        statement_date: first.to,
        opening_minor: first.openingMinor,
      });
      if (!res.ok) return finish({ signed, open: null, error: res.error ?? "The earlier lines could not be brought forward", broughtForward });
      broughtForward = true;
    }
    for (const month of toSign) {
      const statement = previewedByKey.get(month.key);
      if (!statement) break;
      step += 1;
      setProgress(`Signing ${shortDate(month.statementDate, true)} — ${step} of ${total}`);
      const res = await reconcileRunMonthAction({
        kind: "month",
        bank_account_id: bankAccount.id,
        file_name: statement.fileName,
        opening_minor: statement.openingMinor,
        closing_minor: statement.closingMinor,
        statement_date: month.statementDate,
        lines: statement.lines,
        sign: true,
      });
      if (!res.ok || !res.data) return finish({ signed, open: null, error: res.error ?? "A month could not be signed off", broughtForward });
      if (!res.data.signed) {
        return finish({
          signed,
          open: {
            id: res.data.id,
            date: month.statementDate,
            sentence: `The books changed since the preview: this month is now out by ${money(Math.abs(res.data.differenceMinor))}.`,
          },
          error: null,
          broughtForward,
        });
      }
      signed += 1;
    }
    let open: Done["open"] = null;
    const statement = needsLook ? previewedByKey.get(needsLook.key) : undefined;
    if (needsLook && statement) {
      setProgress(`Starting ${shortDate(needsLook.statementDate, true)}, which needs a look`);
      const res = await reconcileRunMonthAction({
        kind: "month",
        bank_account_id: bankAccount.id,
        file_name: statement.fileName,
        opening_minor: statement.openingMinor,
        closing_minor: statement.closingMinor,
        statement_date: needsLook.statementDate,
        lines: statement.lines,
        sign: false,
      });
      if (!res.ok || !res.data) {
        return finish({ signed, open: null, error: res.error ?? "The month that needs a look could not be started", broughtForward });
      }
      open = { id: res.data.id, date: needsLook.statementDate, sentence: monthSentence(needsLook.outcome, money) };
    }
    finish({ signed, open, error: null, broughtForward });
  }

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        Bank account <strong>{bankAccount.label}</strong>. Choose PDF statements, or a CSV export with a running balance
        column — one file or many. Every closing balance is read out of the file itself, never taken from the books. The
        files stay in your browser, and nothing is written until you sign off.
      </Typography.Paragraph>
      <Upload.Dragger
        multiple
        accept=".pdf,.csv,.txt,.ofx,.qfx,.qbo,.qif,application/pdf"
        beforeUpload={(file) => {
          void add(file);
          return false;
        }}
        showUploadList={false}
        disabled={busy || previewing}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">Click or drag statement files here</p>
      </Upload.Dragger>

      {reading > 0 ? (
        <Space>
          <Spin size="small" />
          <Typography.Text type="secondary">
            Reading {reading} file{reading === 1 ? "" : "s"}…
          </Typography.Text>
        </Space>
      ) : null}

      {statements.length ? (
        <div>
          <Typography.Text strong>Statements</Typography.Text>
          <DataTable<CheckedStatement>
            rowKey={(c) => c.statement.key}
            size="small"
            pagination={false}
            dataSource={check.statements}
            columns={[
              { title: "File", render: (_, c) => c.statement.fileName },
              { title: "Period", render: (_, c) => (c.statement.to ? periodLabel(c.statement.from, c.statement.to) : "—") },
              {
                title: "Opening",
                align: "right",
                render: (_, c) => (c.statement.openingMinor === null ? "—" : money(c.statement.openingMinor)),
              },
              {
                title: "Closing",
                align: "right",
                render: (_, c) => (c.statement.closingMinor === null ? "—" : money(c.statement.closingMinor)),
              },
              { title: "Read", render: (_, c) => <Tag color={STATE_COLOR[c.state]}>{c.note}</Tag> },
            ]}
          />
          {check.stops.map((stop) => (
            <Alert key={stop} style={{ marginTop: 12 }} type="error" showIcon title={stop} />
          ))}
          <Space style={{ marginTop: 12 }} wrap>
            <Button
              type="primary"
              loading={previewing}
              disabled={check.stops.length > 0 || reading > 0 || busy}
              onClick={() => void runPreview()}
            >
              Preview {check.usable.length} statement{check.usable.length === 1 ? "" : "s"}
            </Button>
            <Button onClick={startAgain} disabled={busy || previewing}>
              Start again
            </Button>
          </Space>
        </div>
      ) : null}

      {preview ? (
        <div>
          <Typography.Text strong>Preview — nothing is written yet</Typography.Text>
          {preview.broughtForward ? (
            <Alert
              style={{ margin: "8px 0" }}
              type={preview.broughtForward.canBringForward ? "info" : "warning"}
              showIcon
              title={preview.broughtForward.canBringForward ? "The first reconciliation of this account" : "The earlier lines stay open"}
              description={preview.broughtForward.text}
            />
          ) : null}
          <DataTable<RunMonth>
            rowKey="key"
            size="small"
            pagination={false}
            dataSource={preview.months}
            expandable={{
              rowExpandable: (m) => m.standings.length > 0,
              expandedRowRender: (m) => {
                const statement = previewedByKey.get(m.key);
                return (
                  <DataTable
                    rowKey={(_, i) => String(i)}
                    size="small"
                    pagination={false}
                    dataSource={(statement?.lines ?? []).map((line, i) => ({ line, standing: m.standings[i] }))}
                    columns={[
                      { title: "Date", render: (_, r) => r.line.txn_date, width: 110 },
                      { title: "Description", render: (_, r) => r.line.description },
                      { title: "Amount", align: "right", render: (_, r) => money(r.line.amount_minor), width: 130 },
                      { title: "With the books", render: (_, r) => (r.standing ? <StandingTag standing={r.standing} /> : null), width: 280 },
                    ]}
                  />
                );
              },
            }}
            columns={[
              { title: "Statement", render: (_, m) => shortDate(m.statementDate, true), width: 130 },
              { title: "File", render: (_, m) => previewedByKey.get(m.key)?.fileName ?? "" },
              { title: "Beginning", align: "right", render: (_, m) => money(m.beginningMinor) },
              { title: "Closing", align: "right", render: (_, m) => money(m.closingMinor) },
              { title: "Outcome", render: (_, m) => outcomeTag(m.outcome) },
              { title: "What happened", render: (_, m) => monthSentence(m.outcome, money) },
            ]}
          />
          <Space style={{ marginTop: 12 }} wrap>
            {signLabel ? (
              <Button type="primary" loading={busy} disabled={previewing} onClick={() => void signOff()}>
                {signLabel}
              </Button>
            ) : null}
            {progress ? (
              <Typography.Text role="status" aria-live="polite">
                {progress}
              </Typography.Text>
            ) : null}
          </Space>
        </div>
      ) : null}

      {done ? (
        <Alert
          type={done.error ? "error" : done.open ? "warning" : "success"}
          showIcon
          title={
            done.error ??
            (done.signed
              ? `${done.signed} month${done.signed === 1 ? "" : "s"} signed off.`
              : `The reconciliation to ${shortDate((done.open as NonNullable<Done["open"]>).date, true)} needs a look.`)
          }
          description={
            done.open ? (
              <span>
                {done.broughtForward ? "The earlier lines were brought forward. " : ""}
                {done.open.sentence} The reconciliation to {shortDate(done.open.date, true)} is started, with its pairs ticked.{" "}
                <Link href={`/banking/reconcile/${done.open.id}`}>Open it</Link>
              </span>
            ) : done.error ? (
              before(done)
            ) : done.broughtForward ? (
              "The earlier lines were brought forward first."
            ) : null
          }
        />
      ) : null}
    </Space>
  );
}
