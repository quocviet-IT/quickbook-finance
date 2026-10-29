"use client";

import type { ReactElement, ReactNode } from "react";
import type { ColumnType } from "antd/es/table";
import { moneyDisplay } from "@/lib/domain/money-display";
import { COLUMN } from "@/lib/design/table-metrics";
import { tokenVar } from "@/lib/design/tokens";
import { formatDate } from "@/lib/format";
import { type Tone } from "@/lib/design/tone";
import StatusTag from "@/components/ui/StatusTag";

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
                ? tokenVar("money.negative")
                : sign === "positive"
                  ? tokenVar("money.positive")
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
      // The attribute stays ISO for machines; the text is the one date style.
      return <time dateTime={value}>{formatDate(value)}</time>;
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
      // Rendered through StatusTag, the one way every screen shows a status,
      // rather than by repeating its markup here. A status the screen did not
      // map still shows, as words in the shared reading (lib/domain/status-label),
      // so the row's state is never hidden and never printed as a code.
      return <StatusTag status={value} looks={spec.tones} />;
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

export interface FlexColumnSpec<T> {
  title: string;
  dataIndex?: Key<T>;
  key?: string;
  render?: ColumnType<T>["render"];
  /**
   * How narrow this column may get before the table stops giving room away.
   * Text columns take the default; a cell holding controls passes RICH_MIN.
   */
  floor?: number;
}

/**
 * A column with no width, which is the whole point of it.
 *
 * Under `table-layout: fixed` the columns that declare a width take it and the
 * rest share what is left. That is how a table ends up exactly as wide as its
 * box: every screen has one or two of these, and they absorb the remainder
 * instead of a scrollbar absorbing it.
 *
 * `minWidth` is not an Ant Design column property. It is carried here so a
 * screen's own unit test can add up its floors through `fitsBox`, and Ant
 * Design passes keys it does not know straight through.
 */
export function flexColumn<T>(spec: FlexColumnSpec<T>): ColumnType<T> & { minWidth: number } {
  return {
    title: spec.title,
    ...(spec.dataIndex ? { dataIndex: spec.dataIndex } : null),
    ...(spec.key ? { key: spec.key } : null),
    minWidth: spec.floor ?? COLUMN.TEXT_MIN,
    // No width. See the note above.
    ellipsis: { showTitle: false },
    render: spec.render
      ? // A screen's own render that returns plain words is cut like any other
        // cell, so it carries them as its title too. Without this the Bank
        // account on Exceptions and a dozen like it were cut with no way to read
        // the rest (UI review, 2026-10-19).
        (value: unknown, record: T, index: number) => {
          const out = spec.render!(value, record, index);
          return typeof out === "string" || typeof out === "number" ? <span title={String(out)}>{out}</span> : out;
        }
      : ((value: unknown) => {
        const text = typeof value === "string" ? value.trim() : "";
        if (text === "") return ABSENT;
        // `title` rather than Ant Design's Tooltip: this renders inside a cell
        // that is already truncating, and a Tooltip needs a wrapper element
        // that breaks the ellipsis — see components/ui/long-text-column.tsx,
        // which pays for the wrapper because it also sets the width.
        return <span title={text}>{text}</span>;
      }),
  };
}

/**
 * The muted line under an elastic cell's primary text.
 *
 * This is where a narrowed table puts what used to be its own column — the
 * account a line came from, the reference the bank sent, the entry it posted
 * to. One line, cut with an ellipsis, so a row never grows a third line and
 * the table keeps scrolling only downwards.
 *
 * What is cut is one hover away: plain text carries itself as the title, and a
 * caller that builds the line from pieces (a link in it) passes the words.
 */
export function secondaryLine(text: ReactNode, title?: string): ReactElement {
  const whole = title ?? (typeof text === "string" || typeof text === "number" ? String(text) : undefined);
  return (
    <span
      title={whole}
      style={{
        display: "block",
        fontSize: 12,
        // The token's variable, which dark mode redefines. The light value
        // alone read at 2.2:1 on a dark row (2.70).
        color: tokenVar("text.secondary"),
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}
