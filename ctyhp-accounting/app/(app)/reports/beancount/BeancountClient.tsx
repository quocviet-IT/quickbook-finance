"use client";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Alert, App, Button, Space, Spin } from "antd";
import { CopyOutlined, DownloadOutlined } from "@ant-design/icons";
import EntryDetailDrawer from "@/components/reports/EntryDetailDrawer";
import { StatRow, reportPaperStyles as styles } from "@/components/reports/ReportPaper";
import { downloadTextFile } from "@/lib/client/download";
import type { BeancountTextLine } from "@/lib/domain/beancount";
import { shortDate } from "@/lib/domain/report-presets";
import type { BeancountSummary } from "@/lib/services/beancount";
import { beancountExportAction, beancountPreviewAction } from "./actions";

/** How many lines are drawn at a time. A large book is thousands; the file itself is always whole. */
const LINES_PER_STEP = 3000;

/**
 * The Beancount page, as the client's prototype has it (`renderLedger` in
 * Accounting-System-v3.html): the file's name, a line saying what it is, Copy
 * and Save file, then the whole file — with every account name opening that
 * account's ledger and every transaction and amount opening its entry.
 *
 * Copy and Save file hand the ledger over, so each goes through the audited
 * export and is refused if the audit record cannot be written. The file shown
 * on the page is built by the same function, so what is read here is what is
 * handed over.
 */
