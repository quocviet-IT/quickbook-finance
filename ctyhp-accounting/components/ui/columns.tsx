"use client";

import type { ReactNode } from "react";
import type { ColumnType } from "antd/es/table";
import { moneyDisplay } from "@/lib/domain/money-display";
import { TOKENS } from "@/lib/design/tokens";
import { toneToken, type Tone } from "@/lib/design/tone";

/**
 * The column builders.
 *
 * This is where the duplication actually was. The tables in this application
 * are mostly flat — one carries a row selection, five are expandable — but
 * money is formatted by hand in 25 files and `align: "right"` is written out
 * 173 times. So the reuse belongs in the columns, not in a cleverer table.
 *
 * Every builder returns a plain Ant Design column, so a screen can still reach
 * for anything the library offers by spreading the result.
 */

/** Shown where a value is absent, so an empty cell never reads as a zero. */
const ABSENT = "—";

type Key<T> = Extract<keyof T, string>;

export interface MoneyColumnSpec<T> {
  title: string;
  dataIndex: Key<T>;
  /**
   * Where the currency comes from: the name of a field on the row, or a fixed
   * code for a screen that only ever shows one. Per-row is the default because
   * the ledger is multi-currency and a column that assumed otherwise would be
   * wrong wherever it mattered most.
   */
  currency: Key<T> | { fixed: string };
  /**
   * Where the decimal places come from, declared the same way as the currency
   * and for the same reason: they are a property of the currency, not of the
   * column. A column carrying USD and JPY rows needs two and zero on different
   * rows, so pinning one number per column would be wrong on the rows that are
   * not the majority. Required — `formatMoney` has no default either, and a
   * silent fallback to 2 renders ₫500 as ₫5.00 with no error anywhere.
   */
  decimals: Key<T> | { fixed: number };
  width?: number;
}

export function moneyColumn<T>(spec: MoneyColumnSpec<T>): ColumnType<T> {
  return {
    title: spec.title,
    dataIndex: spec.dataIndex,
    width: spec.width,
    align: "right",
    render: (value: number, record: T) => {
      const code =
        typeof spec.currency === "object"
          ? spec.currency.fixed
          : String(record[spec.currency] ?? "USD");
      const places =
        typeof spec.decimals === "object"
          ? spec.decimals.fixed
          : Number(record[spec.decimals] ?? 2);
      const { text, ariaLabel, sign } = moneyDisplay(value ?? 0, code, places);
      return (
        <span
          aria-label={ariaLabel}
          style={{
            // Tabular figures so digits occupy the same width down the column.
            // Proportional figures make a column of money ragged, which is the
            // one thing a column of money must not be.
            fontVariantNumeric: "tabular-nums",
            color:
              sign === "negative"
                ? TOKENS.money.negative
                : sign === "positive"
                  ? TOKENS.money.positive
                  : undefined,
          }}
        >
          {text}
        </span>
      );
    },
  };
}

export interface DateColumnSpec<T> {
  title: string;
  dataIndex: Key<T>;
  width?: number;
}

export function dateColumn<T>(spec: DateColumnSpec<T>): ColumnType<T> {
  return {
    title: spec.title,
    dataIndex: spec.dataIndex,
    width: spec.width,
    render: (value: string | null) => {
      if (!value) return ABSENT;
      // The text is deliberately what these screens already showed. This batch
      // buys the semantic element and one code path; changing how every date
      // in the application reads is a visible change nobody asked for.
      return <time dateTime={value}>{value}</time>;
    },
  };
}

export interface StatusColumnSpec<T> {
  title: string;
  dataIndex: Key<T>;
  /**
   * The screen's own statuses, each mapped to a tone and the word a reader
   * should see. Declared per screen because this application has 23 status
   * types across different domains, and one enum could never hold them.
   */
  tones: Record<string, { tone: Tone; label: string }>;
  width?: number;
}

export function statusColumn<T>(spec: StatusColumnSpec<T>): ColumnType<T> {
  return {
    title: spec.title,
    dataIndex: spec.dataIndex,
    width: spec.width,
    render: (value: string) => {
      const mapped = spec.tones[value];
      // An unmapped status shows its raw value in the muted tone. Rendering
      // nothing would hide the row's state; this shows the state and the gap
      // in the screen's declaration at the same time.
      const { color, icon } = toneToken(mapped?.tone ?? "muted");
      return (
        <span style={{ color, display: "inline-flex", alignItems: "center", gap: 6 }}>
          {icon}
          {mapped?.label ?? value}
        </span>
      );
    },
  };
}

export interface TextColumnSpec<T> {
  title: string;
  dataIndex: Key<T>;
  width?: number;
  ellipsis?: boolean;
}

export function textColumn<T>(spec: TextColumnSpec<T>): ColumnType<T> {
  return {
    title: spec.title,
    dataIndex: spec.dataIndex,
    width: spec.width,
    ellipsis: spec.ellipsis,
    render: (value: string | null) => (value?.trim() ? value : ABSENT),
  };
}

export interface ActionsColumnSpec<T> {
  actions: (record: T) => ReactNode[];
  width?: number;
}

export function actionsColumn<T>(spec: ActionsColumnSpec<T>): ColumnType<T> {
  return {
    // No heading: a column of buttons has no name worth a column of width, and
    // "Actions" read out on every row is noise.
    title: "",
    key: "actions",
    align: "right",
    width: spec.width,
    render: (_: unknown, record: T) => (
      <span style={{ display: "inline-flex", gap: 4, justifyContent: "flex-end" }}>
        {spec.actions(record)}
      </span>
    ),
  };
}
