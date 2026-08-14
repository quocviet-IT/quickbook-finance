"use client";

import type { ReactNode } from "react";
import type { ColumnType } from "antd/es/table";
import { moneyDisplay } from "@/lib/domain/money-display";
import { TOKENS } from "@/lib/design/tokens";
import { ToneBadge, type Tone } from "@/lib/design/tone";

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
    render: (value: unknown, record: T) => {
      // `value` is `unknown` because that is the truth at this boundary: Ant
      // Design hands the render whatever sits at `dataIndex`, and nothing
      // upstream proves it is a number.
      //
      // A cell shows money only when the row carries all three facts it needs.
      // Any one of them missing means the row is broken, and the honest cell is
      // the em dash rather than a guess. An assumed currency puts a dollar sign
      // on a dong amount; assumed places turn ₫500 into ₫5.00, off by a hundred
      // with invented cents and nothing logged; and a missing amount is not a
      // zero — the ledger tells those two apart, so the screen must as well.
      //
      // Every check asks whether the value is absent, never whether it is
      // falsy: zero places is how JPY and VND are declared, and a zero amount
      // is a real balance.
      const code: unknown =
        typeof spec.currency === "object" ? spec.currency.fixed : record[spec.currency];
      const places: unknown =
        typeof spec.decimals === "object" ? spec.decimals.fixed : record[spec.decimals];
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        typeof code !== "string" ||
        code.trim() === "" ||
        typeof places !== "number" ||
        !Number.isInteger(places) ||
        places < 0
      ) {
        return ABSENT;
      }
      const { text, ariaLabel, sign } = moneyDisplay(value, code, places);
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
    render: (value: string | null) => {
      // A row that carries no status has nothing to say, and the badge would
      // say it with a grey icon and no word — colour and shape alone, which is
      // what this tone vocabulary exists to prevent. The em dash is the same
      // answer the date and text builders give.
      if (value == null || value === "") return ABSENT;
      const mapped = spec.tones[value];
      // An unmapped status shows its raw value in the muted tone. Rendering
      // nothing would hide the row's state; this shows the state and the gap
      // in the screen's declaration at the same time.
      //
      // Rendered through ToneBadge rather than by repeating its markup here.
      // The two would be identical spans, and two copies of one appearance is
      // exactly the drift this kit exists to end — a change to the badge that
      // did not reach the column would leave a table looking unlike every
      // other place the same status is shown.
      return <ToneBadge tone={mapped?.tone ?? "muted"}>{mapped?.label ?? value}</ToneBadge>;
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
