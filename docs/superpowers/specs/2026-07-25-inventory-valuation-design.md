# Module G2 — Inventory Quantity and Valuation (weighted average cost)

- **Date:** 2026-07-25
- **Status:** Approved for planning
- **Owner:** AI Team — CTYHP
- **Related:** `PRD/PRD_US_Accounting_Web_App.md` (US-FR-070, US-FR-072, Phase 3),
  `docs/superpowers/specs/2026-07-25-purchase-orders-receiving-design.md` (Module G1, whose
  receive / convert extension points this cycle fills in)

## 1. Goal & Scope

Turn catalog items into tracked inventory: quantity on hand and a ledger-reconciling valuation.
Receiving an inventory item recognizes an asset before the vendor's bill arrives; selling it
relieves that asset into Cost of Goods Sold. The inventory subledger and the inventory control
account must agree at all times, which is the acceptance criterion of US-FR-072.

### In scope
- **Inventory items**: `is_inventory` on `acc_item` with an inventory asset account and a COGS
  account. An inventory item must be both purchased and sold.
- **Costing method: weighted average cost (WAC)**, moving average, derived from the subledger. This
  is the "approved costing method" for this deployment and is documented in §3.
- **Inventory subledger** `acc_inventory_txn`: every movement, with running quantity and value, and
  the journal entry it posted.
- **Receiving posts** (fills G1's extension point): DR Inventory / CR **Goods Received Not Invoiced**
  (GRNI, a current liability) at the purchase-order cost.
- **Bill conversion posts**: the bill's inventory line debits GRNI at the PO cost (clearing exactly
  what the receipt credited), and any approved price variance becomes a second line that debits or
  credits Inventory — so inventory carries the actual cost and GRNI always drains to zero.
- **Selling posts**: issuing an invoice that contains inventory items posts a separate
  base-currency cost entry, DR COGS / CR Inventory, at WAC.
- **Negative stock is refused**: any movement that would take quantity on hand below zero is
  rejected with a clear message.
- **Void paths**: voiding a receipt, a bill, or an invoice reverses both its journal entry and its
  subledger movements, using the cost that was originally recorded (never a re-derived WAC).
- **Adjustments**: `acc_adjust_inventory` for shrinkage, found stock, and revaluation — quantity
  and/or value against an offset account, with a required reason.
- **Inventory Valuation report** at `/reports/inventory-valuation`: quantity, value, and unit cost
  per item as of a date, with an explicit reconciliation against the inventory control accounts.

### Out of scope (own cycles / later)
- FIFO, LIFO, standard cost, and specific identification — WAC only. The subledger stores every
  movement, so another method could be layered later without re-deriving history.
- Lot, serial, and bin tracking; assemblies/BOM/manufacturing; landed-cost allocation of freight
  and duty into unit cost.
- **Buying inventory without a purchase order.** A bill or expense line may not carry an inventory
  item; the server rejects it. Inventory enters only through PO receiving, or through an explicit
  adjustment. This is enforced rather than left as a silent hole, and lifting it is its own cycle.
- **Non-base-currency inventory.** A purchase order or invoice that touches an inventory item must
  be in the base currency; anything else is rejected. Valuing stock across FX rates is Module I.
- Lower-of-cost-or-market write-downs as a policy engine (a manual revaluation adjustment covers
  the mechanics), reorder points, and stock-status dashboards.

## 2. Accounting flow (end to end)

| Event | Journal entry | Subledger |
|---|---|---|
| Receive 10 @ $12.50 | DR Inventory 125.00 / CR GRNI 125.00 | +10 qty, +125.00 value |
| Bill arrives at $12.50 | DR GRNI 125.00 / CR AP 125.00 | — (asset already recognized) |
| Bill arrives at $13.00 (approved variance) | DR GRNI 125.00, DR Inventory 5.00 / CR AP 130.00 | qty 0, +5.00 value |
| Sell 4 (WAC 13.00) | DR COGS 52.00 / CR Inventory 52.00 | −4 qty, −52.00 value |
| Shrinkage of 1 | DR Shrinkage expense 13.00 / CR Inventory 13.00 | −1 qty, −13.00 value |

GRNI is the reason receiving can post before the bill exists, and the reason the bill's inventory
line debits the **PO** cost rather than the billed cost: the credit the receipt made and the debit
the bill makes are the same number, so GRNI carries only genuinely un-billed receipts. The price
difference is not a GRNI residual — it is a correction to the value of the asset.

## 3. Costing: weighted average, and the residual rule

