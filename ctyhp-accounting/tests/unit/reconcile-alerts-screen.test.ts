import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COLUMN, TABLE_BOX_AT_1280, fitsBox } from "@/lib/design/table-metrics";
import {
  ALERT_CARD,
  ALERT_TABLE_BOX,
  OUTSTANDING_ELASTIC_FLOOR,
  OUTSTANDING_MIN_WIDTH,
  OUTSTANDING_WIDTH,
  WORKINGS_ELASTIC_FLOOR,
  WORKINGS_MIN_WIDTH,
  WORKINGS_WIDTH,
} from "@/app/(app)/banking/reconcile/alert-columns";
import {
  BLOCKERS_HEADING,
  CHECKS_FAILED,
  REASON_MAX,
  REASON_REQUIRED,
  REASON_TOO_LONG,
  REMOVAL_IDLE,
  canOfferRemoval,
  chosenBankId,
  codedToText,
  entryHref,
  reasonProblem,
  removalLabel,
  removalStep,
  withoutGroup,
  type RemovalEvent,
  type RemovalState,
} from "@/lib/domain/reconcile-alerts-screen";
import { ghostCard, type GhostGroup } from "@/lib/domain/statement-alerts";

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const fmt = { money: (minor: number) => `${minor < 0 ? "-" : ""}$${(Math.abs(minor) / 100).toFixed(2)}` };

const group = (over: Partial<GhostGroup> = {}): GhostGroup => ({
  payee: "Sample Payroll Co",
  rows: [],
  agree: 3,
  of: 4,
  offsetMinor: 0,
  runs: 1,
  totalMinor: -90_000,
  entryIds: ["e1", "e2", "e3"],
  ...over,
});

/** Runs a list of events from idle. */
const run = (events: RemovalEvent[], from: RemovalState = REMOVAL_IDLE) => events.reduce(removalStep, from);

describe("the cards' tables fit", () => {
  it("measure their box from the page's box, less the card around them", () => {
    expect(ALERT_TABLE_BOX).toBe(
      TABLE_BOX_AT_1280 - ALERT_CARD.border - ALERT_CARD.accent - 2 * ALERT_CARD.paddingX - ALERT_CARD.gutter,
    );
    expect(ALERT_TABLE_BOX).toBeLessThan(TABLE_BOX_AT_1280);
  });

  it("fits the workings at a 1280px window, with Coded to at the text floor", () => {
    expect(WORKINGS_ELASTIC_FLOOR).toBe(COLUMN.TEXT_MIN);
    expect(fitsBox(sum(Object.values(WORKINGS_WIDTH)), WORKINGS_ELASTIC_FLOOR, ALERT_TABLE_BOX)).toBe(true);
  });

  it("fits the payments not yet on a statement, with Name and Coded to at the text floor", () => {
    expect(OUTSTANDING_ELASTIC_FLOOR).toBe(2 * COLUMN.TEXT_MIN);
    expect(fitsBox(sum(Object.values(OUTSTANDING_WIDTH)), OUTSTANDING_ELASTIC_FLOOR, ALERT_TABLE_BOX)).toBe(true);
  });

  it("is measured with the figures the stylesheet draws with", () => {
    // The sums above are only true if the card really is this wide around its
    // tables. Change the padding in one place and not the other, and this fails.
    const css = readFileSync(
      join(process.cwd(), "app", "(app)", "banking", "reconcile", "statement-alerts.module.css"),
      "utf8",
    );
    const card = css.slice(css.indexOf(".card {"), css.indexOf("}", css.indexOf(".card {")));
    expect(card).toContain(`padding: 18px ${ALERT_CARD.paddingX}px;`);
    expect(card).toContain(`border-left: ${ALERT_CARD.accent}px solid`);
    expect(card).toContain("grid-template-columns: 32px minmax(0, 1fr);");
    expect(card).toContain("column-gap: 16px;");
    expect(ALERT_CARD.gutter).toBe(32 + 16);
  });

  it("keeps every column readable on a phone: declared widths plus floors, scrolled inside the card", () => {
    expect(WORKINGS_MIN_WIDTH).toBe(sum(Object.values(WORKINGS_WIDTH)) + WORKINGS_ELASTIC_FLOOR);
    expect(OUTSTANDING_MIN_WIDTH).toBe(sum(Object.values(OUTSTANDING_WIDTH)) + OUTSTANDING_ELASTIC_FLOOR);
    const css = readFileSync(
      join(process.cwd(), "app", "(app)", "banking", "reconcile", "statement-alerts.module.css"),
      "utf8",
    );
    const phone = css.slice(css.indexOf("@media (max-width: 640px)"));
    const minWidthOf = (selector: string) => {
      const at = phone.indexOf(selector);
      expect(at, selector).toBeGreaterThan(-1);
      return phone.slice(at, phone.indexOf("}", at));
    };
    expect(minWidthOf(".workings :global(.ant-table-content) > table")).toContain(`min-width: ${WORKINGS_MIN_WIDTH}px;`);
    expect(minWidthOf(".outstanding :global(.ant-table-content) > table")).toContain(`min-width: ${OUTSTANDING_MIN_WIDTH}px;`);
  });
});

