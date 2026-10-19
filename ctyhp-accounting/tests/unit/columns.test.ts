import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import {
  actionsColumn,
  dateColumn,
  flexColumn,
  moneyColumn,
  secondaryLine,
  statusColumn,
  textColumn,
} from "@/components/ui/columns";
import { COLUMN } from "@/lib/design/table-metrics";
import { TOKENS } from "@/lib/design/tokens";
import { type Tone } from "@/lib/design/tone";
import StatusTag from "@/components/ui/StatusTag";

/**
 * The props these cells actually carry. Named because React 19 narrows
 * `isValidElement` to `props: unknown`, so reading `.props.style` after the
 * guard needs a type the compiler can carry through it.
 */
interface CellProps {
  style?: {
    color?: string;
    fontVariantNumeric?: string;
    fontSize?: number;
    whiteSpace?: string;
    textOverflow?: string;
  };
  children?: ReactNode;
  "aria-label"?: string;
  dateTime?: string;
  tone?: Tone;
  [key: string]: unknown;
}

function asElement(node: unknown, what: string): ReactElement<CellProps> {
  // The cast target is read off `isValidElement` itself rather than written out
  // as `{} | null | undefined`. Same type, but the literal form trips this
  // repo's `no-empty-object-type` lint rule, and silencing a rule to restate a
  // type the compiler can already name is the worse of the two.
  if (!isValidElement<CellProps>(node as Parameters<typeof isValidElement>[0])) {
    throw new Error(`${what} rendered no element`);
  }
  return node as ReactElement<CellProps>;
}

/** A StatusTag's icon, and its word, which sits in a span of its own so a narrow column shortens the word, not the border. */
function tagParts(tag: ReactElement<CellProps>): [ReactNode, string] {
  const [icon, label] = tag.props.children as [ReactNode, ReactElement<CellProps>];
  return [icon, label.props.children as string];
}

interface Row {
  total_minor: number;
  currency_code: string;
  currency_decimals: number;
  due_date: string | null;
  status: "paid" | "void";
  memo: string | null;
}

const row: Row = {
  total_minor: -123456,
  currency_code: "USD",
  currency_decimals: 2,
  due_date: "2026-08-13",
  status: "void",
  memo: null,
};

/** The per-row declaration, written once because seven tests use it. */
const perRow = { title: "Total", dataIndex: "total_minor", currency: "currency_code", decimals: "currency_decimals" } as const;

describe("moneyColumn", () => {
  it("aligns right and uses tabular figures, so columns of money line up", () => {
    const column = moneyColumn<Row>({ ...perRow });
    expect(column.align).toBe("right");
    const cell = asElement(column.render!(row.total_minor, row, 0), "moneyColumn");
    expect(cell.props.style?.fontVariantNumeric).toBe("tabular-nums");
  });

  it("takes the currency AND its decimal places off the row", () => {
    // Both come from the row because both belong to the currency. A column
    // holding USD and JPY needs two places on one row and none on the next;
    // one number pinned to the column would be wrong on whichever rows are not
    // the majority, and wrong quietly.
    const column = moneyColumn<Row>({ ...perRow });
    const cell = asElement(
      column.render!(123456, { ...row, currency_code: "JPY", currency_decimals: 0 }, 0),
      "moneyColumn",
    );
    expect(cell.props.children).toBe("¥123,456");
    expect(cell.props.style?.color).toBe(TOKENS.money.positive);
  });

  it("accepts a fixed currency and fixed places where the screen has only one", () => {
    const column = moneyColumn<Row>({
      title: "Total",
      dataIndex: "total_minor",
      currency: { fixed: "USD" },
      decimals: { fixed: 2 },
    });
    const cell = asElement(column.render!(123456, row, 0), "moneyColumn");
    expect(cell.props.children).toBe("$1,234.56");
  });

  it("colours a negative from the money token, and says so out loud too", () => {
    // The minus sign is the signal that survives a printout and a colour-blind
    // reader; the colour and the spoken label reinforce it.
    const column = moneyColumn<Row>({ ...perRow });
    const cell = asElement(column.render!(row.total_minor, row, 0), "moneyColumn");
    expect(cell.props.style?.color).toBe(TOKENS.money.negative);
    expect(cell.props["aria-label"]).toBe("negative $1,234.56");
    expect(cell.props.children).toContain("-");
  });

  it("leaves zero uncoloured, because nothing is being signalled", () => {
    const column = moneyColumn<Row>({ ...perRow });
    const cell = asElement(column.render!(0, row, 0), "moneyColumn");
    expect(cell.props.style?.color).toBeUndefined();
  });

  it("shows an em dash for a missing amount, because absent is not zero", () => {
    // The ledger tells "no amount recorded" and "zero" apart, so a screen
    // reading from it must too. A rendered $0.00 here would state a fact the
    // row never carried. The test above pins the other half: a real zero is
    // still money and still renders.
    const column = moneyColumn<Row>({ ...perRow });
    expect(column.render!(null, row, 0)).toBe("—");
  });

  it("shows an em dash when the row carries no currency, rather than assuming dollars", () => {
    // An assumed "USD" puts a dollar sign on a dong amount, and a dollar sign
    // reads as a fact rather than as a gap in the data.
    const column = moneyColumn<Row>({ ...perRow });
    const broken = { ...row, currency_code: null as unknown as string };
    expect(column.render!(123456, broken, 0)).toBe("—");
  });

  it("shows an em dash when the row carries no decimal places, rather than assuming two", () => {
    // The assumption this replaces turned ₫500 into ₫5.00 — off by a hundred,
    // with invented cents, and nothing logged anywhere. The JPY test above is
    // the reason the guard asks whether the value is null and never whether it
    // is falsy: zero places is a real declaration on a real currency.
    const column = moneyColumn<Row>({ ...perRow });
    const broken = { ...row, currency_decimals: null as unknown as number };
    expect(column.render!(123456, broken, 0)).toBe("—");
  });
});