WAC = running value ÷ running quantity at the moment of the movement, taken from the subledger
under a lock on the item row so two concurrent postings cannot both read the same average.

**Residual rule:** a sale that takes quantity to exactly zero relieves the *entire* remaining
value, not `quantity × WAC`. Without this, integer-cent rounding leaves a few cents of value
attached to zero units and the valuation report can never tie to the ledger. With it, quantity zero
always means value zero.

## 4. Data model (migration `0033`)

New enum `acc_inventory_source`: `receipt`, `bill_variance`, `sale`, `adjustment`, `reversal`.
New `acc_journal_source` values: `goods_receipt`, `inventory`, `inventory_adjustment` (added here,
first used by the functions in `0034`).

`acc_item` gains `is_inventory boolean not null default false`,
`inventory_account_id uuid → acc_account`, `cogs_account_id uuid → acc_account`.

**`acc_inventory_txn`** — `id`, `seq bigserial` (the deterministic order movements are applied in),
`item_id not null → acc_item`, `txn_date date not null`, `source acc_inventory_source not null`,
`source_id uuid` (receipt / bill / invoice / adjustment), `qty_delta numeric(20,4) not null`,
`cost_delta_minor bigint not null` (base currency, signed), `running_qty numeric(20,4) not null`,
`running_value_minor bigint not null`, `journal_entry_id uuid → acc_journal_entry`,
`reversal_of uuid → acc_inventory_txn`, `memo text`, `created_by`, `created_at`.
Indexed on `(item_id, seq)` and `(item_id, txn_date)`. Insert-only: no update or delete policy.

`acc_bill_line` gains `is_inventory_variance boolean not null default false` — the explicit marker
that tells `acc_post_bill` this line is a cost correction to an item rather than an expense.

A **GRNI** account is seeded if absent: `2150 Goods Received Not Invoiced`, `current_liability`,
posting, active — resolved by `acc_active_grni_account()` the way AP and AR already are.

RLS: read for any role; `acc_inventory_txn` has **no** write policy at all (every insert goes
through a SECURITY DEFINER function).

## 5. Pure domain (`lib/domain/inventory.ts`, unit-tested)

- `weightedAverageCostMinor(qtyOnHand, valueMinor): number` — 0 when quantity is 0; otherwise
  value ÷ quantity rounded half away from zero.
- `costOfSaleMinor(qtyOnHand, valueMinor, qtySold): number` — implements §3: the whole remaining
  value when `qtySold === qtyOnHand`, else `round(qtySold × WAC)`; throws when `qtySold` exceeds
  quantity on hand (the negative-stock rule, mirrored by the SQL guard).
- `applyMovement({qty, valueMinor}, {qtyDelta, costDeltaMinor})` → the new running pair, throwing on
  a negative result — the same arithmetic the subledger writer performs.
- `inventoryTiesOut(subledgerValueMinor, controlAccountBalanceMinor): boolean`.
- Zod: `itemCreateSchema` gains `is_inventory`, `inventory_account_id`, `cogs_account_id` with
  refinements — an inventory item must be sold and purchased and must have both accounts;
  `inventoryAdjustmentSchema` (item, date, quantity delta, unit cost, value delta, offset account,
  reason).

## 6. RPCs (migration `0034`)

- `acc_active_grni_account()`, `acc_item_wac(p_item_id)` — read helpers.
- `acc_add_inventory_txn(...) returns uuid` — the **only** writer of the subledger: locks the item,
  reads the previous running pair by `seq`, refuses a negative resulting quantity, writes the row
  with its new running pair. Everything below calls it.
- `acc_receive_purchase_order` — **redefined** to post, for the inventory lines of the receipt, one
  base-currency entry (`goods_receipt`) of DR Inventory / CR GRNI and one subledger txn per line.
  Rejects a non-base-currency PO, a missing inventory account, and a missing GRNI account.
- `acc_void_goods_receipt` — **redefined** to void that entry and write reversing txns; the
  negative-quantity guard is what refuses a void whose stock has already been sold.
- `acc_create_bill_from_po` — **redefined** so an inventory line debits GRNI at the PO cost and any
  price difference becomes a second line against the inventory account, flagged
  `is_inventory_variance`, carrying the item and quantity.
- `acc_post_bill` — **redefined** to write a `bill_variance` subledger txn for each variance line
  after the entry is posted, and to reject an inventory item on a line that is neither PO-derived
  nor a variance line (the no-direct-purchase rule of §1).
- `acc_void_bill` — **redefined** to reverse those variance txns (in addition to G1's billed-quantity
  rollback).