describe("chosenBankId", () => {
  const banks = [{ id: "b1" }, { id: "b2" }];

  it("takes the account in the address when it is one of the company's", () => {
    expect(chosenBankId(banks, "b2")).toBe("b2");
  });

  it("falls back to the first account, quietly, for an unknown id or none", () => {
    expect(chosenBankId(banks, "not-ours")).toBe("b1");
    expect(chosenBankId(banks, null)).toBe("b1");
    expect(chosenBankId(banks, undefined)).toBe("b1");
    expect(chosenBankId(banks, "")).toBe("b1");
  });

  it("has nothing to choose without bank accounts", () => {
    expect(chosenBankId([], "b1")).toBeUndefined();
  });
});

describe("reasonProblem", () => {
  it("asks for a reason, with the server's words", () => {
    expect(reasonProblem("")).toBe(REASON_REQUIRED);
    expect(reasonProblem("   ")).toBe(REASON_REQUIRED);
    expect(REASON_REQUIRED).toBe("A reason is required");
  });

  it("takes up to the server's limit, counted after trimming", () => {
    expect(REASON_MAX).toBe(300);
    expect(reasonProblem("x".repeat(300))).toBeNull();
    expect(reasonProblem(`  ${"x".repeat(300)}  `)).toBeNull();
    expect(reasonProblem("x".repeat(301))).toBe(REASON_TOO_LONG);
  });

  it("accepts an ordinary reason", () => {
    expect(reasonProblem("Balance column read as amounts")).toBeNull();
  });
});

describe("removalStep", () => {
  it("turns the first click into a request for a reason", () => {
    expect(run([{ type: "ask" }])).toEqual({ step: "confirm", reason: "", problem: null, error: null });
  });

  it("will not send without a reason, and says why", () => {
    const s = run([{ type: "ask" }, { type: "type", reason: "  " }, { type: "confirm" }]);
    expect(s).toEqual({ step: "confirm", reason: "  ", problem: REASON_REQUIRED, error: null });
  });

  it("clears the complaint as soon as a reason is typed", () => {
    const s = run([{ type: "ask" }, { type: "confirm" }, { type: "type", reason: "B" }]);
    expect(s).toMatchObject({ step: "confirm", reason: "B", problem: null });
  });

  it("sends on the second click, with the reason trimmed", () => {
    const s = run([{ type: "ask" }, { type: "type", reason: "  Balance read as amounts " }, { type: "confirm" }]);
    expect(s).toEqual({ step: "removing", reason: "Balance read as amounts" });
  });

  it("ignores another click while the request is out, so nothing is sent twice", () => {
    const sending = run([{ type: "ask" }, { type: "type", reason: "r" }, { type: "confirm" }]);
    expect(removalStep(sending, { type: "confirm" })).toBe(sending);
    expect(removalStep(sending, { type: "ask" })).toBe(sending);
    expect(removalStep(sending, { type: "cancel" })).toBe(sending);
    expect(removalStep(sending, { type: "type", reason: "other" })).toBe(sending);
  });

  it("shows a refusal and keeps the reason, so trying again needs no retyping", () => {
    const s = run([
      { type: "ask" },
      { type: "type", reason: "r" },
      { type: "confirm" },
      { type: "failed", error: "1 of these entries cannot be removed: JE-1 (ticked)" },
    ]);
    expect(s).toEqual({
      step: "confirm",
      reason: "r",
      problem: null,
      error: "1 of these entries cannot be removed: JE-1 (ticked)",
    });
    // A second try drops the old refusal.
    expect(removalStep(s, { type: "confirm" })).toEqual({ step: "removing", reason: "r" });
  });

  it("goes back to the plain button when done, or on Cancel", () => {
    expect(run([{ type: "ask" }, { type: "type", reason: "r" }, { type: "confirm" }, { type: "done" }])).toEqual(
      REMOVAL_IDLE,
    );
    expect(run([{ type: "ask" }, { type: "type", reason: "r" }, { type: "cancel" }])).toEqual(REMOVAL_IDLE);
  });

  it("ignores events the state does not expect", () => {
    expect(removalStep(REMOVAL_IDLE, { type: "confirm" })).toBe(REMOVAL_IDLE);
    expect(removalStep(REMOVAL_IDLE, { type: "done" })).toBe(REMOVAL_IDLE);
    expect(removalStep(REMOVAL_IDLE, { type: "failed", error: "x" })).toBe(REMOVAL_IDLE);
    expect(removalStep(REMOVAL_IDLE, { type: "type", reason: "x" })).toBe(REMOVAL_IDLE);
    const asking = run([{ type: "ask" }]);
    expect(removalStep(asking, { type: "ask" })).toBe(asking);
    expect(removalStep(asking, { type: "done" })).toBe(asking);
  });
});

