# Module G1 — Purchase Orders, Receiving, and Three-Way Matching

- **Date:** 2026-07-25
- **Status:** Approved for planning
- **Owner:** AI Team — CTYHP
- **Related:** `PRD/PRD_US_Accounting_Web_App.md` (US-FR-070, US-FR-071, US-FR-073, Phase 3),
  `US_ACCOUNTING_USER_MANUAL/`, `docs/superpowers/specs/2026-07-15-ctyhp-accounting-webapp-design.md`,
  builds on Module 3b (Payables: `acc_bill`) and Products & Services (`acc_item`)

## 1. Goal & Scope

Add the buy-side commitment and receiving cycle in front of Bills: a purchase order is raised,
goods/services are received against it (partially, repeatedly), and the vendor's bill is created
from what was received — with configurable three-way matching (PO ↔ receipt ↔ bill) that forces an
explicit, audited exception approval when quantity or price falls outside tolerance.

### In scope
- **Purchase orders** (US-FR-071): draft → open → partial → received → closed/cancelled, with
  lines (item, quantity, unit cost, expense account). A PO is a **commitment, not a transaction**:
  it posts nothing to the ledger.
- **Receiving** (US-FR-071): goods-receipt documents against PO lines. Partial and repeated
  receipts allowed; cumulative received quantity can never exceed the ordered quantity, which is
  what prevents duplicate receipts. Receipts are voidable (with reason) while unbilled.
- **Short close / cancel** (US-FR-071): cancel an untouched PO; short-close a PO whose remaining
  quantity will never arrive.
- **Bill conversion** (US-FR-071): create a **draft** bill from received-but-unbilled PO lines,
  with PO→receipt→bill traceability preserved on every line. The existing `acc_post_bill` posts it;
  the existing `acc_void_bill` rolls the billed quantity back.
- **Three-way matching** (US-FR-073): a singleton config of price and quantity tolerances (in basis
  points). Within tolerance → conversion proceeds. Outside tolerance → conversion is rejected
  unless an explicit reason is supplied, which is recorded as a variance exception row.
- **Purchasing settings page** for the tolerances (admin-only).

### Out of scope (own cycles / later)
- **Inventory quantity and valuation (US-FR-072)** → Module G2, the next cycle. In G1 receiving is
  **quantity-only and non-posting**; a received-not-billed accrual (GRNI) and inventory asset
  postings arrive with G2, which extends the same receive/convert functions at the extension points
  called out in §5.
- Vendor 1099 / tax profile (its own slice of Module G).
- Independent maker-checker approval of the PO itself and of variance exceptions (US-FR-010..012) →
  Module C. Here the exception is captured with actor + reason, which is the audit trail Module C
  will later gate.
- PO emailing / PDF templating → Module K (Documents). `ship_to` and `memo` are stored now.
- Blanket/standing orders, drop-ship, landed cost, foreign-currency PO revaluation (Module I).
- Requisitions and approval routing.

## 2. Accounting position (why receiving posts nothing in G1)

A purchase order is an executory commitment — US GAAP recognizes no asset or liability when it is
raised, so the PO is deliberately outside the ledger. In G1 a receipt of a **service or expense**
item likewise posts nothing: the expense is recognized when the bill is posted (`acc_post_bill`,
DR expense / CR AP), which is already correct accrual treatment for the current period as long as
the bill is dated correctly. The one case that genuinely needs a receipt-time posting is receiving
**inventory**, which creates an asset before the invoice arrives — that is exactly Module G2's
subject and is why it is a separate cycle rather than a half-built accrual here.

Consequence for reporting: between receipt and bill there is no ledger effect in G1. The PO detail
page and the new "Received not billed" list surface that exposure operationally, and the spec
records it as a known limitation closed by G2.

## 3. Data model (migration `0031`)

New enums (added in `0031`, first used in `0032` — per `CLAUDE.md`, a new enum value cannot be used
in the transaction that adds it):
- `acc_po_status` — `draft`, `open`, `partial`, `received`, `closed`, `cancelled`.
- `acc_receipt_status` — `posted`, `void`.
- `acc_variance_kind` — `price`, `quantity`.

Tables:

**`acc_purchase_order`** — `id`, `po_number text unique` (assigned on approve, like every other
numbered document), `vendor_id not null → acc_vendor`, `order_date date`, `expected_date date`,
`currency_code not null → acc_currency`, `ship_to text`, `memo text`, `total_minor bigint`,
`status acc_po_status default 'draft'`, `close_reason text`, `created_by`, `created_at`,
`updated_at`.

