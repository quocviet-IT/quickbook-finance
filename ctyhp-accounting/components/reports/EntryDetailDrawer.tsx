"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Alert, Button, Drawer, Skeleton } from "antd";
import { formatMoney } from "@/lib/format";
import { entryHeadline, entryTotals, type EntryDetail } from "@/lib/domain/entry-detail";
import { shortDate } from "@/lib/domain/report-presets";
import { entryDetailAction } from "@/app/(app)/reports/entry-actions";
import { SourceTag, reportPaperStyles as styles } from "./ReportPaper";

/**
 * The "Transaction detail" sheet of the client's prototype (`drillTxn`,
 * `renderDrill`): what a reviewer sees on clicking a line of a report, without
 * leaving the report.
 *
 * It shows who the entry was with, the document behind it and its lines, the
 * double entry, the payments that settled it or the documents it settled, and
 * the entry as Beancount writes it. Following a settlement row opens that
 * entry on top, and the breadcrumbs walk back.
 *
 * It only reads. Acting on an entry — reversing it, attaching a receipt — is
 * done where it always is, on the Journal screen the footer links to.
 */
export default function EntryDetailDrawer({
  entryId,
  onClose,
}: {
  entryId: string | null;
  onClose: () => void;
}) {
  const [stack, setStack] = useState<string[]>([]);
  const [details, setDetails] = useState<Record<string, EntryDetail>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  // A new entry from the report starts a new trail.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStack(entryId ? [entryId] : []);
  }, [entryId]);

  const current = stack[stack.length - 1] ?? null;
  const detail = current ? details[current] : undefined;
  const error = current ? errors[current] : undefined;

  useEffect(() => {
    if (!current || details[current] || errors[current]) return;
    let cancelled = false;
    void entryDetailAction(current).then((r) => {
      if (cancelled) return;
      if (r.ok && r.data) setDetails((d) => ({ ...d, [current]: r.data as EntryDetail }));
      else setErrors((e) => ({ ...e, [current]: r.error ?? "The entry could not be read." }));
    });
    return () => {
      cancelled = true;
    };
  }, [current, details, errors]);

  const open = (id: string | null) => {
    if (id && id !== current) setStack((s) => [...s, id]);
  };

  const money = (minor: number) => (detail ? formatMoney(minor, detail.currencyCode, detail.decimals) : "");
  const today = new Date().toISOString().slice(0, 10);

  const title = (
    <div>
      {stack.length > 1 ? (
        <nav className={styles.crumbs} aria-label="Entries opened">
          {stack.map((id, i) => {
            const label = details[id]?.entryNumber ?? "Entry";
            return i === stack.length - 1 ? (
              <span key={id}>{label}</span>
            ) : (
              <span key={id} style={{ display: "inline-flex", gap: 5 }}>
                <button type="button" onClick={() => setStack((s) => s.slice(0, i + 1))}>
                  {label}
                </button>
                <span aria-hidden>›</span>
              </span>
            );
          })}
        </nav>
      ) : null}
      <div className={styles.sheetTitle}>Transaction detail</div>
      <div className={styles.sheetSub}>Document and double entry · Accrual basis</div>
    </div>
  );

  return (
    <Drawer
      title={title}
      open={entryId !== null}
      onClose={onClose}
      size={680}
      destroyOnHidden
      footer={
        current ? (
          <Link href={`/journal?entry=${current}`}>
            <Button>Open in Journal</Button>
          </Link>
        ) : null
      }
    >
      {error ? (
        <Alert type="error" showIcon title={error} />
      ) : !detail ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : (
        <EntryBody detail={detail} money={money} today={today} onOpen={open} />
      )}
    </Drawer>
  );
}

