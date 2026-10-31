"use client";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Dayjs } from "dayjs";
import { Alert, App, Button, Card, DatePicker, InputNumber, Space, Spin, Typography, type TableColumnsType } from "antd";
import DataTable from "@/components/ui/DataTable";
import StatusTag from "@/components/ui/StatusTag";
import { flexColumn, secondaryLine } from "@/components/ui/columns";
import { ToneBadge } from "@/lib/design/tone";
import { toMinor } from "@/lib/domain/money";
import { shown, stored } from "@/lib/domain/card-account";
import {
  OPEN_IN_PROGRESS,
  STATEMENT_BALANCE_ON,
  adjustedTitle,
  defaultHistoryAccount,
  historyClosingCell,
  historyDatedCell,
  historySinceCell,
  historyAdvice,
  historyBroughtForwardMessage,
  inProgressText,
  reconciledUpTo,
  type HistoryAccount,
  type HistoryAdvice,
  type HistoryPreview,
} from "@/lib/domain/reconcile-history";
import { bringHistoryForwardConfirmation } from "@/lib/domain/reconcile-statement";
import { formatMoney, formatDate } from "@/lib/format";
import { bringHistoryForwardAction, historyPreviewAction, reconciliationHistoryAction } from "../history-actions";
import { ADJUSTED_LOOK, HISTORY_COLUMN_WIDTH as W, HISTORY_ELASTIC_FLOOR, HISTORY_STATE_TONES } from "./history-columns";
import styles from "./history.module.css";

/** How long the preview waits after the date changes before it reads the books. */
const PREVIEW_DELAY_MS = 350;

/** A date in the table as the card under it prints one, "09/30/2026"; a dash when there is none. */
const historyDateCell = (iso: string | null) => (iso ? <time dateTime={iso}>{formatDate(iso)}</time> : "—");

/**
 * Reconcile history (2.03): every bank account with the posted lines no
 * completed reconciliation holds, and, for the account chosen, bringing its
 * history forward. The form reads "Statement balance on {date} = {amount}";
 * the books through that date are read as the date is chosen, and the
 * sentences and the button come from historyAdvice. Someone who may not
 * complete reconciliations sees the table and the preview but no button; the
 * database refuses anything that does not match exactly.
 */
interface Props {
  /** Staff holding `reconciliation.complete`: bringing history forward records a completed reconciliation. */
  canBringForward: boolean;
  /** The table the page read for the first paint; null when it did not (2.92). */
  initialRows: HistoryAccount[] | null;
  /** The company's today, in its own time zone: no later date can be chosen. */
  today: string;
  baseCurrency: string;
  baseDecimals: number;
}