**`acc_purchase_order_line`** — `id`, `purchase_order_id → acc_purchase_order on delete cascade`,
`line_order int`, `item_id → acc_item` (nullable link, line keeps its own snapshot — same rule as
invoice/bill lines), `description text`, `quantity numeric(20,4) not null check (quantity > 0)`,
`unit_cost_minor bigint not null check (>= 0)`, `expense_account_id not null → acc_account`,
`line_total_minor bigint`, `qty_received numeric(20,4) not null default 0`,
`qty_billed numeric(20,4) not null default 0`, `is_closed boolean not null default false`.

`qty_received` / `qty_billed` are **derived counters maintained only inside the SECURITY DEFINER
RPCs under row locks** — never written from the app. The verify script asserts them against the
receipt/bill lines they summarize, so drift is caught rather than trusted.

**`acc_goods_receipt`** — `id`, `receipt_number text unique` (assigned on create; a receipt is
always "posted" as a document), `purchase_order_id not null`, `vendor_id not null`,
`receipt_date date`, `memo text`, `status acc_receipt_status default 'posted'`, `void_reason text`,
`created_by`, `created_at`.

**`acc_goods_receipt_line`** — `id`, `goods_receipt_id → ... on delete cascade`,
`purchase_order_line_id not null → acc_purchase_order_line`, `quantity numeric(20,4) check (> 0)`,
`unit_cost_minor bigint not null` (snapshot of the PO line cost at receipt time).

**`acc_purchasing_config`** — singleton (`singleton boolean primary key default true check (singleton)`),
`price_tolerance_bps int not null default 200 check (between 0 and 10000)`,
`qty_tolerance_bps int not null default 0 check (between 0 and 10000)`,
`updated_by`, `updated_at`. Seeded with one row. Defaults: 2% price tolerance, 0% quantity
tolerance (you may not bill more than you received without an approved exception).

**`acc_po_variance_exception`** — `id`, `bill_id → acc_bill`, `purchase_order_id`,
`purchase_order_line_id`, `kind acc_variance_kind`, `expected_value numeric(20,4)`,
`actual_value numeric(20,4)`, `variance_bps int`, `reason text not null`, `approved_by`,
`created_at`. One row per out-of-tolerance line per conversion — the audit trail for US-FR-073.
`expected_value`/`actual_value` are unit costs in minor units for `kind='price'` and quantities
(received vs cumulative billed) for `kind='quantity'`.

Additions to existing tables (all nullable, so historical bills are untouched):
- `acc_bill.purchase_order_id uuid → acc_purchase_order`
- `acc_bill_line.purchase_order_line_id uuid → acc_purchase_order_line`
- `acc_bill_line.goods_receipt_line_id uuid → acc_goods_receipt_line`
- `acc_bill_line.quantity numeric(20,4)`, `acc_bill_line.unit_cost_minor bigint` — needed to make a
  price variance computable at all; `amount_minor` stays the authoritative posted amount.

Sequences: `('purchase_order', 'PO-', 1)`, `('goods_receipt', 'GR-', 1)`.

RLS: read for any role (`acc_current_role() is not null`), write for staff on the document tables
(mutations go through SECURITY DEFINER RPCs); `acc_purchasing_config` readable by any role,
writable by `acc_is_admin()`; `acc_po_variance_exception` readable by any role, insert only via the
conversion RPC.

## 4. Pure domain (`lib/domain/purchasing.ts`, unit-tested)

- `poLineTotalMinor(quantity: number, unitCostMinor: number): number` — quantity × unit cost,
  rounded half-up to whole minor units, reusing `lib/domain/money.ts` rounding. Single definition
  of a PO line's extended amount (used by the UI preview; the RPC recomputes server-side).
- `remainingQty(ordered, received): number` — never negative.
- `poReceiptStatus(lines: { quantity; qty_received; is_closed }[]): "open" | "partial" | "received"` —
  `received` when every line is fully received or closed; `partial` when some quantity is in;
  `open` when nothing is.
- `varianceBps(expectedMinor: number, actualMinor: number): number` — signed basis points of
  `(actual − expected) / expected`; `0` when both are 0, and a full `10000` when expected is 0 but
  actual is not (so a from-nothing variance can never look "within tolerance").
- `withinToleranceBps(expected, actual, toleranceBps): boolean` — `|varianceBps| <= tolerance`.
- `threeWayMatchLine(input, config): { priceOk; qtyOk; requiresApproval; exceptions: {kind; expectedMinor; actualMinor; varianceBps}[] }`
  where `input = { orderedQty, receivedQty, alreadyBilledQty, billQty, poUnitCostMinor, billUnitCostMinor }`
  and `config = { priceToleranceBps, qtyToleranceBps }`. Quantity is matched as
  `alreadyBilledQty + billQty` against `receivedQty` (you bill what you received, not what you
  ordered); price as bill unit cost against PO unit cost.
