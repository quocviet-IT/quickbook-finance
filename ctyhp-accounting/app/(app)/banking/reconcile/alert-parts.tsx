"use client";
import type { ReactNode } from "react";
import { WarningOutlined } from "@ant-design/icons";
import type { Segment } from "@/lib/domain/statement-alerts";
import styles from "./statement-alerts.module.css";

/**
 * A sentence from the copy builders, with its payee and figures set in bold
 * and the word Balance in italics. The builders hand over the runs already
 * cut, so nothing here parses text.
 */
export function Segments({ segments }: { segments: readonly Segment[] }) {
  return (
    <>
      {segments.map((s, i) => {
        let node: ReactNode = s.text;
        if (s.italic) node = <em>{node}</em>;
        if (s.bold) node = <strong>{node}</strong>;
        return <span key={i}>{node}</span>;
      })}
    </>
  );
}

/**
 * Opens an entry in the side sheet, so the card and its workings stay where
 * they are. The sheet's own footer opens the entry in Journal.
 */
export function EntryLink({
  entryNumber,
  onOpen,
  children,
}: {
  entryNumber: string;
  onOpen: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={styles.entryLink}
      onClick={onOpen}
      title={entryNumber ? `Open entry ${entryNumber}` : "Open this entry"}
    >
      {children}
    </button>
  );
}

/** The warning mark in the card's left column. */
export function AlertIcon() {
  return (
    <span className={styles.icon} aria-hidden="true">
      <WarningOutlined />
    </span>
  );
}