export default function BeancountClient({
  companyName,
  fileName,
  summary,
  summaryError,
  canExport,
}: {
  companyName: string;
  fileName: string;
  summary: BeancountSummary | null;
  summaryError: string | null;
  canExport: boolean;
}) {
  const { message } = App.useApp();
  const [lines, setLines] = useState<BeancountTextLine[] | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [shown, setShown] = useState(LINES_PER_STEP);
  const [busy, setBusy] = useState<"copy" | "save" | null>(null);
  const [openEntry, setOpenEntry] = useState<string | null>(null);

  useEffect(() => {
    if (!canExport) return;
    let cancelled = false;
    void beancountPreviewAction().then((r) => {
      if (cancelled) return;
      if (r.ok && r.data) setLines(r.data.lines);
      else setPreviewError(r.error ?? "The ledger could not be read.");
    });
    return () => {
      cancelled = true;
    };
  }, [canExport]);

  const save = async () => {
    setBusy("save");
    const r = await beancountExportAction();
    setBusy(null);
    if (!r.ok || !r.data) {
      message.error(r.error ?? "The file could not be produced.");
      return;
    }
    downloadTextFile(r.data.fileName, r.data.text, "text/plain;charset=utf-8");
    message.success(`Saved ${r.data.fileName}: ${r.data.entryCount.toLocaleString("en-US")} entries. Recorded in the audit log.`);
  };

  const copy = async () => {
    setBusy("copy");
    let failure: string | null = null;
    const exported = beancountExportAction().then((r) => {
      if (!r.ok || !r.data) {
        failure = r.error ?? "The ledger could not be copied.";
        throw new Error(failure);
      }
      return r.data.text;
    });
    try {
      // Handing the clipboard a promise keeps the click's permission alive
      // while the file is built — Safari refuses a write that comes later.
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({ "text/plain": exported.then((t) => new Blob([t], { type: "text/plain" })) }),
        ]);
      } else {
        await navigator.clipboard.writeText(await exported);
      }
      message.success("Copied the whole ledger. Recorded in the audit log.");
    } catch {
      message.error(failure ?? "The browser would not let this page copy. Use Save file instead.");
    } finally {
      setBusy(null);
    }
  };

  const today = new Date().toISOString().slice(0, 10);
  const ledgerHref = (accountId: string) => `/reports/general-ledger?account=${accountId}&to=${today}`;

  const rendered = useMemo(() => {
    if (!lines) return null;
    const account = (id: string, name: string, key: string): ReactNode => (
      <a
        key={key}
        className={styles.ac}
        href={ledgerHref(id)}
        target="_blank"
        rel="noopener"
        title={`Open the ledger for ${name} in a new tab`}
      >
        {name}
      </a>
    );
    const line = (l: BeancountTextLine, i: number): ReactNode => {
      switch (l.kind) {
        case "comment":
        case "meta":
          return <span className={styles.cm}>{l.text}</span>;
        case "option":
        case "price":
          return <span className={styles.kw}>{l.text}</span>;
        case "blank":
          return null;
        case "open":
          return (
            <>
              <span className={styles.op}>{l.text.slice(0, l.accountStart)}</span>
              {account(l.accountId, l.text.slice(l.accountStart), `a${i}`)}
            </>
          );
        case "txn":
          return (
            <button type="button" className={styles.tx} onClick={() => setOpenEntry(l.entryId)} title="Open this entry">
              {l.text}
            </button>
          );
        case "posting":
          return (
            <>
              {"  "}
              {account(l.accountId, l.text.slice(2, l.accountEnd), `a${i}`)}
              {l.text.slice(l.accountEnd, l.amountStart)}
              <button
                type="button"
                className={`${styles.amt}${l.credit ? ` ${styles.credit}` : ""}`}
                onClick={() => setOpenEntry(l.entryId)}
                title="Open the entry behind this amount"
              >
                {l.text.slice(l.amountStart, l.amountEnd)}
              </button>
              <span className={styles.cm}>{l.text.slice(l.amountEnd)}</span>
            </>
          );
        case "reconciliation":
          return (
            <a
              className={styles.cm}
              href={`/banking/reconcile/${l.reconciliationId}`}
              target="_blank"
              rel="noopener"
              title="Open this reconciliation in a new tab"
            >
              {l.text}
            </a>
          );
        case "balance":
          return (
            <>
              <span className={styles.op}>{l.text.slice(0, l.accountStart)}</span>
              {account(l.accountId, l.text.slice(l.accountStart, l.accountEnd), `a${i}`)}
              <span className={styles.kw}>{l.text.slice(l.accountEnd)}</span>
            </>
          );
      }
    };
    return lines.slice(0, shown).map((l, i) => (
      <Fragment key={i}>
        {line(l, i)}
        {"\n"}
      </Fragment>
    ));
    // `ledgerHref` reads only `today`, fixed for the visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, shown]);

  return (
    <div>
      <div className={styles.fileHead}>
        <div>
          <h2 className={styles.fileName}>{fileName}</h2>
          <p className={styles.lede}>
            Valid Beancount v3 for {companyName}. Account names and amounts are live — click one to open its ledger or
            its entry. Each reconciled bank statement adds a balance line, so bean-check refuses the file if that
            period changes.
          </p>
        </div>
        {canExport ? (
          <Space wrap>
            <Button icon={<CopyOutlined />} loading={busy === "copy"} disabled={busy !== null} onClick={() => void copy()}>
              Copy
            </Button>
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              loading={busy === "save"}
              disabled={busy !== null}
              onClick={() => void save()}
            >
              Save file
            </Button>
          </Space>
        ) : null}
      </div>

      {summaryError ? (
        <Alert type="error" showIcon title="The book could not be summarised" description={summaryError} style={{ marginBottom: 16 }} />
      ) : summary ? (
        <StatRow
          items={[
            { label: "Posted entries", value: summary.entryCount.toLocaleString("en-US") },
            { label: "Accounts", value: summary.accountCount.toLocaleString("en-US") },
            { label: "First entry", value: summary.firstDate ? shortDate(summary.firstDate) : "—" },
            { label: "Last entry", value: summary.lastDate ? shortDate(summary.lastDate) : "—" },
            { label: "Currencies", value: summary.currencies.length > 0 ? summary.currencies.join(", ") : "—" },
            { label: "Reconciled statements", value: summary.reconciledStatements.toLocaleString("en-US") },
          ]}
        />
      ) : null}

      {summary && summary.bankAccountsUnreconciled > 0 ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          title={`${summary.bankAccountsUnreconciled} of ${summary.bankAccountCount} bank accounts have no completed reconciliation`}
          description={
            <>
              The file asserts a balance only for statements that were reconciled. Reconcile one under{" "}
              <Link href="/banking/reconcile">Banking › Reconcile</Link> to add its balance line.
            </>
          }
        />
      ) : null}

      {!canExport ? (
        <Alert
          type="info"
          showIcon
          title="Seeing and saving this file needs the Export company data permission"
          description="The file is the whole ledger, so it is shown and handed over only to people allowed to export company data. An administrator can grant it under Settings, Users."
        />
      ) : previewError ? (
        <Alert type="error" showIcon title="The ledger could not be read" description={previewError} />
      ) : !lines ? (
        <div className={styles.code} style={{ textAlign: "center", padding: "56px 0", whiteSpace: "normal" }}>
          <Space orientation="vertical" size={12}>
            <Spin />
            <span className={styles.cm}>Reading the whole ledger…</span>
          </Space>
        </div>
      ) : (
        <>
          <pre className={`${styles.code} ${styles.codeTall}`} aria-label={`${fileName}, ${lines.length} lines`}>
            {rendered}
          </pre>
          {lines.length > shown ? (
            <div className={styles.codeMore}>
              <span>
                Showing the first {shown.toLocaleString("en-US")} of {lines.length.toLocaleString("en-US")} lines. Save
                file always has them all.
              </span>
              <Button size="small" onClick={() => setShown((n) => n + LINES_PER_STEP)}>
                Show {Math.min(LINES_PER_STEP, lines.length - shown).toLocaleString("en-US")} more
              </Button>
            </div>
          ) : null}
        </>
      )}

      <div className={styles.notes}>
        <div className={styles.note}>
          <strong>Documents survive the export.</strong> Invoices and bills carry an <code>#invoice</code> or{" "}
          <code>#bill</code> tag and a <code>^link</code> to their number; the payment that settles one carries the same
          link, so Fava groups them. Due dates travel as <code>due:</code>, check numbers as <code>num:</code>, and every
          transaction keeps its OneBook entry number as <code>entry:</code>. Amounts stay in each entry&apos;s own
          currency.
        </div>
        <div className={styles.note}>
          <strong>For whoever opens it in Beancount.</strong> Beancount and Fava are free tools a reviewer or bookkeeper
          may use to check these books. Installed once with <code>pip install beancount fava</code>,{" "}
          <code>bean-check {fileName}</code> confirms every entry balances, and <code>fava {fileName}</code> opens the
          ledger in a browser at <code>localhost:5000</code>.
        </div>
      </div>

      <EntryDetailDrawer entryId={openEntry} onClose={() => setOpenEntry(null)} />
    </div>
  );
}
