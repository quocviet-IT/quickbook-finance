"use client";
import { useEffect, useMemo, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { importedSummary } from "@/lib/domain/statement-repeats";
import {
  BRING_HISTORY_FORWARD,
  DISCARD_CONFIRMATION,
  DISCARD_RECONCILIATION,
  SET_ASIDE_MESSAGE,
  asideActionFor,
  bringHistoryForwardConfirmation,
  closingAdvice,
  discardedMessage,
  discardedReturnPath,
  openingAdvice,
  pairingMessage,
  reconciliationStandings,
  sessionHistoryAdvice,
  type SessionHistoryFacts,
} from "@/lib/domain/reconcile-statement";
import { explainDifference } from "@/lib/domain/reconcile-difference";
import { historyBroughtForwardMessage } from "@/lib/domain/reconcile-history";
import { REASON_MAX, reasonProblem } from "@/lib/domain/reconcile-alerts-screen";
import { formatMoney } from "@/lib/format";
import { shortDate } from "@/lib/domain/pdf-statement-view";
import { attachMismatch, keepFailureMessage, linesSpan, serverFailure } from "@/lib/domain/statement-evidence";
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
import {
  bringHistoryForwardFromSessionAction,
  discardReconciliationAction,
  sessionHistoryAdviceAction,
  setStatementLineAsideAction,
} from "../history-actions";
import {
  addedMessage,
  addedNotPairedMessage,
  extraLineNos,
  type AddMissingPlan,
  type HeldLine,
} from "@/lib/domain/add-missing";
import { bankLinesToCheck, completedMessage } from "@/lib/domain/statement-bank-lines";
import AddMissingBox from "./AddMissingBox";
import DifferenceAlert from "./DifferenceAlert";
import { STATEMENT_LINE_WIDTH as SW } from "./statement-line-columns";
import styles from "./workspace.module.css";
import type { ReconLineView, ReconDetail, ReconStatement, ReconStatementLine } from "@/lib/services/bankrec";
import { clientTablePagination, pageSizeOptionsFor } from "@/components/ui/table-pagination";
import StandingTag from "../StandingTag";

/** The statement dialog Banking uses, fetched when somebody opens it. */
const ImportStatementModal = dynamic(() => import("../../ImportStatementModal"), { ssr: false });
import type { ConfirmedImport } from "../../ImportStatementModal";

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
  /** An administrator: offered "Import anyway…" for a statement that does not add up. The database decides again. */
  canOverride: boolean;
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
  canOverride,
  offsetAccounts,
  baseCurrency,
  baseDecimals,
  bankAccount,
  fileAccount,
}: Props) {
  const { message, modal } = App.useApp();
  const router = useRouter();
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
  // The held-back line being added with Add anyway, and the statement line being set aside or restored.
  const [addingLine, setAddingLine] = useState<number | null>(null);
  const [asideLine, setAsideLine] = useState<number | null>(null);
  // What an offer to bring the account's history forward rests on (2.03); null when there is none.
  const [historyFacts, setHistoryFacts] = useState<SessionHistoryFacts | null>(null);
  // A button that writes is busy from its click until the screen has caught
  // up, so a second click cannot send it twice: bringing the history forward,
  // discarding and reopening while their dialog is open or their request runs,
  // Complete and Record adjustment until the figures are read again.
  const [bringing, setBringing] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [reopening, setReopening] = useState(false);

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

  // Read apart from the figures, so ticking a line does not wait on it: only a
  // statement imported or attached, the history brought forward, or a reopen
  // changes what it says.
  const loadHistory = useCallback(async () => {
    const h = await sessionHistoryAdviceAction(reconciliationId);
    if (h.ok) setHistoryFacts(h.data ?? null);
    else message.error(h.error ?? "Failed");
  }, [reconciliationId, message]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    void loadHistory();
  }, [load, loadHistory]);

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
  // Once the figures say so: discarding, setting a line aside and bringing the
  // history forward are for a reconciliation in progress, and for a writer.
  const inProgress = detail?.status === "in_progress";
  const writing = canWrite && inProgress;

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
  // The lines the plan holds back as extra are marked in the statement lines table too.
  const extraLines = useMemo(() => extraLineNos(shownPlan), [shownPlan]);

  /** What adding lines said, and the screen brought up to date; a refusal asks for the plan again. */
  function afterAdding(res: Awaited<ReturnType<typeof addMissingLinesAction>>) {
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

  async function addAll() {
    if (!shownPlan) return;
    setAdding(true);
    try {
      afterAdding(
        await addMissingLinesAction(
          reconciliationId,
          shownPlan.items.map((item) => ({ lineNo: item.lineNo, accountId: item.accountId })),
        ),
      );
    } finally {
      setAdding(false);
    }
  }

  /** One held-back line alone, posted without the duplicate check: the person has looked at it. */
  async function addAnyway(line: HeldLine) {
    setAddingLine(line.lineNo);
    try {
      afterAdding(
        await addMissingLinesAction(reconciliationId, [{ lineNo: line.lineNo, accountId: line.accountId }], [line.lineNo]),
      );
    } finally {
      setAddingLine(null);
    }
  }

  /**
   * Sets a statement line aside as not a transaction, or restores it. A refusal
   * is said as the server words it. Setting aside says the bank line stays in
   * Bank Transactions. The line's button stays busy until the lines are read
   * again, so it never offers the action it has just taken.
   */
  async function setAside(lineNo: number, aside: boolean) {
    setAsideLine(lineNo);
    try {
      const res = await setStatementLineAsideAction(reconciliationId, { line_no: lineNo, aside });
      if (!res.ok) {
        message.error(res.error ?? "The statement line could not be changed");
        return;
      }
      if (aside) message.success(SET_ASIDE_MESSAGE, 8);
      await load();
    } finally {
      setAsideLine(null);
    }
  }

  const statementClosing = statement?.closingMinor ?? null;
  const closing = detail ? closingAdvice(statementClosing, detail.statementEndingMinor, money) : null;
  const opening = statement && detail ? openingAdvice(statement.openingMinor, detail.beginningMinor, money) : null;
  // Bringing the history forward, while in progress (2.03). When it speaks, it
  // says what the opening advice says, and more usefully, so that one is hidden.
  const historyAdvice = inProgress ? sessionHistoryAdvice(historyFacts, money) : null;
  // The difference in its parts; null when there is none.
  const explained =
    detail && !completed
      ? explainDifference(
          {
            detail,
            statement: statement ? { openingMinor: statement.openingMinor, lines: statement.lines } : null,
            standings: standings?.standings ?? null,
            book: lines,
          },
          money,
        )
      : null;

  const bringHistoryForward = (facts: SessionHistoryFacts, entries: number) => {
    if (bringing) return;
    setBringing(true);
    modal.confirm({
      title: `${BRING_HISTORY_FORWARD}?`,
      content: bringHistoryForwardConfirmation(entries, facts.through),
      okText: BRING_HISTORY_FORWARD,
      cancelText: "Cancel",
      afterClose: () => setBringing(false),
      onOk: async () => {
        const r = await bringHistoryForwardFromSessionAction(reconciliationId);
        if (!r.ok || !r.data) {
          message.error(r.error ?? "The history could not be brought forward");
          throw new Error(r.error);
        }
        // The figures and the offer are read again before the dialog closes, so
        // the screen changes once: no spent offer left behind, and no opening
        // warning drawn from the figures as they were before. A refresh that
        // fails never reads as a failed bring-forward: it is said apart below.
        let refreshed = true;
        try {
          await Promise.all([load(), loadHistory()]);
        } catch {
          refreshed = false;
        }
        const rebased = r.data.rebasedReconciliationId ? facts.openingMinor : null;
        message.success(historyBroughtForwardMessage(r.data.lines, facts.through, rebased, money), 8);
        if (r.data.fileWarning) message.warning(r.data.fileWarning, 10);
        if (!refreshed) {
          message.warning("The history was brought forward, but the screen could not be refreshed — reload the page.", 10);
        }
      },
    });
  };

  /**
   * Discards this reconciliation in progress, with a reason, and returns to
   * Reconcile. The dialog's button stays disabled until a reason is typed, and
   * the same rule is checked again before anything is sent.
   */
  const discard = () => {
    if (discarding) return;
    let reason = "";
    // Once discarded the screen is on its way back to Reconcile: the button stays busy.
    let discarded = false;
    setDiscarding(true);
    const dialog = modal.confirm({
      title: `${DISCARD_RECONCILIATION}?`,
      content: (
        <Space orientation="vertical" size="small" style={{ width: "100%" }}>
          <Typography.Text>{DISCARD_CONFIRMATION}</Typography.Text>
          <Input.TextArea
            aria-label="Reason"
            placeholder="Reason (required)"
            maxLength={REASON_MAX}
            autoSize={{ minRows: 2, maxRows: 4 }}
            onChange={(e) => {
              reason = e.target.value;
              dialog.update({ okButtonProps: { danger: true, disabled: reasonProblem(reason) !== null } });
            }}
          />
        </Space>
      ),
      okText: "Discard",
      okButtonProps: { danger: true, disabled: true },
      cancelText: "Cancel",
      afterClose: () => {
        if (!discarded) setDiscarding(false);
      },
      onOk: async () => {
        const problem = reasonProblem(reason);
        if (problem) {
          message.error(problem);
          throw new Error(problem);
        }
        const r = await discardReconciliationAction(reconciliationId, { reason: reason.trim() });
        if (!r.ok || !r.data) {
          message.error(r.error ?? "The reconciliation could not be discarded");
          throw new Error(r.error);
        }
        discarded = true;
        message.success(discardedMessage(r.data.ticksRemoved));
        router.push(discardedReturnPath(bankAccount.id));
      },
    });
  };

  const toggle = async (line: ReconLineView, cleared: boolean) => {
    const r = await setClearedAction(reconciliationId, line.journalLineId, cleared);
    if (r.ok) void load();
    else message.error(r.error ?? "Failed");
  };

  const submitAdjust = async () => {
    if (adjusting) return;
    const v = await form.validateFields();
    setAdjusting(true);
    try {
      const r = await recordAdjustmentAction(reconciliationId, { offset_account_id: v.offset_account_id, reason: v.reason });
      if (r.ok) {
        message.success("Adjustment recorded");
        setAdjOpen(false);
        form.resetFields();
        await load();
      } else {
        message.error(r.error ?? "Failed");
      }
    } finally {
      setAdjusting(false);
    }
  };

  const complete = async () => {
    if (completing) return;
    setCompleting(true);
    try {
      const r = await completeReconciliationAction(reconciliationId);
      if (r.ok) {
        const said = completedMessage(r.data?.matched ?? null, r.data?.matchError ?? null);
        if (r.data?.matchError || (r.data?.matched && bankLinesToCheck(r.data.matched) > 0)) message.warning(said, 10);
        else message.success(said, 8);
        await load();
      } else {
        message.error(r.error ?? "Failed");
      }
    } finally {
      setCompleting(false);
    }
  };

  const reopen = () => {
    if (reopening) return;
    setReopening(true);
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
      afterClose: () => setReopening(false),
      onOk: async () => {
        const r = await reopenReconciliationAction(reconciliationId, { reason });
        if (r.ok) {
          message.success(
            r.data?.submittedForApproval
              ? "Reconciliation reopen submitted for approval"
              : "Reopened",
          );
          // The dialog stays until the figures say the reconciliation is open again, and Reopen has gone.
          if (!r.data?.submittedForApproval) {
            void loadHistory();
            await load();
          }
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
   * statement is being worked from. It is proved first (2.04): the dialog
   * sends the lines (those ticked Not a transaction left out, those already
   * here from another source marked skip) and the proof, and the
   * reconciliation keeps the opening and closing it was proved between.
   */
  async function importStatement({ fileName, file, statement: pdf, lines: read, rows, proof, repeats }: ConfirmedImport) {
    setImporting(true);
    try {
      // Kept first, so the reconciliation takes its file with its lines (1.83);
      // a file that cannot be kept costs only the file.
      const kept: KeptStatementFile = await import("@/lib/client/keep-statement-file")
        .then(({ keepStatementFile }) =>
          keepStatementFile(file, fileAccount, pdf ? { from: pdf.from, to: pdf.to } : linesSpan(read)),
        )
        .catch((error: unknown): KeptStatementFile => ({
          ok: false,
          reason: error instanceof Error ? error.message : "the upload could not start",
        }));
      const res = await importStatementIntoReconciliationAction(reconciliationId, {
        file_name: fileName,
        lines: rows,
        proof,
        statement_file_id: kept.ok ? kept.id : null,
      });
      if (!res.ok || !res.data) {
        // A statement that does not add up, a balance missing, an override
        // refused: said in the server's own words.
        message.error(res.error ?? "Failed to import the statement", 10);
        return;
      }
      setImportOpen(false);
      const imported = importedSummary({
        inserted: res.data.inserted,
        alreadyHere: res.data.duplicates,
        otherSource: res.data.otherSource,
        repeats,
      });
      message.success(`${imported} ${pairingMessage(res.data.outcome)}`, 8);
      if (!kept.ok) message.warning(keepFailureMessage(kept.reason, "reconciliation"), 10);
      if (res.data.fileWarning) message.warning(res.data.fileWarning, 10);
      void load();
      void loadHistory();
    } catch (error) {
      message.error(`Failed to import the statement: ${serverFailure(error)}`, 10);
    } finally {
      setImporting(false);
    }
  }

  /**
   * Attach the statement to a reconciliation that has no file: read here with
   * the same readers, attached only when it adds up (2.04; the dialog will not
   * send one that does not) and is this reconciliation's statement — its lines
   * counted as the reconciliation counts its own, those ticked Not a
   * transaction left out — otherwise nothing is kept and the message says what
   * differs.
   */
  async function attachStatement({ file, statement: pdf, lines: rows, aside, proof }: ConfirmedImport) {
    if (!statement || !detail) return;
    const read = {
      to: pdf?.to ?? null,
      closingMinor: pdf?.closingMinor ?? null,
      lines: rows.map((r) => ({ txn_date: r.txn_date, amount_minor: r.amount_minor })),
    };
    const mismatch = attachMismatch(
      read,
      aside,
      {
        endingDate: statement.endingDate,
        endingMinor: detail.statementEndingMinor,
        keptLines: statement.lines.map((l) => ({ txn_date: l.txnDate, amount_minor: l.amountMinor, setAside: l.setAside })),
      },
      money,
    );
    if (mismatch) {
      message.error(mismatch, 10);
      return;
    }
    setAttaching(true);
    try {
      const kept: KeptStatementFile = await import("@/lib/client/keep-statement-file")
        .then(({ keepStatementFile }) =>
          keepStatementFile(file, fileAccount, pdf ? { from: pdf.from, to: pdf.to } : linesSpan(rows)),
        )
        .catch((error: unknown): KeptStatementFile => ({
          ok: false,
          reason: error instanceof Error ? error.message : "the upload could not start",
        }));
      if (!kept.ok) {
        message.error(`The statement file could not be kept: ${kept.reason}.`, 10);
        return;
      }
      const res = await attachStatementFileAction({
        reconciliation_id: reconciliationId,
        file_id: kept.id,
        to: read.to,
        closing_minor: read.closingMinor,
        lines: read.lines,
        aside,
        proof,
      });
      if (!res.ok) {
        message.error(res.error ?? "Failed to attach the statement", 10);
        return;
      }
      setAttachOpen(false);
      message.success("The statement file is attached to this reconciliation.");
      void load();
      void loadHistory();
    } catch (error) {
      message.error(`Failed to attach the statement: ${serverFailure(error)}`, 10);
    } finally {
      setAttaching(false);
    }
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
      {historyAdvice && historyFacts ? (
        <Alert
          type={historyAdvice.canBringForward ? "info" : "warning"}
          showIcon
          title={historyAdvice.text}
          description={
            historyAdvice.canBringForward && writing ? (
              <Button
                type="primary"
                size="small"
                loading={bringing}
                onClick={() => bringHistoryForward(historyFacts, historyAdvice.entries)}
              >
                {BRING_HISTORY_FORWARD}
              </Button>
            ) : undefined
          }
        />
      ) : null}
      {detail && !completed ? (
        detail.differenceMinor === 0 ? (
          <Alert type="success" message="Difference is zero — ready to complete." />
        ) : explained ? (
          <DifferenceAlert explained={explained} money={money} />
        ) : null
      ) : null}
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
      {opening && !completed && !historyAdvice ? <Alert type="warning" showIcon title={opening} /> : null}
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
          <Button
            type="primary"
            loading={completing}
            disabled={!detail || detail.differenceMinor !== 0}
            onClick={() => void complete()}
          >
            Complete
          </Button>
          <Button disabled={!detail || detail.differenceMinor === 0 || adjusting} onClick={() => setAdjOpen(true)}>
            Record adjustment
          </Button>
          {writing ? (
            <Button danger loading={discarding} onClick={discard}>
              {DISCARD_RECONCILIATION}
            </Button>
          ) : null}
        </Space>
      )}
      {completed && canReopen && (
        <Button danger loading={reopening} onClick={reopen}>
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
                <Button type="link" size="small" disabled={!detail} onClick={() => setAttachOpen(true)}>
                  Attach the statement
                </Button>
              ) : null}
            </>
          )}
        </Space>
      ) : null}
      {shownPlan ? (
        <AddMissingBox
          plan={shownPlan}
          bankAccountId={bankAccount.id}
          money={money}
          adding={adding}
          onAdd={() => void addAll()}
          onAddAnyway={(line) => void addAnyway(line)}
          addingLine={addingLine}
        />
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
              {standings.aside > 0 ? <Tag>{standings.aside} set aside</Tag> : null}
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
          className={writing ? `${styles.statementLines} ${styles.withAction}` : styles.statementLines}
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
            { title: "Date", dataIndex: "txnDate", width: SW.date },
            { title: "Description", dataIndex: "description" },
            {
              title: "Reference",
              dataIndex: "reference",
              width: SW.reference,
              render: (value: string | null) => value ?? "—",
            },
            {
              title: "Amount",
              dataIndex: "amountMinor",
              width: SW.amount,
              align: "right",
              render: (value: number) => fmt(value),
            },
            {
              title: "With the books",
              key: "standing",
              width: SW.standing,
              render: (_: unknown, line) => {
                const standing = standingOf.get(line.lineNo);
                return standing ? <StandingTag standing={standing} extra={extraLines.has(line.lineNo)} /> : null;
              },
            },
            // A misread line is set aside as not a transaction, and brought back with Restore (2.03).
            ...(writing
              ? [
                  {
                    title: "",
                    key: "aside",
                    width: SW.aside,
                    align: "right" as const,
                    render: (_: unknown, line: ReconStatementLine) => {
                      const action = asideActionFor(standingOf.get(line.lineNo));
                      return action ? (
                        <Button
                          type="link"
                          size="small"
                          loading={asideLine === line.lineNo}
                          disabled={asideLine !== null && asideLine !== line.lineNo}
                          onClick={() => void setAside(line.lineNo, action.aside)}
                        >
                          {action.label}
                        </Button>
                      ) : null;
                    },
                  },
                ]
              : []),
          ]}
        />
      </div>

      <Typography.Text strong>Ledger lines in this reconciliation</Typography.Text>
      <Table
        className={styles.ledgerLines}
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
      <Modal
        open={adjOpen}
        title="Record adjustment"
        confirmLoading={adjusting}
        onCancel={() => setAdjOpen(false)}
        onOk={submitAdjust}
      >
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
          canOverride={canOverride}
          onConfirm={(confirmed) => void importStatement(confirmed)}
          onCancel={() => setImportOpen(false)}
        />
      ) : null}
      {attachOpen && statement ? (
        <ImportStatementModal
          open={attachOpen}
          bankAccount={bankAccount}
          importing={attaching}
          purpose="attach"
          title="Attach the statement"
          okLabel="Attach"
          intro={
            `Choose the bank's statement to ${shortDate(statement.endingDate, true)}. OneBook reads it here and attaches it ` +
            "only if it adds up and is this reconciliation's statement: the same closing balance and, when this reconciliation kept " +
            "the statement's lines, the same lines. Nothing in the reconciliation changes."
          }
          onConfirm={(confirmed) => void attachStatement(confirmed)}
          onCancel={() => setAttachOpen(false)}
        />
      ) : null}
    </Space>
  );
}