function EntryBody({
  detail,
  money,
  today,
  onOpen,
}: {
  detail: EntryDetail;
  money: (minor: number) => string;
  today: string;
  onOpen: (entryId: string | null) => void;
}) {
  const { payee, narration } = entryHeadline(detail);
  const totals = entryTotals(detail.lines);
  const doc = detail.document;
  const docLinesTotal = doc ? doc.totalMinor : 0;

  return (
    <>
      {detail.status === "void" ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          title="This entry was voided"
          description="A voided entry is out of every report and every balance. It is shown here as it was."
        />
      ) : null}

      <div className={styles.meta}>
        <SourceTag sourceType={detail.sourceType} number={doc?.number ?? detail.entryNumber} />
        <div className={styles.payee}>{payee}</div>
        {narration ? <div className={styles.narration}>{narration}</div> : null}
        <div className={styles.when}>
          {shortDate(detail.entryDate)}
          {doc?.dueDate ? ` · due ${shortDate(doc.dueDate)}` : ""}
          {doc?.number ? ` · entry ${detail.entryNumber}` : ""}
        </div>
      </div>

      {detail.documentLines.length > 0 ? (
        <>
          <div className={styles.eyebrow}>Document lines</div>
          <table className={styles.detTable}>
            <thead>
              <tr>
                <th>Account</th>
                <th>Description</th>
                <th className={styles.right}>Qty</th>
                <th className={styles.right}>Rate</th>
                <th className={styles.right}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {detail.documentLines.map((l, i) => (
                <tr key={i}>
                  <td>{l.account}</td>
                  <td>{l.description}</td>
                  <td className={styles.right}>{l.quantity ?? ""}</td>
                  <td className={styles.right}>{l.rateMinor === null ? "" : money(l.rateMinor)}</td>
                  <td className={styles.right}>{money(l.amountMinor)}</td>
                </tr>
              ))}
              {doc && doc.taxMinor !== 0 ? (
                <tr>
                  <td colSpan={4}>Sales tax</td>
                  <td className={styles.right}>{money(doc.taxMinor)}</td>
                </tr>
              ) : null}
              <tr className={styles.total}>
                <td colSpan={4}>Total</td>
                <td className={styles.right}>{money(docLinesTotal)}</td>
              </tr>
            </tbody>
          </table>
        </>
      ) : null}

      <div className={styles.eyebrow}>Double entry</div>
      <table className={styles.detTable}>
        <thead>
          <tr>
            <th>Account</th>
            <th className={styles.right}>Debit</th>
            <th className={styles.right}>Credit</th>
          </tr>
        </thead>
        <tbody>
          {detail.lines.map((l, i) => (
            <tr key={i}>
              <td>
                <a
                  className={styles.accountLink}
                  href={`/reports/general-ledger?account=${l.accountId}&to=${today}`}
                  target="_blank"
                  rel="noopener"
                  title="Open this account's ledger in a new tab"
                >
                  {l.accountCode} {l.accountName}
                </a>
                {l.memo ? <div className={styles.narration}>{l.memo}</div> : null}
              </td>
              <td className={styles.right}>{l.debitMinor ? money(l.debitMinor) : ""}</td>
              <td className={styles.right}>{l.creditMinor ? money(l.creditMinor) : ""}</td>
            </tr>
          ))}
          <tr className={styles.total}>
            <td>Total</td>
            <td className={styles.right}>{money(totals.debitMinor)}</td>
            <td className={styles.right}>{money(totals.creditMinor)}</td>
          </tr>
        </tbody>
      </table>
      {totals.differenceMinor !== 0 ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 14 }}
          title={`This entry is out of balance by ${money(totals.differenceMinor)}.`}
        />
      ) : null}

      {detail.settlement ? (
        <>
          <div className={styles.eyebrow}>{detail.settlement.heading}</div>
          <table className={styles.detTable}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>{detail.settlement.heading === "Settlement" ? "Reference" : "Document"}</th>
                <th className={styles.right}>Applied</th>
              </tr>
            </thead>
            <tbody>
              {detail.settlement.rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className={styles.muted}>
                    Nothing applied yet.
                  </td>
                </tr>
              ) : (
                detail.settlement.rows.map((r, i) => (
                  <tr
                    key={i}
                    className={r.entryId ? styles.rowLink : undefined}
                    onClick={r.entryId ? () => onOpen(r.entryId) : undefined}
                    title={r.entryId ? "Open this entry" : undefined}
                  >
                    <td>{shortDate(r.date)}</td>
                    <td>
                      <SourceTag sourceType={r.sourceType} number={r.number} />
                    </td>
                    <td>{r.label}</td>
                    <td className={styles.right}>{money(r.appliedMinor)}</td>
                  </tr>
                ))
              )}
              <tr className={styles.total}>
                <td colSpan={3}>{detail.settlement.totalLabel}</td>
                <td className={styles.right}>{money(detail.settlement.totalMinor)}</td>
              </tr>
            </tbody>
          </table>
        </>
      ) : null}

      <div className={styles.eyebrow}>As Beancount</div>
      <pre className={styles.code}>{detail.beancount}</pre>
    </>
  );
}
