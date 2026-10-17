"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, App, Button, DatePicker, Input, Modal, Select, Space, Spin } from "antd";
import dayjs from "dayjs";
import {
  CASH_COUNT_MEMO_MAX,
  WAITS_FOR_APPROVAL_NOTE,
  cashVariance,
  countDateProblem,
  parseCountedAmount,
  varianceView,
} from "@/lib/domain/cash-count";
import { shortDate } from "@/lib/domain/report-presets";
import {
  cashCountOptionsAction,
  cashCountPreviewAction,
  postCashCountAction,
  type CashCountOptions,
} from "./actions";
import styles from "./count-cash.module.css";

export interface CountableAccount {
  id: string;
  name: string;
}

interface Props {
  /** The account being counted; null keeps the dialog closed. */
  account: CountableAccount | null;
  /** The company's today, read on the server in its time zone. */
  today: string;
  money: (minor: number) => string;
  decimals: number;
  onClose: () => void;
  /** After a count is recorded, so the screen can read its figures again. */
  onRecorded: () => void;
}

/**
 * Count the cash in a till: the date, the amount counted, where a difference
 * goes and a memo. It shows the books' balance at the chosen date and the
 * difference as the amount is typed. The database decides the rest: the book
 * balance it records is its own, read at posting.
 */
export default function CountCashDialog({ account, today, money, decimals, onClose, onRecorded }: Props) {
  return (
    <Modal
      title={account ? `Count cash: ${account.name}` : "Count cash"}
      open={account !== null}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
      width={520}
    >
      {account ? (
        <CountForm
          account={account}
          today={today}
          money={money}
          decimals={decimals}
          onClose={onClose}
          onRecorded={onRecorded}
        />
      ) : null}
    </Modal>
  );
}

