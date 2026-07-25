# Module G3 — Vendor Tax Profile and 1099 Preparation Support

- **Date:** 2026-07-25
- **Status:** Approved for planning
- **Owner:** AI Team — CTYHP
- **Related:** `PRD/PRD_US_Accounting_Web_App.md` (US-FR-050, §3.2 "Vendor tax information and
  1099 preparation support", Phase 3), `US_ACCOUNTING_USER_MANUAL/04_Vendors_Payables_and_1099.md`,
  and Module C (`2026-07-25-users-permissions-approval-design.md`) whose permission and approval
  engine this module plugs into

## 1. Goal & Scope

Track what the business must know about a vendor for US information reporting, and produce the
review dataset and exception queue for a tax year. This is the slice of Module G left after
purchase orders (G1) and inventory (G2).

### In scope
- **Vendor tax profile** (US-FR-050): W-9 collection status and dates, tax classification,
  reporting (legal) name, a **masked** taxpayer-identifier reference, the payee address the form
  needs, 1099 eligibility with its reporting box, and a documented override with its reason.
  **Versioned** — each save writes a new version, so the history of a sensitive field is inspectable
  without a separate audit trail to keep in sync.
- **Elevated control** per the manual: saving a tax profile needs its own permission
  (`vendor.tax_manage`, seeded to admin only) plus a mandatory reason, and it is wired as a
  **sixth controlled action** in Module C's approval engine, so an installation can require
  independent approval of tax-information changes.
- **1099 preparation for a tax year** (US-FR-050): per vendor, the amount **paid** during the
  calendar year, its configured box and threshold, whether it is reportable, and an exception list.
  Plus a control total that reconciles to the underlying payment documents.
- **Exception queue**: missing W-9, expired W-9, missing taxpayer identifier, missing address,
  missing reporting name, over threshold but not marked eligible, marked eligible but under
  threshold, and a classification that normally is not reportable (a corporation) marked eligible.
- CSV export of the review dataset.

### Out of scope (own cycles / later, and deliberately so)
- **Filing.** No e-file, no IRS FIRE/IRIS transmission, no printed form layout, no TIN matching
  service, no state reporting. The manual is explicit that the product must not claim filing
  compliance without professional review, so the page says exactly that and produces review data.
- **Backup withholding** (24% when a TIN is missing) — a payment-time deduction with its own
  liability account and deposit schedule. Not modelled; the exception queue flags the missing TIN
  that would trigger it.
- **Correcting a filed 1099** and prior-year amendments.
- Storing the W-9 document itself → Module K (Documents). Status, dates, and a reference are kept.
- Automatic classification of *what* a payment was for (services vs merchandise). The box comes
  from the vendor's configured default; per-transaction box overrides are a later cycle. §3 records
  what that means for accuracy.
- 1099-K, 1098, W-2, and contractor payroll.

## 2. Cash basis, and where the numbers come from

A 1099 reports **what was paid** in the calendar year, not what was billed. So the dataset sums,
per vendor, over `[year-01-01, year-12-31]`:

- posted bill payments (`acc_bill_payment`, `status <> 'void'`), and
- posted immediate expenses (`acc_expense`, `status = 'posted'`) that name the vendor.

Amounts convert to base currency at the document date via the existing `acc_to_base_minor`, so a
foreign-currency payment reports in USD.

Refunds and vendor credits are **not** subtracted: a vendor credit reduces a future payment, so the
payment total already reflects it, and subtracting again would double-count. A customer-style
refund from a vendor is not modelled as a negative payment today; if one is ever added it must be
included here, and this paragraph is the note that says so.

## 3. Accuracy limitation (stated plainly)

The box on the vendor's profile applies to **every** payment to that vendor in the year. A vendor
who is paid for both services (reportable) and merchandise (not reportable) will therefore be
over-reported by this dataset. That is why the output is a review dataset with an exception queue
rather than a filing: the reviewer adjusts before anything is filed. Per-transaction box tagging is
the fix and is a later cycle. The page states this limitation rather than leaving the reviewer to
discover it.

## 4. Data model (migration `0038`)

New enums: `acc_w9_status` (`not_requested`, `requested`, `on_file`, `expired`),
`acc_tax_classification` (`individual`, `sole_proprietor`, `partnership`, `c_corporation`,
`s_corporation`, `llc`, `trust_estate`, `exempt_payee`, `other`),
`acc_tin_type` (`ssn`, `ein`, `itin`).

**`acc_vendor_tax_profile`** — versioned, current = highest `version` per vendor:
`id`, `vendor_id → acc_vendor`, `version int`, `w9_status acc_w9_status default 'not_requested'`,
`w9_received_date date`, `w9_expires_date date`, `classification acc_tax_classification`,
`reporting_name text`, `tin_ref text` (**masked in the UI, never written to the audit log** — the
same rule `acc_company_setting_version.ein_ref` follows), `tin_type acc_tin_type`,
`address_line1`, `address_line2`, `city`, `region`, `postal_code`, `country default 'US'`,
`is_1099_eligible boolean default false`, `box_code text → acc_1099_box`,
`eligibility_override boolean default false`, `override_reason text`, `change_reason text not null`,
`created_by`, `created_at`, `unique (vendor_id, version)`.

**`acc_1099_box`** — `code text primary key`, `form text` (`1099-NEC` / `1099-MISC`),
`box_label text`, `threshold_minor bigint not null`, `is_active boolean default true`. Seeded:
`NEC-1` Nonemployee compensation $600, `MISC-1` Rents $600, `MISC-2` Royalties $10,
`MISC-3` Other income $600, `MISC-6` Medical and health care payments $600,
`MISC-10` Gross proceeds paid to an attorney $600. Thresholds are configuration, not code, because
they change.

Module C additions: two permission keys (`vendor.tax_manage`, `report.1099`, both enforced) with
matrix rows — `vendor.tax_manage` **admin only** by default because the manual calls it elevated;
an admin can grant it to accountants in the matrix. One approval policy `vendor_tax_profile`
(on/off, seeded disabled).

RLS: `acc_1099_box` readable by any role, writable by admin. `acc_vendor_tax_profile` readable by
staff only (it holds a taxpayer identifier — a viewer has no business reading it) and has **no**
client write policy; saving goes through the RPC.

## 5. Functions (migration `0039`)

- `acc_vendor_tax_profile_current(p_vendor_id uuid)` — the highest version, or nothing.
- `acc_save_vendor_tax_profile(p_vendor_id, p_w9_status, p_w9_received_date, p_w9_expires_date, p_classification, p_reporting_name, p_tin_ref, p_tin_type, p_address_line1, p_address_line2, p_city, p_region, p_postal_code, p_country, p_is_1099_eligible, p_box_code, p_eligibility_override, p_override_reason, p_reason) returns uuid` —
  requires `vendor.tax_manage`; requires a reason; requires an override reason whenever
  `eligibility_override` is on; inserts the next version. Guarded by the approval engine
  (`vendor_tax_profile`, amount 0) using the same dispatch-flag pattern as the other five
  controlled actions, so an enabled policy routes the change through an approval. The audit row
  records **which fields changed, never the identifier itself**.
- `acc_approve_request` — redefined to add the `vendor_tax_profile` dispatch branch.
- `acc_1099_summary(p_year int)` — one row per vendor with any payment in the year **or** an
  eligible profile: vendor id and display name, reporting name, classification, w9 status and
  expiry, whether a TIN is on file (boolean — the report never returns the identifier), whether the
  address is complete, box code and its threshold, `paid_minor` (base currency), and
  `eligibility_override`. Requires `report.1099`. Read-only, `stable`.
- `acc_1099_control_total(p_year int)` — the same population's total from the payment documents
  directly, so the report can prove the per-vendor rows add up to what was paid.

## 6. Pure domain (`lib/domain/vendorTax.ts`, unit-tested)

- `maskTin(tinRef: string | null): string` — `null` → `"—"`; otherwise the last four characters
  only, as `"•••-••-1234"` / `"••-•••1234"` by `tinType`. The single definition of how an
  identifier is displayed, so no component invents its own.
- `w9Effective(status, expiresOn, asOf): "on_file" | "expired" | "missing"` — an `on_file` status
  with a past expiry is `expired`, which is what makes the exception queue honest.
- `assess1099(row, box): { reportable: boolean; exceptions: Exception[] }` where
  `Exception = { code; severity: "blocker" | "warning"; message }`:
  - **blocker** — eligible and over threshold but no TIN, no reporting name, or an incomplete
    address; W-9 missing or expired.
  - **warning** — paid over the threshold but not marked eligible; marked eligible but under the
    threshold; a corporation marked eligible without an override.
  - `reportable = is_1099_eligible && paid >= threshold` (a documented override forces `true`).
- `sum1099Reportable(rows): number` and `ties(rowsTotal, controlTotal): boolean`.
- `toCsv(rows, columns)` added to `lib/csv.ts` (the file currently only parses) — quoting, embedded
  commas and quotes, CRLF.
- Zod: `vendorTaxProfileSchema` (reason required; override reason required when overriding; TIN
  reference max length; box code required when eligible), `taxYearSchema`.

## 7. Services / Actions / UI

- `lib/services/vendorTax.ts` — `getVendorTaxProfile`, `listVendorTaxProfileVersions`,
  `saveVendorTaxProfile`, `get1099Summary(year)` (returns rows plus the control total and a
  `tiesOut` flag), `list1099Boxes`.
- Vendors page: a **Tax profile** action per vendor opening a drawer — W-9 status and dates,
  classification, reporting name, masked TIN with a "replace" input, address, eligibility and box,
  override with reason, and the mandatory change reason; plus the version history below. Read-only
  for anyone without `vendor.tax_manage`, with the reason shown.
- `/reports/1099` — tax-year picker, the dataset table (vendor, reporting name, classification,
  W-9, TIN on file, box, paid, reportable, exceptions as tags), a summary bar (count reportable,
  total reportable, count with blockers), the reconciliation line against the control total, a CSV
  export, and the review-not-filing disclaimer.
- Nav: **1099 Review** under Reports.

## 8. Security & audit
- The taxpayer identifier is never returned by the 1099 report (only "on file: yes/no") and never
  written to the audit log; the profile table is staff-read-only and has no client write path.
- Every profile save carries a reason, a version, and an actor; nothing is updated in place.
- `report.1099` gates the dataset, so a viewer cannot pull a vendor list with tax attributes.

## 9. Testing (per `ctyhp-accounting/CLAUDE.md`)
- **Unit** (`tests/unit/vendor-tax.test.ts`): `maskTin` for SSN, EIN, null, and a short value;
  `w9Effective` for on-file, expired-by-a-day, and missing; `assess1099` for the clean reportable
  case, over-threshold-not-eligible, eligible-under-threshold, missing TIN blocker, expired W-9
  blocker, corporation warning, and an override forcing reportable; `sum1099Reportable`; `toCsv`
  quoting a value containing a comma, a quote, and a newline; the Zod rejection paths.
- **E2E verify** (`scripts/verify-vendor-tax.mjs`, over the pooler, self-cleaning): save a profile
  and assert version 1 then version 2 with history intact and the TIN absent from the audit log;
  assert a save without `vendor.tax_manage` is refused; enable the `vendor_tax_profile` policy and
  assert a direct save is refused, then submitted and approved through Module C's engine; pay a
  vendor $700 across a bill payment and an expense in one year and $100 in the next, then assert
  `acc_1099_summary` reports $700 for the first year and $100 for the second, that the row is
  reportable only in the first, that the control total ties, and that a vendor with no payments and
  no eligibility does not appear.
- Full `npm run build && npm test && npm run typecheck && npm run lint` clean, real output pasted.

## 10. Build sequence
1. Migration `0038` (enums, profile table, box catalog, permission and policy rows, RLS).
2. Migration `0039` (profile save with guard, current-version read, 1099 summary and control total,
   `acc_approve_request` branch).
3. Domain `vendorTax.ts` + `toCsv` + Zod + unit tests (tests first).
4. `lib/db/types.ts` + `lib/services/vendorTax.ts`.
5. Server actions.
6. UI: vendor tax drawer → 1099 review report → nav.
7. `scripts/verify-vendor-tax.mjs`; apply migrations; full gate clean.
