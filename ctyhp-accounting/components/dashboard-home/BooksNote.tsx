"use client";
import { ExclamationCircleOutlined } from "@ant-design/icons";
import type { HomeStatus } from "@/lib/domain/dashboard-home/types";
import type { SectionEnvelope } from "@/lib/domain/work-surface/types";
import { formatDate } from "@/lib/format";
import styles from "./dashboard-home.module.css";
import { booksNote } from "./view";
import { RetryButton, Spacer, TextLink } from "./Widget";

/**
 * How far the books reach, above everything else: posted through, bank lines
 * imported through, the last month closed. When the books are behind it says
 * so in words, so an empty month further down is read as "not entered yet"
 * rather than as a month with nothing in it.
 */
export default function BooksNote({ status }: { status: SectionEnvelope<HomeStatus> }) {
  if (!status.data) {
    return (
      <div className={styles.note} role="status">
        <span>{status.unavailableReason ?? "How far the books are posted could not be read."} The figures below are still current.</span>
        <Spacer />
        <RetryButton />
      </div>
    );
  }
  const note = booksNote(status.data);
  if (note.kind === "first-use") {
    return (
      <div className={styles.note} role="status">
        <span>
          <strong>No transactions yet.</strong> Figures appear as soon as the first bank lines, invoices or bills are posted.
        </span>
        <Spacer />
        <TextLink href="/settings/company">Finish company setup</TextLink>
      </div>
    );
  }
  if (note.kind === "behind") {
    return (
      <div className={`${styles.note} ${styles.noteWarn}`} role="status">
        <span>
          <ExclamationCircleOutlined className={styles.noteIcon} aria-hidden="true" />
          <strong>
            {note.since ? `Nothing posted since ${formatDate(note.since)}.` : `Nothing is posted on or before ${formatDate(status.data.asOf)}.`}
          </strong>
          {note.missing ? ` ${note.missing}` : ""}
        </span>
        <Spacer />
        <TextLink href="/banking">Import bank lines</TextLink>
      </div>
    );
  }
  return (
    <div className={styles.note} role="status">
      <span>
        Books posted through <strong>{formatDate(note.postedThrough)}</strong>
      </span>
      <span>
        {note.bankLinesThrough ? (
          <>
            Bank lines imported through <strong>{formatDate(note.bankLinesThrough)}</strong>
          </>
        ) : (
          "No bank lines imported yet"
        )}
      </span>
      <span>
        Last month closed: <strong>{note.lastClosed ?? "none yet"}</strong>
      </span>
    </div>
  );
}