describe("the removal's words", () => {
  const card = ghostCard(group(), fmt);

  it("reads Remove, then Confirm, with the number of entries", () => {
    expect(removalLabel(REMOVAL_IDLE, card)).toBe("Remove these 3 entries");
    expect(removalLabel(run([{ type: "ask" }]), card)).toBe("Confirm — remove all 3");
    expect(removalLabel({ step: "removing", reason: "r" }, card)).toBe("Confirm — remove all 3");
  });

  it("toasts the number the server removed", () => {
    expect(card.removedMessage(3)).toBe("3 entries removed. They were balances, not payments.");
  });

  it("names the quiet line and the blockers heading as the screen shows them", () => {
    expect(CHECKS_FAILED).toBe("Checks could not be run");
    expect(BLOCKERS_HEADING).toBe("These cannot be removed here:");
  });
});

describe("canOfferRemoval", () => {
  it("offers the button only to people who can write, and only when nothing stands in the way", () => {
    expect(canOfferRemoval(true, [])).toBe(true);
    expect(canOfferRemoval(false, [])).toBe(false);
    expect(canOfferRemoval(true, [{ entryId: "e1", entryNumber: "JE-1", reason: "ticked" }])).toBe(false);
  });
});

describe("withoutGroup", () => {
  it("drops the removed payee as the server matches it, ignoring case and spaces", () => {
    const ghosts = [group({ payee: "Sample Payroll Co" }), group({ payee: "Other Payee" })];
    expect(withoutGroup(ghosts, "  sample payroll co ").map((g) => g.payee)).toEqual(["Other Payee"]);
  });

  it("matches a blank payee to (no name)", () => {
    expect(withoutGroup([group({ payee: "(no name)" })], "")).toEqual([]);
  });
});

describe("entry links and coded-to", () => {
  it("opens an entry in Journal", () => {
    expect(entryHref("abc-123")).toBe("/journal?entry=abc-123");
  });

  it("lists the other accounts, or a dash when there are none", () => {
    expect(codedToText(["6000 Payroll", "2100 Payroll Liabilities"])).toBe("6000 Payroll, 2100 Payroll Liabilities");
    expect(codedToText([])).toBe("—");
  });
});

describe("the screen's sources", () => {
  const dir = join(process.cwd(), "app", "(app)", "banking", "reconcile");
  const read = (file: string) => readFileSync(join(dir, file), "utf8");

  it("keeps the chosen account in the address without a server request", () => {
    const list = read("ReconcileListClient.tsx");
    expect(list).toContain('useSearchParams().get("account")');
    expect(list).toContain("window.history.replaceState(null, \"\", reconcileHref(id))");
  });

  it("wraps the outstanding payments in the frame the phone rule holds open", () => {
    expect(read("BelowZeroCard.tsx")).toContain("<div className={styles.outstanding}>");
    expect(read("BalanceGroupCard.tsx")).toContain("className={styles.workings}");
  });

  it("draws the cards' tables through DataTable, never Ant Design's Table", () => {
    for (const file of ["BalanceGroupCard.tsx", "BelowZeroCard.tsx", "StatementAlertsPanel.tsx"]) {
      const source = read(file);
      expect(source, file).not.toMatch(/<Table(?!\w)/);
      expect(source, file).not.toMatch(/scroll=\{\{[^}]*\bx\s*:/);
    }
  });
});
