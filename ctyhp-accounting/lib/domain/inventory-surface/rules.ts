import type { DerivedWorkItem, SurfaceControl } from "@/lib/domain/work-surface/types";
import type { KindFilter, SurfaceNouns } from "@/lib/domain/work-surface/lifecycle";

/**
 * What Inventory checks, and what it hands somebody to do.
 *
 * The job the design document gives this screen is *availability, negative
 * stock, and subledger tie-out*. Two of those are about being able to sell
 * things; the third is about whether the number you would sell against is true.
 *
 * **This is the one surface with a genuinely blocking check.** Stock that does
 * not tie to its control account is not a queue of work — it is a statement that
 * the valuation on the balance sheet and the quantities on this screen disagree,
 * and nothing on either can be relied on until somebody finds out why. Every
 * other surface's checks summarise work; this one has a check that says the
 * figures are wrong.
 */

function money(minor: number): string {
  return (Math.abs(minor) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export const INVENTORY_NOUNS: SurfaceNouns = {
  blocking: "a reliable valuation",
  records: "the stock movements",
};

export const INVENTORY_KIND_FILTERS: readonly KindFilter[] = [
  { id: "stock", label: "Stock", kinds: ["negative-stock"] },
  { id: "valuation", label: "Valuation", kinds: ["control-failure"] },
  { id: "assets", label: "Assets", kinds: ["depreciation-due"] },
];

// --- Controls --------------------------------------------------------------

/**
 * No item is holding a negative quantity.
 *
 * Negative stock means something was sold that the system did not think existed
 * — so its cost was taken at a rate nothing supports, and the margin on that
 * sale is a guess. Not blocking, because the fix is per item and each one is
 * work in its own right.
 */
export function negativeStockControl(input: {
  /** Null when the valuation could not be read. */
  itemCount: number | null;
  negativeCount: number;
  negativeNames: readonly string[];
  evaluatedAt: string;
}): SurfaceControl {
  const base = {
    key: "negative-stock",
    title: "No item is holding negative stock",
    passCondition: "Every stocked item has a quantity on hand of zero or more.",
    evaluatedAt: input.evaluatedAt,
    href: "/reports/inventory-valuation",
    blocking: false,
  };
  if (input.itemCount === null) {
    return {
      ...base,
      status: "unavailable" as const,
      detail: "The inventory valuation could not be read, so nothing here is proven.",
    };
  }
  if (input.itemCount === 0) {
    return {
      ...base,
      status: "healthy" as const,
      detail: "This company holds no stock.",
      passCondition: "Applies once an item is tracked as inventory.",
    };
  }
  if (input.negativeCount === 0) {
    return {
      ...base,
      status: "healthy" as const,
      detail: `${plural(input.itemCount, "item")} tracked, none negative.`,
    };
  }
  return {
    ...base,
    status: "attention" as const,
    detail: `${plural(input.negativeCount, "item")} below zero: ${input.negativeNames.slice(0, 4).join(", ")}${input.negativeNames.length > 4 ? ", and others" : ""}. Something was sold that the system did not think existed, so its cost was taken at a rate nothing supports.`,
  };
}

/**
 * The stock on this screen and the figure on the balance sheet are the same
 * figure.
 *
 * **The blocking check.** A variance here is not a job to be assigned; it means
 * the two numbers disagree and neither can be trusted until somebody finds out
 * why. That is why it becomes a queue row that cannot be dismissed — the one
 * item on this surface that a person may not wave away.
 */
export function valuationTiesOutControl(input: {
  /** Null when either side could not be read. */
  subledgerMinor: number | null;
  controlMinor: number;
  asOf: string;
  evaluatedAt: string;
}): SurfaceControl {
  const base = {
    key: "inventory-ties-out",
    title: "Stock ties to the ledger",
    passCondition: `The value of what is on hand equals the inventory control account at ${input.asOf}.`,
    evaluatedAt: input.evaluatedAt,
    href: "/reports/gl-posting",
    blocking: true,
  };
  if (input.subledgerMinor === null) {
    return {
      ...base,
      status: "unavailable" as const,
      detail: "One side of this comparison could not be read, so it cannot be reported as tying.",
    };
  }
  const variance = input.subledgerMinor - input.controlMinor;
  if (variance === 0) {
    return {
      ...base,
      status: "healthy" as const,
      detail: `Both sides read ${money(input.controlMinor)} at ${input.asOf}.`,
    };
  }
  return {
    ...base,
    status: "blocked" as const,
    detail: `The stock is worth ${money(input.subledgerMinor)} and the ledger says ${money(input.controlMinor)} — out by ${money(variance)}. Neither figure can be relied on until this is explained.`,
    differenceMinor: Math.abs(variance),
  };
}

/** Depreciation that is due and has not been posted. */
export function depreciationDueControl(input: {
  /** Null when the assets could not be read. */
  assetCount: number | null;
  dueCount: number;
  dueMinor: number;
  evaluatedAt: string;
}): SurfaceControl {
  const base = {
    key: "depreciation-due",
    title: "Depreciation is up to date",
    passCondition: "No asset has a depreciation period that has ended and not been posted.",
    evaluatedAt: input.evaluatedAt,
    href: "/fixed-assets",
    blocking: false,
  };
  if (input.assetCount === null) {
    return { ...base, status: "unavailable" as const, detail: "The fixed assets could not be read." };
  }
  if (input.assetCount === 0) {
    return {
      ...base,
      status: "healthy" as const,
      detail: "This company holds no fixed assets.",
      passCondition: "Applies once a fixed asset is registered.",
    };
  }
  if (input.dueCount === 0) {
    return {
      ...base,
      status: "healthy" as const,
      detail: `${plural(input.assetCount, "asset")} registered, nothing waiting to be posted.`,
    };
  }
  return {
    ...base,
    status: "attention" as const,
    detail: `${plural(input.dueCount, "asset")} with ${money(input.dueMinor)} of depreciation due and not posted — profit is overstated by that much until it is.`,
    differenceMinor: Math.abs(input.dueMinor),
  };
}

// --- Work items ------------------------------------------------------------

export function negativeStockItem(
  item: { id: string; code: string | null; name: string; qtyOnHand: number; valueMinor: number },
  confirmedAt: string,
): DerivedWorkItem {
  return {
    key: `inv-negative:${item.id}`,
    sourceKind: "negative-stock",
    sourceId: item.id,
    title: item.code ? `${item.code} — ${item.name}` : item.name,
    reason: `On hand ${item.qtyOnHand} · sold without stock to sell, so the cost taken is unsupported`,
    // Deeper below zero is not automatically worse, but it is more of whatever
    // went wrong, and it is the only ordering signal there is.
    severity: item.qtyOnHand <= -10 ? "high" : "medium",
    amountMinor: Math.abs(item.valueMinor),
    ageDays: 0,
    href: "/items",
    actionLabel: "Adjust",
    confirmedAt,
    blocking: false,
  };
}

/**
 * The valuation variance, as the one item on this surface nobody may dismiss.
 *
 * Deliberately a work item as well as a control, which contradicts the rule the
 * other three surfaces follow — and the contradiction is the point. Elsewhere a
 * control summarises rows the queue already carries. Here there are no rows: the
 * two sides disagree by an amount, and there is nothing smaller to hand
 * somebody. It is exactly the case the accounting surface builds control rows
 * for.
 */
export function valuationVarianceItem(
  input: { differenceMinor: number; detail: string; confirmedAt: string },
): DerivedWorkItem {
  return {
    key: "control:inventory-ties-out",
    sourceKind: "control-failure",
    sourceId: null,
    title: "Stock does not tie to the ledger",
    reason: input.detail,
    severity: "critical",
    amountMinor: Math.abs(input.differenceMinor),
    ageDays: 0,
    href: "/reports/gl-posting",
    actionLabel: "Review",
    confirmedAt: input.confirmedAt,
    blocking: true,
  };
}

export function depreciationDueItem(
  asset: {
    id: string;
    assetNumber: string;
    name: string;
    dueMinor: number;
    nextDate: string | null;
  },
  input: { ageDays: number; confirmedAt: string },
): DerivedWorkItem {
  return {
    key: `inv-depreciation:${asset.id}`,
    sourceKind: "depreciation-due",
    sourceId: asset.id,
    title: `${asset.assetNumber} — ${asset.name}`,
    reason: asset.nextDate
      ? `Depreciation due since ${asset.nextDate} and not posted`
      : "Depreciation due and not posted",
    severity: input.ageDays > 60 ? "high" : "medium",
    amountMinor: Math.abs(asset.dueMinor),
    ageDays: input.ageDays,
    href: "/fixed-assets",
    actionLabel: "Post",
    confirmedAt: input.confirmedAt,
    blocking: false,
  };
}
