import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { actionsColumn, dateColumn, moneyColumn, statusColumn, textColumn } from "@/components/ui/columns";
import { TOKENS } from "@/lib/design/tokens";
import { ToneBadge, toneToken, type Tone } from "@/lib/design/tone";

/** The props these cells actually carry. See constraint 2 above. */
interface CellProps {
  style?: { color?: string; fontVariantNumeric?: string };
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

/** `children` is `ReactNode`, so an icon-plus-label pair needs naming to read. */
function pair(cell: ReactElement<CellProps>): [ReactNode, string] {
  return cell.props.children as [ReactNode, string];
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
  it("marks the date up as a date, keeping the text it already showed", () => {
    // The displayed string is unchanged on purpose: this batch adds semantics
    // and one code path, not a new date format across every screen.
    const column = dateColumn<Row>({ title: "Due", dataIndex: "due_date" });
    const cell = asElement(column.render!(row.due_date, row, 0), "dateColumn");
    expect(cell.type).toBe("time");
    expect(cell.props.dateTime).toBe("2026-08-13");
    expect(cell.props.children).toBe("2026-08-13");
  });

  it("shows an em dash for no date, rather than an empty cell", () => {
    const column = dateColumn<Row>({ title: "Due", dataIndex: "due_date" });
    expect(column.render!(null, row, 0)).toBe("—");
  });
});

describe("statusColumn", () => {
  it("renders the screen's own word in the tone the screen chose", () => {
    const column = statusColumn<Row>({
      title: "Status",
      dataIndex: "status",
      tones: { paid: { tone: "positive", label: "Paid" }, void: { tone: "muted", label: "Void" } },
    });
    const cell = asElement(column.render!(row.status, row, 0), "statusColumn");
    // The column's own job is choosing the tone and the wording; the badge owns
    // how that looks. Asserting the element IS the badge is what keeps the two
    // from drifting into separate copies of the same markup.
    expect(cell.type).toBe(ToneBadge);
    expect(cell.props.tone).toBe("muted");
    expect(cell.props.children).toBe("Void");

    // And once through the badge, the chosen tone really does reach the colour —
    // so the composition is proven, not just the wiring.
    const rendered = asElement(
      ToneBadge(cell.props as { tone: Tone; children: string }),
      "ToneBadge",
    );
    expect(rendered.props.style?.color).toBe(toneToken("muted").color);
    const [icon, label] = pair(rendered);
    expect(isValidElement(icon)).toBe(true);
    expect(label).toBe("Void");
  });

  it("shows an unmapped status as its raw value rather than swallowing it", () => {
    // A status nobody mapped is a gap in the screen's declaration. Rendering
    // nothing would hide a row's state; rendering the raw value shows both the
    // state and the gap.
    const column = statusColumn<Row>({
      title: "Status",
      dataIndex: "status",
      tones: { paid: { tone: "positive", label: "Paid" } },
    });
    const cell = asElement(column.render!("void" as Row["status"], row, 0), "statusColumn");
    expect(cell.props.tone).toBe("muted");
    expect(cell.props.children).toBe("void");
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