describe("dateColumn", () => {
  it("marks the date up as a date: ISO for machines, the one date style for readers", () => {
    const column = dateColumn<Row>({ title: "Due", dataIndex: "due_date" });
    const cell = asElement(column.render!(row.due_date, row, 0), "dateColumn");
    expect(cell.type).toBe("time");
    expect(cell.props.dateTime).toBe("2026-08-13");
    expect(cell.props.children).toBe("08/13/2026");
  });

  it("shows an em dash for no date, rather than an empty cell", () => {
    const column = dateColumn<Row>({ title: "Due", dataIndex: "due_date" });
    expect(column.render!(null, row, 0)).toBe("—");
  });
});

describe("statusColumn", () => {
  it("renders the screen's own word in the tone the screen chose, through the shared StatusTag", () => {
    const tones = { paid: { tone: "positive" as const, label: "Paid" }, void: { tone: "muted" as const, label: "Void" } };
    const column = statusColumn<Row>({ title: "Status", dataIndex: "status", tones });
    const cell = asElement(column.render!(row.status, row, 0), "statusColumn");
    // The column's own job is choosing the tone and the wording; the tag owns
    // how that looks. Asserting the element IS the tag is what keeps the two
    // from drifting into separate copies of the same markup.
    expect(cell.type).toBe(StatusTag);
    expect(cell.props.status).toBe("void");
    expect(cell.props.looks).toBe(tones);

    // And once through the tag, the chosen tone reaches the class that colours
    // it, with an icon beside the word.
    const rendered = asElement(StatusTag(cell.props as unknown as Parameters<typeof StatusTag>[0]), "StatusTag");
    expect(rendered.props.className).toBe("status-tag status-tag--muted");
    const [icon, label] = tagParts(rendered);
    expect(isValidElement(icon)).toBe(true);
    expect(label).toBe("Void");
  });

  it("shows a status the screen did not map as words, never as its code", () => {
    // A status nobody mapped is a gap in the screen's declaration. Rendering
    // nothing would hide a row's state; rendering the code would print
    // "not_requested". It reads in the shared vocabulary instead.
    const column = statusColumn<Row>({
      title: "Status",
      dataIndex: "status",
      tones: { paid: { tone: "positive", label: "Paid" } },
    });
    for (const [code, word] of [["void", "Void"], ["not_requested", "Not requested"], ["some_new_state", "Some new state"]]) {
      const cell = asElement(column.render!(code as Row["status"], row, 0), "statusColumn");
      const rendered = asElement(StatusTag(cell.props as unknown as Parameters<typeof StatusTag>[0]), "StatusTag");
      expect(tagParts(rendered)[1]).toBe(word);
    }
  });

  it("shows an em dash for a row with no status, rather than a wordless icon", () => {
    const column = statusColumn<Row>({
      title: "Status",
      dataIndex: "status",
      tones: { paid: { tone: "positive", label: "Paid" } },
    });
    expect(column.render!(null, row, 0)).toBe("—");
    expect(column.render!("", row, 0)).toBe("—");
  });
});

