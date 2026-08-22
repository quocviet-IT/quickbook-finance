import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  DerivedWorkItem,
  SectionEnvelope,
  SurfaceControl,
  SurfaceWorkItem,
} from "@/lib/domain/work-surface/types";
import type { WorkItemState } from "@/lib/domain/work-surface/lifecycle";
import { orderWork } from "@/lib/domain/work-surface/priority";
import { EMPTY_WORK_POLICY, type WorkPolicy } from "@/lib/domain/work-policy";
import {
  depreciationDueControl,
  depreciationDueItem,
  negativeStockControl,
  negativeStockItem,
  valuationTiesOutControl,
  valuationVarianceItem,
} from "@/lib/domain/inventory-surface/rules";
import { envelope, failed, withDecisions } from "@/lib/services/work-surface/envelope";
import {
  listWorkItemState,
  retireWorkItems,
} from "@/lib/services/work-surface/work-item-state";
import { getWorkPolicy } from "@/lib/services/work-policy";
import { getInventoryValuation } from "@/lib/services/inventory";
import { listFixedAssets } from "@/lib/services/fixed-assets";
import { getCurrentCompanySettings } from "@/lib/services/company";
import { todayInTimeZone } from "@/lib/services/dashboard";

/**
 * The Inventory surface: can we sell it, and does the stock tie to the ledger?
 *
 * The only one of the four with a check that blocks. A valuation variance is not
 * a job somebody picks up — it says the quantity on this screen and the figure
 * on the balance sheet disagree, and until that is explained neither can be
 * relied on. So it becomes a queue row that cannot be dismissed, which is the
 * accounting surface's pattern and is right here for the same reason: there is
 * nothing smaller to hand anybody.
 *
 * Plan: docs/superpowers/plans/2026-08-22-accounting-cockpit-phase6.md
 */

export interface InventoryContext {
  asOf: string;
  currencyCode: string;
  currencyDecimals: number;
  timeZone: string;
}

export interface InventoryFacts {
  items: {
    id: string;
    code: string | null;
    name: string;
    qtyOnHand: number;
    valueMinor: number;
  }[];
  subledgerMinor: number;
  controlMinor: number;
  tiesOut: boolean;
  assets: {
    id: string;
    assetNumber: string;
    name: string;
    dueMinor: number;
    nextDate: string | null;
  }[];
}

export interface InventorySurfaceData {
  context: InventoryContext;
  controls: SectionEnvelope<SurfaceControl[]>;
  queue: SectionEnvelope<SurfaceWorkItem[]>;
  policy: WorkPolicy;
}

const DAY_MS = 24 * 60 * 60 * 1_000;

