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
import { keepFailureMessage, statementFileSpan } from "@/lib/domain/statement-evidence";
import {
  NO_BANK_LINE_MATCHES,
  addMatchCounts,
  bankLinesMatchedSentence,
  bankLinesNotMatchedSentence,
  bankLinesToCheck,
  type BankLineMatchCounts,
} from "@/lib/domain/statement-bank-lines";
import type { KeptStatementFile } from "@/lib/client/keep-statement-file";
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
  /** The account a kept statement file is named after: "Example Bank ****1183". */
  fileAccount: string;
  context: RunContext;
}

/** A statement read from a file, with the file — kept as its evidence when its month is signed (1.83). */
type ChosenStatement = RunStatement & { file?: File };

interface Done {
  signed: number;
  /** The month left in progress for a person, when there is one. */
  open: { id: string; date: string; sentence: string } | null;
  error: string | null;
  /** The account's earlier lines were brought forward before any month. */
  broughtForward: boolean;
  /** What matching the signed months' bank lines did (1.85). */
  matched: BankLineMatchCounts;
  /** A sentence for each signed month whose bank lines could not be matched. */
  unmatched: string[];
}

/** What matching the signed months' bank lines said, after the run's own summary. */
function matchedSaid(done: Done): string | null {
  return [bankLinesMatchedSentence(done.matched), ...done.unmatched].filter(Boolean).join(" ") || null;
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

export default function FromFilesClient({ canWrite, bankAccount, fileAccount, context }: Props) {
  const { message } = App.useApp();
  const router = useRouter();
  const [statements, setStatements] = useState<ChosenStatement[]>([]);
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
      const read: ChosenStatement[] = (await readRunFile(file, bankAccount)).map((s) => ({ ...s, file }));
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
    let matched: BankLineMatchCounts = NO_BANK_LINE_MATCHES;
    const unmatched: string[] = [];
    const finish = (result: Pick<Done, "open" | "error">) => {
      setProgress(null);
      setDone({ ...result, signed, broughtForward, matched, unmatched });
      setPreview(null);
      if (result.error === null && result.open === null) {
        // Every month is signed: the table would only say "Already signed off".
        setStatements([]);
        setPreviewed([]);
      }
      router.refresh();
    };
    const first = previewed[0];
    const statementOfNeedsLook = needsLook ? previewedByKey.get(needsLook.key) : undefined;

    // Each file is kept once, before the first month is signed, and every
    // reconciliation made from it points at it: a CSV year cut into twelve
    // months is twelve reconciliations and one file. A file that cannot be kept
    // costs only the file — the months are signed all the same.
    const fileOfKey = new Map(statements.map((s) => [s.key, s.file]));
    const used = [
      ...(bringForward && first ? [first] : []),
      ...toSign.map((m) => previewedByKey.get(m.key)),
      statementOfNeedsLook,
    ].filter((st): st is RunStatement => Boolean(st));
    const byFile = new Map<File, RunStatement[]>();
    for (const st of used) {
      const file = fileOfKey.get(st.key);
      if (file) byFile.set(file, [...(byFile.get(file) ?? []).filter((s) => s.key !== st.key), st]);
    }
    const fileIdOf = new Map<string, string>();
    if (byFile.size) {
      const keep: typeof import("@/lib/client/keep-statement-file").keepStatementFile = await import("@/lib/client/keep-statement-file")
        .then((module) => module.keepStatementFile)
        .catch((error: unknown) => {
          const reason = error instanceof Error ? error.message : "the upload could not start";
          return async (): Promise<KeptStatementFile> => ({ ok: false, reason });
        });
      let kept = 0;
      for (const [file, read] of byFile) {
        kept += 1;
        setProgress(`Keeping the statement file${byFile.size === 1 ? "" : "s"} — ${kept} of ${byFile.size}`);
        const result = await keep(file, fileAccount, statementFileSpan(read));
        if (result.ok) for (const st of read) fileIdOf.set(st.key, result.id);
        else message.warning(keepFailureMessage(`${file.name}: ${result.reason}`, "reconciliation"), 10);
      }
    }

    if (bringForward && first?.from && first.openingMinor !== null) {
      step += 1;
      setProgress(`Bringing the earlier lines forward — ${step} of ${total}`);
      const res = await reconcileRunMonthAction({
        kind: "bring_forward",
        bank_account_id: bankAccount.id,
        period_from: first.from,
        statement_date: first.to,
        opening_minor: first.openingMinor,
        statement_file_id: fileIdOf.get(first.key) ?? null,
      });
      if (!res.ok) return finish({ open: null, error: res.error ?? "The earlier lines could not be brought forward" });
      broughtForward = true;
      if (res.data?.fileWarning) message.warning(res.data.fileWarning, 10);
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
        statement_file_id: fileIdOf.get(statement.key) ?? null,
        sign: true,
      });
      if (!res.ok || !res.data) return finish({ open: null, error: res.error ?? "A month could not be signed off" });
      if (res.data.fileWarning) message.warning(res.data.fileWarning, 10);
      if (!res.data.signed) {
        return finish({
          open: {
            id: res.data.id,
            date: month.statementDate,
            sentence: `The books changed since the preview: this month is now out by ${money(Math.abs(res.data.differenceMinor))}.`,
          },
          error: null,
        });
      }
      signed += 1;
      if (res.data.matched) matched = addMatchCounts(matched, res.data.matched);
      if (res.data.matchError) unmatched.push(bankLinesNotMatchedSentence(res.data.matchError, shortDate(month.statementDate, true)));
    }
    let open: Done["open"] = null;
    const statement = statementOfNeedsLook;
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
        statement_file_id: fileIdOf.get(statement.key) ?? null,
        sign: false,
      });
      if (!res.ok || !res.data) {
        return finish({ open: null, error: res.error ?? "The month that needs a look could not be started" });
      }
      if (res.data.fileWarning) message.warning(res.data.fileWarning, 10);
      open = { id: res.data.id, date: needsLook.statementDate, sentence: monthSentence(needsLook.outcome, money) };
    }
    finish({ open, error: null });
  }

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        Bank account <strong>{bankAccount.label}</strong>. Choose PDF statements, or a CSV export with a running balance
        column — one file or many. Every closing balance is read out of the file itself, never taken from the books.
        Nothing is written until you sign off; then each file is kept, once, with the reconciliations made from it.
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
              {
                title: "Beginning",
                align: "right",
                // A waiting month begins wherever the month that stopped the run ends, which nobody knows yet.
                render: (_, m) => (m.outcome.kind === "waiting" ? "—" : money(m.beginningMinor)),
              },
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
          type={done.error ? "error" : done.open || done.unmatched.length > 0 || bankLinesToCheck(done.matched) > 0 ? "warning" : "success"}
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
                {matchedSaid(done) ? `${matchedSaid(done)} ` : ""}
                {done.open.sentence.replace(/\.?$/, ".")} The reconciliation to {shortDate(done.open.date, true)} is started, with its pairs ticked.{" "}
                <Link href={`/banking/reconcile/${done.open.id}`}>Open it</Link>
              </span>
            ) : done.error ? (
              [before(done), matchedSaid(done)].filter(Boolean).join(" ") || null
            ) : (
              [done.broughtForward ? "The earlier lines were brought forward first." : null, matchedSaid(done)].filter(Boolean).join(" ") || null
            )
          }
        />
      ) : null}
    </Space>
  );
}