- Zod in `lib/domain/schemas.ts`: `purchaseOrderSaveSchema` (header + ≥1 line, quantity > 0,
  unit cost ≥ 0, account required), `goodsReceiptSchema` (≥1 line, quantity > 0),
  `billFromPoSchema` (≥1 line, optional `variance_reason`), `purchasingConfigSchema`
  (both tolerances 0..10000).

Hard rule (`CLAUDE.md` §3): the tolerance decision and the line-extension arithmetic live **only**
here and in the RPC that re-derives them; no component recomputes either.

## 5. RPCs (migration `0032`, all `security definer`, staff-gated)

- `acc_save_purchase_order(p_po_id uuid, p_vendor_id uuid, p_order_date date, p_expected_date date, p_currency text, p_ship_to text, p_memo text, p_lines jsonb) returns uuid` —
  create when `p_po_id is null`, else replace the header and lines of a **draft** only
  (any other status → `raise exception`). Recomputes `line_total_minor` and `total_minor`
  server-side; never trusts client totals.
- `acc_approve_purchase_order(p_po_id uuid) returns text` — draft → `open`, assigns `po_number`
  via `acc_next_number('purchase_order')`, returns it.
- `acc_cancel_purchase_order(p_po_id uuid, p_reason text)` — allowed only when nothing has been
  received or billed; → `cancelled`.
- `acc_close_purchase_order(p_po_id uuid, p_reason text)` — short close: marks every line
  `is_closed`, → `closed`. Requires a reason.
- `acc_receive_purchase_order(p_po_id uuid, p_receipt_date date, p_memo text, p_lines jsonb) returns uuid` —
  `p_lines = [{ purchase_order_line_id, quantity }]`. Locks the PO and each line `for update`;
  rejects a PO not in (`open`, `partial`); rejects a line belonging to another PO, a closed line,
  a non-positive quantity, and any line where `qty_received + quantity > quantity` (**over-receipt
  = the duplicate-receipt guard**, enforced under the lock so two concurrent receipts cannot both
  pass). Inserts the receipt + lines, bumps `qty_received`, recomputes PO status via the same rule
  as `poReceiptStatus`. **G2 extension point:** inventory lines will additionally post
  DR Inventory / CR GRNI here.
- `acc_void_goods_receipt(p_receipt_id uuid, p_reason text)` — rejects if rolling the quantity back
  would leave `qty_billed > qty_received` on any line (i.e. it has already been billed); otherwise
  decrements `qty_received`, sets `status='void'`, recomputes PO status. **G2 extension point:**
  reverses the receipt's journal entry.
- `acc_create_bill_from_po(p_po_id uuid, p_bill_date date, p_due_date date, p_vendor_ref text, p_memo text, p_lines jsonb, p_variance_reason text) returns uuid` —
  `p_lines = [{ purchase_order_line_id, quantity, unit_cost_minor }]`. Under locks: validates the
  PO is `open`/`partial`/`received`/`closed` (not draft/cancelled), each line belongs to the PO,
  quantity > 0; applies `threeWayMatchLine`'s rule in SQL against `acc_purchasing_config` —
  quantity beyond `qty_received` (plus quantity tolerance) and unit cost beyond price tolerance
  each require `p_variance_reason` to be non-empty, else `raise exception` naming the line and the
  variance. For every out-of-tolerance line it inserts an `acc_po_variance_exception` row with the
  reason and `auth.uid()`. Creates a **draft** `acc_bill` (vendor and currency inherited from the
  PO; `purchase_order_id` set) with lines carrying `purchase_order_line_id`, `quantity`,
  `unit_cost_minor`, `amount_minor = round(quantity × unit_cost)`, and the PO line's expense
  account; bumps `qty_billed`; recomputes PO status. Returns the bill id — the user reviews and
  posts it with the existing `acc_post_bill`. **G2 extension point:** inventory lines will debit
  GRNI instead of the expense account and post a cost variance to inventory.
- `acc_void_bill(p_bill_id uuid)` — **redefined** (`create or replace`) to additionally roll
  `qty_billed` back for the bill's PO lines and recompute PO status, before its existing
  draft-void / posted-reversal behavior. Keeps the counter honest whether the bill was ever posted.
- `acc_set_purchasing_config(p_price_tolerance_bps int, p_qty_tolerance_bps int)` — `acc_is_admin()`.
- `acc_received_not_billed()` — read-only: PO lines with `qty_received > qty_billed` and not
  closed, with vendor, PO number, description, remaining quantity and its extended value. Powers
  the operational exposure list §2 mentions.