describe("textColumn", () => {
  it("shows an em dash for an empty value", () => {
    const column = textColumn<Row>({ title: "Memo", dataIndex: "memo" });
    expect(column.render!(null, row, 0)).toBe("—");
    expect(column.render!("  ", row, 0)).toBe("—");
    expect(column.render!("Paid in full", row, 0)).toBe("Paid in full");
  });
});

describe("actionsColumn", () => {
  it("keeps actions out of the sort order and off the right edge", () => {
    const column = actionsColumn<Row>({ actions: () => [] });
    expect(column.align).toBe("right");
    expect(column.sorter).toBeUndefined();
    expect(column.title).toBe("");
  });

  it("renders whatever the screen supplies for that row", () => {
    const column = actionsColumn<Row>({ actions: (record) => [String(record.status)] });
    const cell = asElement(column.render!(undefined, row, 0), "actionsColumn");
    expect(cell.props.children).toEqual(["void"]);
  });
});

describe("flexColumn", () => {
  it("carries no width at all, which is what makes it elastic", () => {
    const column = flexColumn<Row>({ title: "Memo", dataIndex: "memo" });
    expect(column.width).toBeUndefined();
    // A fixed layout needs the cut declared on the column, or a long memo
    // widens the table instead of being truncated.
    expect(column.ellipsis).toEqual({ showTitle: false });
  });

  it("keeps its floor where the screen can read it", () => {
    expect(flexColumn<Row>({ title: "Memo", dataIndex: "memo" }).minWidth).toBe(COLUMN.TEXT_MIN);
    expect(flexColumn<Row>({ title: "Match", key: "match", floor: COLUMN.RICH_MIN }).minWidth).toBe(
      COLUMN.RICH_MIN,
    );
  });

  it("shows the whole value on hover, and an em dash when there is none", () => {
    const column = flexColumn<Row>({ title: "Memo", dataIndex: "memo" });
    const cell = asElement(column.render!("a wire description", row, 0), "flex cell");
    expect(cell.props.title).toBe("a wire description");
    expect(column.render!(null, row, 0)).toBe("—");
    expect(column.render!("   ", row, 0)).toBe("—");
  });

  it("gives a screen's own renderer's words a title, since the cell cuts them", () => {
    // It used to hand the string back untouched, so a renderer returning plain
    // words (the Bank account on Exceptions) was cut with no way to read the
    // rest (UI review, 2026-10-19).
    const column = flexColumn<Row>({
      title: "Description",
      key: "description",
      render: () => "whatever the screen builds",
    });
    const cell = asElement(column.render!(null, row, 0), "own renderer");
    expect(cell.props.title).toBe("whatever the screen builds");
    expect(cell.props.children).toBe("whatever the screen builds");
  });

  it("hands back an element the screen built as it is", () => {
    const built = secondaryLine("built by the screen");
    const column = flexColumn<Row>({ title: "Vendor", key: "vendor", render: () => built });
    expect(column.render!(null, row, 0)).toBe(built);
  });
});

describe("secondaryLine", () => {
  it("is one muted line that cuts rather than wraps", () => {
    const line = asElement(secondaryLine("Bank of America · 121"), "secondary line");
    expect(line.props.style?.fontSize).toBe(12);
    expect(line.props.style?.whiteSpace).toBe("nowrap");
    expect(line.props.style?.textOverflow).toBe("ellipsis");
    // The muted token, never a hex value written here.
    expect(line.props.style?.color).toBe(TOKENS.text.secondary);
  });

  it("is whole on hover: plain words carry themselves, a built line carries the words it is given", () => {
    expect(asElement(secondaryLine("Bank of America · 121"), "plain").props.title).toBe("Bank of America · 121");
    expect(asElement(secondaryLine(42), "number").props.title).toBe("42");
    const built = asElement(secondaryLine(asElement(secondaryLine("JE-000004"), "inner"), "Ref 7 · JE-000004"), "built");
    expect(built.props.title).toBe("Ref 7 · JE-000004");
  });
});