function CountForm({
  account,
  today,
  money,
  decimals,
  onClose,
  onRecorded,
}: Omit<Props, "account"> & { account: CountableAccount }) {
  const { message } = App.useApp();
  const [options, setOptions] = useState<CashCountOptions | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [date, setDate] = useState(today);
  const [raw, setRaw] = useState("");
  const [amountError, setAmountError] = useState<string | null>(null);
  const [offsetId, setOffsetId] = useState<string | null>(null);
  const [memo, setMemo] = useState("");
  const [book, setBook] = useState<number | null>(null);
  const [bookError, setBookError] = useState<string | null>(null);
  const [reading, setReading] = useState(true);
  const [waits, setWaits] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const latestRead = useRef(0);

  /** Reads the book balance (and the approval answer for a typed amount); the latest read wins. */
  async function load(on: string, countedMinor: number | null) {
    const run = ++latestRead.current;
    try {
      const result = await cashCountPreviewAction({ accountId: account.id, date: on, countedMinor });
      if (run !== latestRead.current) return;
      if (result.ok && result.data) {
        setBook(result.data.bookMinor);
        setWaits(result.data.waits);
      } else {
        setBook(null);
        setWaits(false);
        setBookError(result.error ?? "The book balance could not be read");
      }
    } catch {
      if (run !== latestRead.current) return;
      setBook(null);
      setWaits(false);
      setBookError("The book balance could not be read. Check the connection and try again.");
    } finally {
      if (run === latestRead.current) setReading(false);
    }
  }

  /** A read started by the person: show that it is under way, then load. */
  function read(on: string, countedMinor: number | null) {
    setReading(true);
    setBookError(null);
    // The old date's figures must not stand in for the new one's while it is read.
    setBook(null);
    setWaits(false);
    return load(on, countedMinor);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // The first read of the book balance: `reading` starts true, so nothing is set before it answers.
      void load(today, null);
      try {
        const result = await cashCountOptionsAction();
        if (cancelled) return;
        if (result.ok && result.data) {
          setOptions(result.data);
          setOffsetId(result.data.defaultOffsetId);
        } else setOptionsError(result.error ?? "The accounts could not be read");
      } catch {
        if (!cancelled) setOptionsError("The accounts could not be read. Check the connection and try again.");
      }
    })();
    return () => {
      cancelled = true;
    };
    // Opened once per account: the dialog is mounted fresh each time (destroyOnHidden).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const parsed = useMemo(() => parseCountedAmount(raw, decimals), [raw, decimals]);
  const difference = parsed.ok && book !== null && !reading ? cashVariance(parsed.minor, book) : null;
  const variance = difference === null ? null : varianceView(difference, money);
  const offsetChoices = useMemo(
    () =>
      (options?.offsetAccounts ?? [])
        .filter((a) => a.id !== account.id)
        .map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` })),
    [options, account.id],
  );
  const needsChoice = options !== null && options.defaultOffsetId === null;

  function changeDate(next: dayjs.Dayjs | null) {
    if (!next) return;
    const on = next.format("YYYY-MM-DD");
    setDate(on);
    void read(on, parsed.ok ? parsed.minor : null);
  }

  function leaveAmount() {
    if (raw.trim() === "") {
      setAmountError(null);
      return;
    }
    setAmountError(parsed.ok ? null : parsed.error);
    if (parsed.ok) void read(date, parsed.minor);
  }

  async function submit() {
    setFormError(null);
    const dateProblem = countDateProblem(date, today);
    if (dateProblem) return setFormError(dateProblem);
    if (!parsed.ok) {
      setAmountError(parsed.error);
      return;
    }
    if (!offsetId) return setFormError("Choose the account the difference goes to");
    setSaving(true);
    try {
      const result = await postCashCountAction({
        accountId: account.id,
        date,
        countedMinor: parsed.minor,
        offsetAccountId: offsetId,
        memo: memo.trim(),
      });
      if (result.ok && result.data) {
        message.success(result.data.message);
        onRecorded();
        onClose();
      } else setFormError(result.error ?? "The count could not be recorded");
    } catch {
      setFormError("The count could not be recorded. Check the connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.form}>
      {optionsError ? <Alert type="warning" showIcon title={optionsError} /> : null}
      {needsChoice ? (
        <Alert
          type="info"
          showIcon
          title="7510 Cash Over and Short cannot take this entry here. Choose the account the difference goes to."
        />
      ) : null}

      <label className={styles.field}>
        <span>Date of the count</span>
        <DatePicker
          aria-label="Date of the count"
          value={dayjs(date)}
          allowClear={false}
          disabledDate={(d) => d.format("YYYY-MM-DD") > today}
          onChange={changeDate}
          style={{ width: "100%" }}
        />
      </label>

      <div className={styles.book} aria-live="polite">
        {reading ? (
          <Spin size="small" />
        ) : bookError ? (
          <span className={styles.problem}>{bookError}</span>
        ) : book !== null ? (
          <span>
            Book balance on {shortDate(date)}: <strong>{money(book)}</strong>
          </span>
        ) : null}
      </div>

      <label className={styles.field}>
        <span>Amount counted</span>
        <Input
          aria-label="Amount counted"
          inputMode="decimal"
          placeholder="e.g. 1,250.00"
          value={raw}
          status={amountError ? "error" : undefined}
          onChange={(e) => {
            setRaw(e.target.value);
            if (amountError) setAmountError(null);
          }}
          onBlur={leaveAmount}
          onPressEnter={leaveAmount}
        />
        {amountError ? (
          <span className={styles.problem} role="alert">
            {amountError}
          </span>
        ) : null}
      </label>

      <div className={styles.variance} aria-live="polite" data-kind={variance?.kind ?? "none"}>
        {variance ? variance.text : "Enter the amount counted to see the difference."}
      </div>

      <label className={styles.field}>
        <span>Difference goes to</span>
        <Select
          aria-label="Difference goes to"
          showSearch
          placeholder="Choose an account"
          value={offsetId}
          onChange={setOffsetId}
          options={offsetChoices}
          loading={options === null && !optionsError}
          filterOption={(input, option) => String(option?.label ?? "").toLowerCase().includes(input.toLowerCase())}
        />
      </label>

      <label className={styles.field}>
        <span>Memo (optional)</span>
        <Input.TextArea
          aria-label="Memo"
          rows={2}
          maxLength={CASH_COUNT_MEMO_MAX}
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
        />
      </label>

      {formError ? <Alert type="error" showIcon title={formError} /> : null}

      <div className={styles.actions}>
        {waits ? <span className={styles.waits}>{WAITS_FOR_APPROVAL_NOTE}</span> : null}
        <Space>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" onClick={() => void submit()} loading={saving} disabled={options === null || reading}>
            Record count
          </Button>
        </Space>
      </div>
    </div>
  );
}