Closed-period interaction: none of the G1 RPCs post to the ledger, so the closed-period guard in
`acc_post_entry` is untouched. The bill they produce is posted by `acc_post_bill`, which already
goes through that guard.

## 6. Services / Actions / UI

- `lib/services/purchasing.ts` — `listPurchaseOrders`, `getPurchaseOrder` (header + lines +
  receipts + linked bills), `savePurchaseOrder`, `approvePurchaseOrder`, `cancelPurchaseOrder`,
  `closePurchaseOrder`, `receivePurchaseOrder`, `voidGoodsReceipt`, `createBillFromPo`,
  `getReceivedNotBilled`, `getPurchasingConfig`, `setPurchasingConfig`. Each RPC call is checked
  for `{ error }` and rethrown as `PurchasingError` — never swallowed. Audit rows via
  `writeAudit` for approve / cancel / close / receive / void / convert.
- Server Actions in `app/(app)/purchase-orders/actions.ts` (+ `app/(app)/settings/purchasing/`):
  staff-gated writes, admin-gated config, Zod-validated, `revalidatePath` after each mutation.
- UI (Ant Design, matching the existing document pages):
  - `/purchase-orders` — list with status tag, vendor, dates, total, received/billed progress;
    filter by status; "New purchase order".
  - `/purchase-orders/new` and `/purchase-orders/[id]/edit` — header + editable line table with
    item prefill (`itemToBillLineDefaults`) and a live total from `poLineTotalMinor`.
  - `/purchase-orders/[id]` — read-only detail: header, lines with ordered/received/billed/
    remaining, receipt history (voidable), linked bills, variance exceptions if any, and the
    actions Approve / Receive / Create bill / Short close / Cancel gated by status and role. The
    Receive and Create-bill dialogs default quantities to what remains and require a reason when
    the client-side `threeWayMatchLine` preview says the line is out of tolerance.
  - `/purchase-orders/received-not-billed` — the exposure list.
  - `/settings/purchasing` — the two tolerances, admin-only, with an explanation of each.
  - Sidebar: a **Purchasing** group holding Purchase Orders, Received Not Billed (existing Bills /
    Expenses / Pay Bills / Vendors stay where they are).

## 7. Security & audit
- Every mutation is a staff-gated SECURITY DEFINER RPC; config is admin-gated. RLS blocks a viewer
  from writing even if an action were reachable.
- Variance exceptions record `approved_by = auth.uid()` and the reason — deliberately
  non-deletable (no delete policy).
- Nothing in this module bypasses `acc_post_entry`, so the ledger keeps its single write path.

## 8. Testing (per `ctyhp-accounting/CLAUDE.md`)
- **Unit** (`tests/unit/purchasing.test.ts`): `poLineTotalMinor` rounding with fractional
  quantities (concrete input/output, incl. a half-up case); `remainingQty` clamping;
  `poReceiptStatus` for none/partial/full/short-closed; `varianceBps` sign, zero-expected, and
  zero-both cases; `withinToleranceBps` at exactly the boundary; `threeWayMatchLine` for in-
  tolerance, over-quantity, over-price, and both-at-once.
- **E2E verify** (`scripts/verify-purchasing.mjs`, over the pooler, self-cleaning, mirroring the
  existing verify scripts): create a 2-line PO → approve (number assigned) → receive part of line 1
  → assert `qty_received` and status `partial` → attempt to over-receive → assert rejection →
  receive the rest → status `received` → convert the received quantity to a draft bill → assert
  bill lines carry `purchase_order_line_id` and the right amounts, `qty_billed` updated → post the
  bill and assert DR expense / CR AP balances → attempt a bill line priced 10% over the PO cost
  with no reason → assert rejection → retry with a reason → assert the exception row exists →
  void the bill → assert `qty_billed` rolled back → void a receipt → assert `qty_received` rolled
  back → short-close a PO and assert no further receipt is accepted. Then delete everything it
  created (voiding before deleting, per the ledger cleanup rule).
- Full `npm run build && npm test && npm run typecheck && npm run lint` clean, real output pasted.

## 9. Build sequence
1. Migration `0031` (enums, tables, columns, sequences, config seed, RLS).
2. Migration `0032` (RPCs, incl. the `acc_void_bill` redefinition).
3. Domain `purchasing.ts` + Zod schemas + unit tests (TDD: tests first).
4. `lib/db/types.ts` rows + `lib/services/purchasing.ts`.
5. Server actions.
6. UI: list → new/edit → detail with dialogs → received-not-billed → settings → sidebar.
7. `scripts/verify-purchasing.mjs`; apply migrations via `scripts/migrate.mjs`; full gate clean.