- `acc_issue_invoice` — **redefined** to compute, per inventory item on the invoice, the cost of sale
  under §3, post a **separate** base-currency `inventory` entry (DR COGS / CR Inventory) linked to
  the invoice, and write one `sale` txn per item. Rejects a non-base-currency invoice carrying
  inventory, a missing COGS or inventory account, and a sale beyond quantity on hand. The invoice's
  own entry is unchanged, so a foreign-currency sale of non-inventory items behaves exactly as before.
- `acc_void_invoice` — **redefined** to void the linked cost entry and reverse its txns.
- `acc_adjust_inventory(p_item_id, p_date, p_qty_delta, p_unit_cost_minor, p_value_delta_minor, p_offset_account_id, p_reason)` —
  quantity increase costed at the given unit cost, quantity decrease at WAC under §3, and a pure
  revaluation when the quantity delta is zero. Posts DR/CR Inventory against the offset account and
  writes an `adjustment` txn. Reason required.
- `acc_inventory_valuation(p_as_of date)` — per item: `sum(qty_delta)` and `sum(cost_delta_minor)`
  over txns dated on or before `p_as_of`, with the item's inventory account, so the report can
  reconcile per control account. Date-based (not running-column-based) so an as-of view is correct.

## 7. Services / Actions / UI

- `lib/services/inventory.ts`: `getInventoryValuation(sb, asOf)` (joins the control-account balances
  from the existing `acc_ledger_balances` and returns a `tiesOut` flag), `listItemTxns(sb, itemId)`,
  `adjustInventory(sb, input)`.
- Items page: the item form gains an "Inventory" switch with the inventory and COGS account pickers
  (visible only when it is on), and the list shows quantity on hand and value for inventory items.
- `/reports/inventory-valuation`: as-of date, per-item quantity / unit cost / value, a total, and a
  reconciliation line against the inventory control accounts that goes red when it does not tie.
- Item drawer / page section: the movement history for one item (date, source, quantity, cost,
  running balance) — the audit trail behind the number.
- An "Adjust inventory" dialog on the items page (staff-gated).
- Nav: the report under Reports.

## 8. Security & audit
- `acc_inventory_txn` is insert-only through SECURITY DEFINER functions and has no client write
  policy; adjustments are staff-gated and carry a mandatory reason; reversals are written as new
  rows pointing at what they reverse (`reversal_of`) — history is never rewritten.
- All posting still funnels through `acc_post_entry`, so the closed-period guard applies to
  receipts, cost entries, and adjustments alike.

## 9. Testing (per `ctyhp-accounting/CLAUDE.md`)
- **Unit** (`tests/unit/inventory.test.ts`): WAC at zero quantity, whole and fractional averages;
  `costOfSaleMinor` for a partial sale, for the exact-remainder sale (residual rule), and for an
  oversell (throws); `applyMovement` accumulating a receipt then a sale, and refusing a negative;
  `inventoryTiesOut`; the item schema refinements for an inventory item missing an account.
- **E2E verify** (`scripts/verify-inventory.mjs`, over the pooler, self-cleaning): receive 10 @
  $12.50 and assert DR Inventory / CR GRNI plus a subledger row; bill it at $13.00 with an approved
  variance and assert GRNI nets to zero, inventory value is $130.00 and WAC $13.00; sell 4 and
  assert DR COGS 52.00 / CR Inventory 52.00 on a separate base-currency entry; oversell and assert
  rejection; sell the remaining 6 and assert quantity 0 **and value 0** (residual rule); adjust
  found stock and shrinkage; void the invoice and assert the cost entry and quantity come back;
  void the bill and assert the variance reverses; assert `acc_inventory_valuation` equals the
  inventory control-account balance at every checkpoint; assert an inventory item on a plain bill
  line is rejected and a non-base-currency PO with an inventory item is rejected.
- Full `npm run build && npm test && npm run typecheck && npm run lint` clean, real output pasted.

## 10. Build sequence
1. Migration `0033` (enums, item columns, subledger, GRNI seed, bill-line marker, RLS).
2. Migration `0034` (subledger writer + the eight redefined/new RPCs + valuation read).
3. Domain `inventory.ts` + schema changes + unit tests (tests first).
4. `lib/db/types.ts` + `lib/services/inventory.ts` (+ items service for the new fields).
5. Server actions (adjustment, valuation, movements).
6. UI: item form inventory fields → items list columns → movement history → valuation report → nav.
7. `scripts/verify-inventory.mjs`; apply migrations; full gate clean.