function daysBetween(later: string, earlier: string): number {
  const a = Date.parse(`${later.slice(0, 10)}T00:00:00.000Z`);
  const b = Date.parse(`${earlier.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((a - b) / DAY_MS));
}

export async function getInventoryContext(sb: SupabaseClient): Promise<InventoryContext> {
  const company = await getCurrentCompanySettings(sb);
  const timeZone = company?.time_zone ?? "America/New_York";
  return {
    asOf: todayInTimeZone(timeZone),
    currencyCode: "USD",
    currencyDecimals: 2,
    timeZone,
  };
}

export async function getInventoryFacts(
  sb: SupabaseClient,
  context: InventoryContext,
): Promise<InventoryFacts> {
  const [valuation, assets] = await Promise.all([
    getInventoryValuation(sb, context.asOf),
    listFixedAssets(sb),
  ]);

  return {
    items: valuation.rows.map((row) => ({
      id: row.item_id,
      code: row.item_code,
      name: row.name,
      qtyOnHand: Number(row.qty_on_hand),
      valueMinor: Number(row.value_minor),
    })),
    subledgerMinor: valuation.subledgerValueMinor,
    controlMinor: valuation.controlBalanceMinor,
    tiesOut: valuation.tiesOut,
    assets: assets
      .filter((asset) => Number(asset.due_depreciation_minor) > 0)
      .map((asset) => ({
        id: asset.id,
        assetNumber: asset.asset_number,
        name: asset.name,
        dueMinor: Number(asset.due_depreciation_minor),
        nextDate: asset.next_depreciation_date,
      })),
  };
}

export function inventoryControls(
  facts: InventoryFacts,
  context: InventoryContext,
  evaluatedAt: string,
): SurfaceControl[] {
  const negative = facts.items.filter((item) => item.qtyOnHand < 0);
  return [
    valuationTiesOutControl({
      subledgerMinor: facts.subledgerMinor,
      controlMinor: facts.controlMinor,
      asOf: context.asOf,
      evaluatedAt,
    }),
    negativeStockControl({
      itemCount: facts.items.length,
      negativeCount: negative.length,
      negativeNames: negative.map((item) => item.code ?? item.name),
      evaluatedAt,
    }),
    depreciationDueControl({
      assetCount: facts.assets.length,
      dueCount: facts.assets.length,
      dueMinor: facts.assets.reduce((sum, asset) => sum + asset.dueMinor, 0),
      evaluatedAt,
    }),
  ];
}

export function inventoryWorkQueue(
  facts: InventoryFacts,
  context: InventoryContext,
  controls: readonly SurfaceControl[],
  confirmedAt: string,
): DerivedWorkItem[] {
  const items: DerivedWorkItem[] = [];

  // The one control that becomes a row, because a variance has no smaller
  // representation than itself.
  const tie = controls.find((control) => control.key === "inventory-ties-out");
  if (tie?.status === "blocked") {
    items.push(
      valuationVarianceItem({
        differenceMinor: tie.differenceMinor ?? 0,
        detail: tie.detail,
        confirmedAt,
      }),
    );
  }

  for (const item of facts.items.filter((candidate) => candidate.qtyOnHand < 0)) {
    items.push(negativeStockItem(item, confirmedAt));
  }

  for (const asset of facts.assets) {
    items.push(
      depreciationDueItem(asset, {
        ageDays: asset.nextDate ? daysBetween(context.asOf, asset.nextDate) : 0,
        confirmedAt,
      }),
    );
  }

  return orderWork(items);
}

export interface InventorySections {
  context: (sb: SupabaseClient) => Promise<InventoryContext>;
  facts: (sb: SupabaseClient, context: InventoryContext) => Promise<InventoryFacts>;
  workState: (sb: SupabaseClient) => Promise<Map<string, WorkItemState>>;
  retire: (sb: SupabaseClient, liveKeys: readonly string[]) => Promise<number>;
  policy: (sb: SupabaseClient) => Promise<WorkPolicy>;
}

export const DEFAULT_INVENTORY_SECTIONS: InventorySections = {
  context: getInventoryContext,
  facts: getInventoryFacts,
  workState: listWorkItemState,
  retire: retireWorkItems,
  policy: getWorkPolicy,
};

export async function getInventorySurface(
  sb: SupabaseClient,
  sections: InventorySections = DEFAULT_INVENTORY_SECTIONS,
): Promise<InventorySurfaceData> {
  const context = await sections.context(sb);
  const [factsResult, stateResult, policyResult] = await Promise.allSettled([
    sections.facts(sb, context),
    sections.workState(sb),
    sections.policy(sb),
  ]);

  const policy = policyResult.status === "fulfilled" ? policyResult.value : EMPTY_WORK_POLICY;
  const state =
    stateResult.status === "fulfilled"
      ? stateResult.value
      : (console.error("reading work item state failed:", stateResult.reason),
        new Map<string, WorkItemState>());

  const at = new Date().toISOString();
  const controlRows =
    factsResult.status === "fulfilled"
      ? inventoryControls(factsResult.value, context, at)
      : null;

  const controls = envelope(
    controlRows
      ? { status: "fulfilled" as const, value: controlRows }
      : (factsResult as PromiseRejectedResult),
    "The inventory checks could not be evaluated. Nothing here should be read as passing.",
  );

  const queue: SectionEnvelope<SurfaceWorkItem[]> =
    factsResult.status === "fulfilled" && controlRows
      ? {
          data: withDecisions(
            inventoryWorkQueue(factsResult.value, context, controlRows, at),
            state,
            context,
          ),
          generatedAt: at,
          dataState: "fresh",
        }
      : failed(
          "The inventory work could not be loaded, so this is not a statement that there is none.",
          (factsResult as PromiseRejectedResult).reason,
        );

  if (queue.data) {
    await sections.retire(sb, queue.data.map((item) => item.key));
  }

  return { context, controls, queue, policy };
}

/**
 * The one surface where something is blocking, and it is worked out from the
 * ledger rather than taken from the browser.
 *
 * A dismissal request arrives claiming a key; this re-derives the valuation and
 * answers for itself whether that key is the variance. If the read fails, the
 * shared action treats the item as blocking — a failed read must not become
 * permission to dismiss.
 */
export async function inventoryBlockingKeys(
  sb: SupabaseClient,
): Promise<ReadonlySet<string>> {
  const context = await getInventoryContext(sb);
  const facts = await getInventoryFacts(sb, context);
  const controls = inventoryControls(facts, context, new Date().toISOString());
  return new Set(
    controls
      .filter((control) => control.blocking && control.status === "blocked")
      .map((control) => `control:${control.key}`),
  );
}
