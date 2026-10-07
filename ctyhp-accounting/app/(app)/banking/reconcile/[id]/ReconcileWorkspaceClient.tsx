"use client";
import { useEffect, useMemo, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  App,
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from "antd";
import { PaperClipOutlined, UploadOutlined } from "@ant-design/icons";
import { fromMinor } from "@/lib/domain/money";
import type { PdfStatement } from "@/lib/domain/pdf-statement";
import type { StatementLine } from "@/lib/domain/statement-import";
import {
  closingAdvice,
  openingAdvice,
  pairingMessage,
  reconciliationStandings,
} from "@/lib/domain/reconcile-statement";
import { formatMoney } from "@/lib/format";
import { shortDate } from "@/lib/domain/pdf-statement-view";
import { keepFailureMessage, linesSpan, statementFileMismatch } from "@/lib/domain/statement-evidence";
import { downloadSavedFile } from "@/lib/client/saved-file-download";
import type { KeptStatementFile } from "@/lib/client/keep-statement-file";
import { attachStatementFileAction } from "../../statement-file-actions";
import {
  reconciliationLinesAction,
  reconciliationDetailAction,
  setClearedAction,
  recordAdjustmentAction,
  completeReconciliationAction,
  reopenReconciliationAction,
} from "../actions";
import {
  addMissingLinesAction,
  addMissingPlanAction,
  importStatementIntoReconciliationAction,
  matchAgainAction,
  reconciliationStatementAction,
  setStatementEndingAction,
} from "../statement-actions";
import { addedMessage, addedNotPairedMessage, type AddMissingPlan } from "@/lib/domain/add-missing";
import AddMissingBox from "./AddMissingBox";
import type { ReconLineView, ReconDetail, ReconStatement, ReconStatementLine } from "@/lib/services/bankrec";
import { clientTablePagination, pageSizeOptionsFor } from "@/components/ui/table-pagination";
import StandingTag from "../StandingTag";

/** The statement dialog Banking uses, fetched when somebody opens it. */
const ImportStatementModal = dynamic(() => import("../../ImportStatementModal"), { ssr: false });

// See table-pagination.ts for why this has to live in state rather than as a
// literal on `pagination`.
const STATEMENT_LINES_DEFAULT_PAGE_SIZE = 10;

const IMPORT_INTRO =
  "Choose the statement for this reconciliation: a PDF, a CSV, or a Quicken or QuickBooks download (.ofx, .qfx, " +
  ".qbo, .qif). Its lines are kept with the reconciliation, imported into Bank Transactions and paired with the " +
  "books, and every pair is ticked. Nothing is posted.";

interface Offset {
  id: string;
  label: string;
}
interface Props {
  reconciliationId: string;
  canWrite: boolean;
  canReopen: boolean;
  offsetAccounts: Offset[];
  baseCurrency: string;
  baseDecimals: number;
  bankAccount: { id: string; label: string; maskedNumber: string | null; decimals: number; currencyCode: string };
  /** The account a kept statement file is named after: "Example Bank ****1183". */
  fileAccount: string;
}

export default function ReconcileWorkspaceClient({
  reconciliationId,
  canWrite,
  canReopen,
  offsetAccounts,
  baseCurrency,
  baseDecimals,
  bankAccount,
  fileAccount,
}: Props) {
  const { message, modal } = App.useApp();
  const [lines, setLines] = useState<ReconLineView[]>([]);
  const [detail, setDetail] = useState<ReconDetail | null>(null);
  const [statement, setStatement] = useState<ReconStatement | null>(null);
  const [loading, setLoading] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [matching, setMatching] = useState(false);
  const [adjOpen, setAdjOpen] = useState(false);
  const [form] = Form.useForm();
  const [statementLinesPageSize, setStatementLinesPageSize] = useState<number>(
    STATEMENT_LINES_DEFAULT_PAGE_SIZE,
  );
  // The plan, with the lines it was worked out for.
  const [addPlan, setAddPlan] = useState<{ key: string; plan: AddMissingPlan } | null>(null);
  const [adding, setAdding] = useState(false);
  // Asks for the plan again when an add was refused because it changed.
  const [planAsked, setPlanAsked] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    const [l, d, s] = await Promise.all([
      reconciliationLinesAction(reconciliationId),
      reconciliationDetailAction(reconciliationId),
      reconciliationStatementAction(reconciliationId),
    ]);
    setLoading(false);
    if (l.ok && l.data) setLines(l.data);
    else message.error(l.error ?? "Failed");
    if (d.ok && d.data) setDetail(d.data);
    else message.error(d.error ?? "Failed");
    if (s.ok && s.data) setStatement(s.data);
    else message.error(s.error ?? "Failed");
  }, [reconciliationId, message]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // How each statement line stands with the books as they are now. Derived,
  // never stored: the same pairing Match again ticks by.
  const standings = useMemo(
    () => (statement && statement.lines.length ? reconciliationStandings(statement, lines) : null),
    [statement, lines],
  );
  const outstanding = useMemo(() => new Set(standings?.outstanding ?? []), [standings]);
  const standingOf = useMemo(
    () => new Map((statement?.lines ?? []).map((line, i) => [line.lineNo, standings?.standings[i]])),
    [statement, standings],
  );

  const fmt = (m: number) => fromMinor(m, baseDecimals).toLocaleString(undefined, { minimumFractionDigits: baseDecimals });
  const money = (m: number) => formatMoney(m, baseCurrency, baseDecimals);
  const completed = detail?.status === "completed";
  const working = canWrite && !completed;

  // What "Add all" would add is worked out on the server, and only when the
  // lines the books do not have change — ticking a line does not change them.
  const missingKey = useMemo(
    () =>
      statement && standings
        ? statement.lines.filter((_, i) => standings.standings[i]?.kind === "missing").map((line) => line.lineNo).join(",")
        : "",
    [statement, standings],
  );
  useEffect(() => {
    if (!missingKey || !working) return;
    let live = true;
    const key = missingKey;
    void addMissingPlanAction(reconciliationId).then((res) => {
      if (!live) return;
      if (res.ok && res.data) {
        setAddPlan({ key, plan: res.data });
      } else {
        setAddPlan(null);
        message.error(res.error ?? "Could not work out what to add");
      }
    });
    return () => {
      live = false;
    };
  }, [missingKey, working, reconciliationId, planAsked, message]);
  // Shown only for the lines it was worked out for: while the next plan is on
  // its way, the box waits rather than offering the last one.
  const shownPlan =
    missingKey && working && addPlan && addPlan.key === missingKey && addPlan.plan.missing > 0 ? addPlan.plan : null;

  async function addAll() {
    if (!shownPlan) return;
    setAdding(true);
    const res = await addMissingLinesAction(
      reconciliationId,
      shownPlan.items.map((item) => ({ lineNo: item.lineNo, accountId: item.accountId })),
    );
    setAdding(false);
    if (!res.ok || !res.data) {
      message.error(res.error ?? "The lines could not be added");
      setAddPlan(null);
      setPlanAsked((n) => n + 1);
      return;
    }
    const { added, uncategorized, pairingError } = res.data;
    if (pairingError) message.warning(addedNotPairedMessage(added, uncategorized, pairingError), 10);
    else message.success(addedMessage(added, uncategorized), 8);
    setAddPlan(null);
    void load();
  }
  const statementClosing = statement?.closingMinor ?? null;
  const closing = detail ? closingAdvice(statementClosing, detail.statementEndingMinor, money) : null;
  const opening = statement && detail ? openingAdvice(statement.openingMinor, detail.beginningMinor, money) : null;

  const toggle = async (line: ReconLineView, cleared: boolean) => {
    const r = await setClearedAction(reconciliationId, line.journalLineId, cleared);
    if (r.ok) void load();
    else message.error(r.error ?? "Failed");
  };

  const submitAdjust = async () => {
    const v = await form.validateFields();
    const r = await recordAdjustmentAction(reconciliationId, { offset_account_id: v.offset_account_id, reason: v.reason });
    if (r.ok) {
      message.success("Adjustment recorded");
      setAdjOpen(false);
      form.resetFields();
      void load();
    } else {
      message.error(r.error ?? "Failed");
    }
  };

  const complete = async () => {
    const r = await completeReconciliationAction(reconciliationId);
    if (r.ok) {
      message.success("Reconciliation completed");
      void load();
    } else {
      message.error(r.error ?? "Failed");
    }
  };

  const reopen = () => {
    let reason = "";
    modal.confirm({
      title: "Reopen reconciliation?",
      content: (
        <Input
          placeholder="Reason"
          onChange={(e) => {
            reason = e.target.value;
          }}
        />
      ),
      onOk: async () => {
        const r = await reopenReconciliationAction(reconciliationId, { reason });
        if (r.ok) {
          message.success(
            r.data?.submittedForApproval
              ? "Reconciliation reopen submitted for approval"
              : "Reopened",
          );
          if (!r.data?.submittedForApproval) void load();
        } else {
          message.error(r.error ?? "Failed");
          throw new Error(r.error);
        }
      },
    });
  };

  /**
   * The statement is kept with this reconciliation, imported into Bank
   * Transactions and paired with the books — without leaving the page the
   * statement is being worked from.
   */
  async function importStatement(fileName: string, rows: StatementLine[], pdf: PdfStatement | null, file: File) {
    setImporting(true);
    // Kept first, so the reconciliation takes its file with its lines (1.83);
    // a file that cannot be kept costs only the file.
    const kept: KeptStatementFile = await import("@/lib/client/keep-statement-file")
      .then(({ keepStatementFile }) =>
        keepStatementFile(file, fileAccount, pdf ? { from: pdf.from, to: pdf.to } : linesSpan(rows)),
      )
      .catch((error: unknown): KeptStatementFile => ({
        ok: false,
        reason: error instanceof Error ? error.message : "the upload could not start",
      }));
    const res = await importStatementIntoReconciliationAction(reconciliationId, {
      file_name: fileName,
      opening_minor: pdf?.openingMinor ?? null,
      closing_minor: pdf?.closingMinor ?? null,
      lines: rows,
      statement_file_id: kept.ok ? kept.id : null,
    });
    setImporting(false);
    if (!res.ok || !res.data) {
      message.error(res.error ?? "Failed to import the statement");
      return;
    }
    setImportOpen(false);
    message.success(
      `${res.data.inserted} new in Bank Transactions, ${res.data.duplicates} already there. ${pairingMessage(res.data.outcome)}`,
      8,
    );
    if (!kept.ok) message.warning(keepFailureMessage(kept.reason, "reconciliation"), 10);
    void load();
  }

  /**
   * Attach the statement to a reconciliation that has no file: read here with
   * the same readers, attached only when it is this reconciliation's statement
   * — otherwise nothing is kept and the message says what differs.
   */
  async function attachStatement(rows: StatementLine[], pdf: PdfStatement | null, file: File) {
    if (!statement || !detail) return;
    const read = {
      to: pdf?.to ?? null,
      closingMinor: pdf?.closingMinor ?? null,
      lines: rows.map((r) => ({ txn_date: r.txn_date, amount_minor: r.amount_minor })),
    };
    const mismatch = statementFileMismatch(
      read,
      {
        endingDate: statement.endingDate,
        endingMinor: detail.statementEndingMinor,
        keptLines: statement.lines.map((l) => ({ txn_date: l.txnDate, amount_minor: l.amountMinor })),
      },
      money,
    );
    if (mismatch) {
      message.error(mismatch, 10);
      return;
    }
    setAttaching(true);
    const kept: KeptStatementFile = await import("@/lib/client/keep-statement-file")
      .then(({ keepStatementFile }) =>
        keepStatementFile(file, fileAccount, pdf ? { from: pdf.from, to: pdf.to } : linesSpan(rows)),
      )
      .catch((error: unknown): KeptStatementFile => ({
        ok: false,
        reason: error instanceof Error ? error.message : "the upload could not start",
      }));
    if (!kept.ok) {
      setAttaching(false);
      message.error(`The statement file could not be kept: ${kept.reason}.`, 10);
      return;
    }
    const res = await attachStatementFileAction({
      reconciliation_id: reconciliationId,
      file_id: kept.id,
      to: read.to,
      closing_minor: read.closingMinor,
      lines: read.lines,
    });
    setAttaching(false);
    if (!res.ok) {
      message.error(res.error ?? "Failed to attach the statement", 10);
      return;
    }
    setAttachOpen(false);
    message.success("The statement file is attached to this reconciliation.");
    void load();
  }

  async function download(id: string) {
    const problem = await downloadSavedFile(id);
    if (problem) message.error(problem);
  }

  async function matchAgain() {
    setMatching(true);
    const res = await matchAgainAction(reconciliationId);
    setMatching(false);
    if (!res.ok || !res.data) {
      message.error(res.error ?? "Failed to pair the statement");
      return;
    }
    message.success(pairingMessage(res.data), 8);
    void load();
  }

  async function takeClosing(closingMinor: number) {
    const res = await setStatementEndingAction(reconciliationId, closingMinor);
    if (res.ok) void load();
    else message.error(res.error ?? "Failed");
  }

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="large">
      {detail && (
        <Space size="large" wrap>
          <Statistic title="Beginning" value={fmt(detail.beginningMinor)} />
          <Statistic title="Cleared" value={fmt(detail.clearedTotalMinor)} />
          <Statistic title="Reconciled balance" value={fmt(detail.reconciledBalanceMinor)} />
          <Statistic title="Statement ending" value={fmt(detail.statementEndingMinor)} />
          <Statistic title="Difference" value={fmt(detail.differenceMinor)} />
          <Tag color={completed ? "green" : "blue"}>{detail.status}</Tag>
          {statement?.broughtForward ? <Tag color="purple">Brought forward</Tag> : null}
        </Space>
      )}
      <p><Link href={`/banking/reconcile/${reconciliationId}/report`}>View report</Link></p>
      {statement?.broughtForward && statement.note ? <Alert type="info" showIcon title={statement.note} /> : null}
      {detail && !completed && (
        <Alert
          type={detail.differenceMinor === 0 ? "success" : "warning"}
          message={
            detail.differenceMinor === 0
              ? "Difference is zero — ready to complete."
              : `Unexplained difference: ${fmt(detail.differenceMinor)} ${baseCurrency}.`
          }
        />
      )}
      {closing && !completed && statementClosing !== null ? (
        <Alert
          type="warning"
          showIcon
          title={closing}
          action={
            canWrite ? (
              <Button size="small" onClick={() => void takeClosing(statementClosing)}>
                Use {money(statementClosing)}
              </Button>
            ) : null
          }
        />
      ) : null}
      {opening && !completed ? <Alert type="warning" showIcon title={opening} /> : null}
      {working && (
        <Space wrap>
          <Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>
            Import statement
          </Button>
          {statement && statement.lines.length > 0 ? (
            <Button loading={matching} onClick={() => void matchAgain()}>
              Match again
            </Button>
          ) : null}
          <Button type="primary" disabled={!detail || detail.differenceMinor !== 0} onClick={complete}>
            Complete
          </Button>
          <Button disabled={!detail || detail.differenceMinor === 0} onClick={() => setAdjOpen(true)}>
            Record adjustment
          </Button>
        </Space>
      )}
      {completed && canReopen && (
        <Button danger onClick={reopen}>
          Reopen
        </Button>
      )}
      {statement ? (
        <Space size={4} wrap>
          <PaperClipOutlined />
          {statement.statementFile ? (
            <>
              <Typography.Text>Statement file: {statement.statementFile.fileName}</Typography.Text>
              <Link href={`/banking/statement-files/${statement.statementFile.id}`}>View</Link>
              <Button type="link" size="small" onClick={() => void download(statement.statementFile!.id)}>
                Download
              </Button>
            </>
          ) : statement.statementFileId ? (
            <Typography.Text type="secondary">A statement file is kept with this reconciliation.</Typography.Text>
          ) : (
            <>
              <Typography.Text type="secondary">No statement file</Typography.Text>
              {canWrite ? (
                <Button type="link" size="small" onClick={() => setAttachOpen(true)}>
                  Attach the statement
                </Button>
              ) : null}
            </>
          )}
        </Space>
      ) : null}
      {shownPlan ? (
        <AddMissingBox plan={shownPlan} bankAccountId={bankAccount.id} money={money} adding={adding} onAdd={() => void addAll()} />
      ) : null}
      <div>
        <Space size="small" style={{ marginBottom: 8 }} wrap>
          <Typography.Text strong>Statement lines</Typography.Text>
          <Typography.Text type="secondary">
            {!statement || statement.lines.length === 0
              ? "No statement is kept with this reconciliation yet — import it above."
              : `${statement.lines.length} line(s) from ${statement.fileName ?? "the statement"}`}
          </Typography.Text>
          {standings ? (
            <Space size={4} wrap>
              <Tag color="green">{standings.paired} paired</Tag>
              {standings.missing > 0 ? <Tag color="orange">{standings.missing} not in the books</Tag> : null}
              {standings.after > 0 ? <Tag>{standings.after} after the statement date</Tag> : null}
            </Space>
          ) : null}
        </Space>
        {standings?.flipped ? (
          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
            This statement shows money in and out the other way around; its amounts were reversed to pair them.
          </Typography.Paragraph>
        ) : null}
        <Table<ReconStatementLine>
          rowKey="lineNo"
          size="small"
          pagination={
            (statement?.lines.length ?? 0) > 10
              ? clientTablePagination(
                  statementLinesPageSize,
                  setStatementLinesPageSize,
                  pageSizeOptionsFor(STATEMENT_LINES_DEFAULT_PAGE_SIZE),
                )
              : false
          }
          dataSource={statement?.lines ?? []}
          locale={{ emptyText: "No statement kept with this reconciliation" }}
          columns={[
            { title: "Date", dataIndex: "txnDate", width: 110 },
            { title: "Description", dataIndex: "description" },
            {
              title: "Reference",
              dataIndex: "reference",
              width: 130,
              render: (value: string | null) => value ?? "—",
            },
            {
              title: "Amount",
              dataIndex: "amountMinor",
              width: 130,
              align: "right",
              render: (value: number) => fmt(value),
            },
            {
              title: "With the books",
              key: "standing",
              width: 280,
              render: (_: unknown, line) => {
                const standing = standingOf.get(line.lineNo);
                return standing ? <StandingTag standing={standing} /> : null;
              },
            },
          ]}
        />
      </div>

      <Typography.Text strong>Ledger lines in this reconciliation</Typography.Text>
      <Table
        rowKey="journalLineId"
        loading={loading}
        dataSource={lines}
        columns={[
          {
            title: "Cleared",
            render: (_, l) => (
              <input
                type="checkbox"
                checked={l.cleared}
                disabled={!canWrite || completed}
                onChange={(e) => void toggle(l, e.target.checked)}
              />
            ),
          },
          { title: "Date", dataIndex: "entryDate" },
          { title: "Entry", dataIndex: "entryNumber" },
          { title: "Source", dataIndex: "sourceType", render: (s) => <Tag>{s}</Tag> },
          { title: "Reference", dataIndex: "reference", render: (value: string | null) => value ?? "—" },
          { title: "Memo", dataIndex: "memo" },
          { title: "Amount", align: "right", render: (_, l) => fmt(l.signedMinor) },
          {
            title: "",
            key: "outstanding",
            render: (_, l) =>
              !l.cleared && outstanding.has(l.journalLineId) ? <Tag color="orange">Outstanding</Tag> : null,
          },
        ]}
      />
      <Modal open={adjOpen} title="Record adjustment" onCancel={() => setAdjOpen(false)} onOk={submitAdjust}>
        <p>
          An adjusting entry for the outstanding difference{" "}
          {detail ? `(${fmt(detail.differenceMinor)} ${baseCurrency})` : ""} will post to the selected account.
        </p>
        <Form form={form} layout="vertical">
          <Form.Item name="offset_account_id" label="Offset account (bank charges / interest)" rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label" options={offsetAccounts.map((a) => ({ value: a.id, label: a.label }))} />
          </Form.Item>
          <Form.Item name="reason" label="Reason" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>
      {importOpen ? (
        <ImportStatementModal
          open={importOpen}
          bankAccount={bankAccount}
          importing={importing}
          intro={IMPORT_INTRO}
          onConfirm={(fileName, rows, pdf, file) => void importStatement(fileName, rows, pdf, file)}
          onCancel={() => setImportOpen(false)}
        />
      ) : null}
      {attachOpen && statement ? (
        <ImportStatementModal
          open={attachOpen}
          bankAccount={bankAccount}
          importing={attaching}
          title="Attach the statement"
          okLabel="Attach"
          intro={
            `Choose the bank's statement to ${shortDate(statement.endingDate, true)}. OneBook reads it here and attaches it ` +
            "only if it is this reconciliation's statement: the same closing balance and, when this reconciliation kept " +
            "the statement's lines, the same lines. Nothing in the reconciliation changes."
          }
          onConfirm={(_fileName, rows, pdf, file) => void attachStatement(rows, pdf, file)}
          onCancel={() => setAttachOpen(false)}
        />
      ) : null}
    </Space>
  );
}