export default function ReconcileHistoryClient({ canBringForward, initialRows, today, baseCurrency, baseDecimals }: Props) {
  const { message, modal } = App.useApp();
  const [rows, setRows] = useState<HistoryAccount[]>(initialRows ?? []);
  const [loaded, setLoaded] = useState(initialRows !== null);
  const seeded = useRef(initialRows !== null);
  const [picked, setPicked] = useState<string | null>(null);
  const [through, setThrough] = useState<Dayjs | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  // The books through a date, with the account and date they were read for.
  const [preview, setPreview] = useState<{ key: string; data: HistoryPreview } | null>(null);
  // The account and date whose reading failed: the spinner stops for them.
  const [failedKey, setFailedKey] = useState<string | null>(null);
  // Bringing forward: from the click until its dialog closes.
  const [bringing, setBringing] = useState(false);

  const money = (minor: number) => formatMoney(minor, baseCurrency, baseDecimals);

  const load = useCallback(async () => {
    const res = await reconciliationHistoryAction();
    setLoaded(true);
    if (res.ok && res.data) setRows(res.data);
    else message.error(res.error ?? "Failed to load the reconciliation history");
  }, [message]);

  useEffect(() => {
    // The page read the table for the first paint; every later change reads again.
    if (seeded.current) {
      seeded.current = false;
      return;
    }
    void load();
  }, [load]);

  // The account chosen, or the one the page opens on while none is.
  const chosenId = picked && rows.some((row) => row.bankAccountId === picked) ? picked : defaultHistoryAccount(rows);
  const chosen = rows.find((row) => row.bankAccountId === chosenId) ?? null;
  const throughIso = through ? through.format("YYYY-MM-DD") : null;
  const previewKey = chosenId && throughIso ? `${chosenId}|${throughIso}` : null;

  // The live preview: read once the date has settled, and only for the account
  // and date it was asked for.
  useEffect(() => {
    if (!chosenId || !throughIso) return;
    let live = true;
    const key = `${chosenId}|${throughIso}`;
    const timer = window.setTimeout(() => {
      void historyPreviewAction({ bank_account_id: chosenId, through: throughIso }).then((res) => {
        if (!live) return;
        if (res.ok && res.data) setPreview({ key, data: res.data });
        else {
          // The reading ends with the failure: no spinner is left running.
          setFailedKey(key);
          message.error(res.error ?? "The books could not be read on that date");
        }
      });
    }, PREVIEW_DELAY_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [chosenId, throughIso, message]);

  // A credit card's books and the balance typed are as its statement prints them (2.45).
  const side = chosen?.side ?? "bank";
  const rawPreview = preview && preview.key === previewKey ? preview.data : null;
  const shownPreview = rawPreview ? { ...rawPreview, bookBalanceMinor: shown(rawPreview.bookBalanceMinor, side) } : null;
  const balanceMinor = balance === null ? null : toMinor(balance, baseDecimals);
  const advice =
    chosen && chosen.state === "never" && throughIso && balanceMinor !== null && shownPreview
      ? historyAdvice(chosen, throughIso, balanceMinor, shownPreview, money)
      : null;
  const reading = Boolean(
    chosen && chosen.state === "never" && previewKey && balanceMinor !== null && !shownPreview && failedKey !== previewKey,
  );

  function choose(id: string) {
    if (id === chosenId) return;
    setPicked(id);
    setThrough(null);
    setBalance(null);
  }

  /**
   * Asks first, then brings the history forward. The button is busy from its
   * click until the dialog closes, so a second click cannot send it twice, and
   * a success clears the form at once: the offer goes with it.
   */
  function bringForward(account: HistoryAccount, date: string, statementMinor: number, offer: HistoryAdvice) {
    if (!offer.action || bringing) return;
    setBringing(true);
    modal.confirm({
      title: `${offer.action}?`,
      content: bringHistoryForwardConfirmation(offer.entries, date),
      okText: offer.action,
      cancelText: "Cancel",
      afterClose: () => setBringing(false),
      onOk: async () => {
        const r = await bringHistoryForwardAction({
          bank_account_id: account.bankAccountId,
          through: date,
          // Typed as the statement prints it; the books keep a card's balance owed negative.
          balance_minor: stored(statementMinor, account.side),
        });
        if (!r.ok || !r.data) {
          message.error(r.error ?? "The history could not be brought forward");
          throw new Error(r.error);
        }
        const rebased = r.data.rebasedReconciliationId ? statementMinor : null;
        message.success(historyBroughtForwardMessage(r.data.lines, date, rebased, money), 8);
        setThrough(null);
        setBalance(null);
        void load();
      },
    });
  }

  const columns: TableColumnsType<HistoryAccount> = [
    flexColumn<HistoryAccount>({
      title: "Account",
      key: "account",
      floor: HISTORY_ELASTIC_FLOOR,
      render: (_: unknown, row: HistoryAccount) => (
        <>
          <span title={row.label}>{row.label}</span>
          {row.maskedNumber ? secondaryLine(row.maskedNumber) : null}
        </>
      ),
    }),
    {
      title: "Lines not reconciled",
      dataIndex: "openLines",
      width: W.openLines,
      align: "right",
      render: (n: number) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{n.toLocaleString("en-US")}</span>,
    },
    {
      title: "First – last",
      key: "dated",
      width: W.dated,
      render: (_: unknown, row: HistoryAccount) => {
        const lines = historyDatedCell(row.firstOpenDate, row.lastOpenDate);
        if (!lines) return "—";
        return (
          <>
            <time dateTime={row.firstOpenDate ?? row.lastOpenDate ?? undefined}>{lines[0]}</time>
            {lines[1] ? secondaryLine(<time dateTime={row.lastOpenDate ?? undefined}>{lines[1]}</time>) : null}
          </>
        );
      },
    },
    {
      title: "Last reconciled",
      key: "lastReconciled",
      width: W.lastReconciled,
      render: (_: unknown, row: HistoryAccount) => {
        const closing = historyClosingCell(row.standing, money);
        return (
          <>
            {historyDateCell(row.lastReconciledDate)}
            {closing ? secondaryLine(closing.amount) : null}
            {closing?.broughtForward ? secondaryLine("(brought forward)") : null}
            {row.lastCompleted ? (
              <div style={{ fontSize: 12 }}>
                <Link href={`/banking/reconcile/${row.lastCompleted.id}/report`}>Report</Link>
              </div>
            ) : null}
          </>
        );
      },
    },
    {
      title: "Since",
      key: "since",
      width: W.since,
      align: "right",
      render: (_: unknown, row: HistoryAccount) => {
        const [first, ...rest] = historySinceCell(row.standing, money);
        return (
          <>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{first}</span>
            {rest.map((line) => (
              <Fragment key={line}>{secondaryLine(line)}</Fragment>
            ))}
          </>
        );
      },
    },
    {
      title: "Status",
      key: "state",
      width: W.state,
      render: (_: unknown, row: HistoryAccount) => (
        <Space orientation="vertical" size={0}>
          <Space size={6} wrap>
            <ToneBadge tone={HISTORY_STATE_TONES[row.state].tone}>{HISTORY_STATE_TONES[row.state].label}</ToneBadge>
            {row.lastCompleted?.adjusted ? (
              <StatusTag status="adjusted" looks={ADJUSTED_LOOK} title={adjustedTitle(row.lastCompleted)} />
            ) : null}
          </Space>
          {row.inProgress ? (
            <Link href={`/banking/reconcile/${row.inProgress.id}`}>{inProgressText(row.inProgress.endingDate)}</Link>
          ) : null}
        </Space>
      ),
    },
  ];

  return (
    <Space orientation="vertical" size="large" style={{ width: "100%" }}>
      <div className={styles.history}>
        <DataTable<HistoryAccount>
          rowKey="bankAccountId"
          columns={columns}
          dataSource={rows}
          loading={!loaded}
          emptyTitle="No bank accounts yet"
          rowSelection={{
            type: "radio",
            columnWidth: W.choose,
            selectedRowKeys: chosenId ? [chosenId] : [],
            onChange: (keys) => {
              if (keys[0]) choose(String(keys[0]));
            },
          }}
          onRow={(row) => ({ onClick: () => choose(row.bankAccountId) })}
        />
      </div>

      {chosen ? (
        <Card size="small" title={chosen.maskedNumber ? `${chosen.label} · ${chosen.maskedNumber}` : chosen.label}>
          {chosen.state === "reconciled" && chosen.lastReconciledDate ? (
            <Typography.Text>{reconciledUpTo(chosen.lastReconciledDate)}</Typography.Text>
          ) : (
            <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
              <Space wrap align="center">
                <Typography.Text>{STATEMENT_BALANCE_ON}</Typography.Text>
                <DatePicker
                  aria-label="Statement date"
                  value={through}
                  onChange={(value) => setThrough(value)}
                  disabledDate={(day) => day.format("YYYY-MM-DD") > today}
                />
                <Typography.Text>=</Typography.Text>
                <InputNumber<number>
                  aria-label="Statement balance"
                  style={{ width: 180 }}
                  precision={baseDecimals}
                  value={balance}
                  onChange={(value) => setBalance(value ?? null)}
                />
              </Space>
              {reading ? <Spin size="small" /> : null}
              {advice?.kind === "match" ? (
                <Alert
                  type="success"
                  showIcon
                  title={advice.text}
                  description={
                    advice.action && canBringForward && throughIso && balanceMinor !== null ? (
                      <Button
                        type="primary"
                        size="small"
                        loading={bringing}
                        onClick={() => bringForward(chosen, throughIso, balanceMinor, advice)}
                      >
                        {advice.action}
                      </Button>
                    ) : undefined
                  }
                />
              ) : null}
              {advice?.kind === "out" ? <Alert type="warning" showIcon title={advice.text} /> : null}
              {advice?.kind === "inProgress" && advice.inProgressId ? (
                <Alert
                  type="warning"
                  showIcon
                  title={advice.text}
                  description={<Link href={`/banking/reconcile/${advice.inProgressId}`}>{OPEN_IN_PROGRESS}</Link>}
                />
              ) : null}
              {advice?.kind === "reconciled" ? <Alert type="info" showIcon title={advice.text} /> : null}
            </Space>
          )}
        </Card>
      ) : null}
    </Space>
  );
}
