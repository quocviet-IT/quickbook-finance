-- ============================================================================
-- Module G3 — Vendor tax profile and 1099 preparation support (schema).
--
-- The profile is versioned rather than updated in place: a taxpayer identifier
-- and a 1099 eligibility flag are exactly the fields an auditor asks about, so
-- the history is the table itself. tin_ref follows the same rule as
-- acc_company_setting_version.ein_ref — masked in the UI, never written to the
-- audit log, and never returned by the 1099 report.
--
-- Enums are created here and first used by the functions in 0039.
-- ============================================================================

create type acc_w9_status as enum ('not_requested', 'requested', 'on_file', 'expired');
create type acc_tin_type  as enum ('ssn', 'ein', 'itin');
create type acc_tax_classification as enum (
  'individual', 'sole_proprietor', 'partnership', 'c_corporation', 's_corporation',
  'llc', 'trust_estate', 'exempt_payee', 'other'
);

-- ----------------------------------------------------------------------------
-- Reporting boxes and their thresholds. Configuration, not code: thresholds
-- change, and a deployment may need a box this list does not have.
-- ----------------------------------------------------------------------------
create table acc_1099_box (
  code            text primary key,
  form            text not null,
  box_label       text not null,
  threshold_minor bigint not null check (threshold_minor >= 0),
  is_active       boolean not null default true
);

insert into acc_1099_box (code, form, box_label, threshold_minor) values
  ('NEC-1',   '1099-NEC',  'Box 1 — Nonemployee compensation',            60000),
  ('MISC-1',  '1099-MISC', 'Box 1 — Rents',                               60000),
  ('MISC-2',  '1099-MISC', 'Box 2 — Royalties',                            1000),
  ('MISC-3',  '1099-MISC', 'Box 3 — Other income',                        60000),
  ('MISC-6',  '1099-MISC', 'Box 6 — Medical and health care payments',    60000),
  ('MISC-10', '1099-MISC', 'Box 10 — Gross proceeds paid to an attorney', 60000);

-- ----------------------------------------------------------------------------
-- The versioned vendor tax profile. Current = highest version for the vendor.
-- ----------------------------------------------------------------------------
create table acc_vendor_tax_profile (
  id                    uuid primary key default gen_random_uuid(),
  vendor_id             uuid not null references acc_vendor (id) on delete cascade,
  version               int not null,
  w9_status             acc_w9_status not null default 'not_requested',
  w9_received_date      date,
  w9_expires_date       date,
  classification        acc_tax_classification,
  reporting_name        text,
  tin_ref               text,                       -- masked in the UI; never audited
  tin_type              acc_tin_type,
  address_line1         text,
  address_line2         text,
  city                  text,
  region                text,
  postal_code           text,
  country               text not null default 'US',
  is_1099_eligible      boolean not null default false,
  box_code              text references acc_1099_box (code),
  eligibility_override  boolean not null default false,
  override_reason       text,
  change_reason         text not null,
  created_by            uuid references auth.users (id),
  created_at            timestamptz not null default now(),
  unique (vendor_id, version)
);
create index acc_vendor_tax_profile_vendor_idx on acc_vendor_tax_profile (vendor_id, version desc);

-- ----------------------------------------------------------------------------
-- Module C wiring: an elevated permission for tax data, a permission for the
-- report, and a controlled action so an installation can require independent
-- approval of a tax-information change (seeded disabled, like the others).
-- ----------------------------------------------------------------------------
insert into acc_permission (key, label, category, description, is_enforced) values
  ('vendor.tax_manage', 'Manage vendor tax profiles', 'Purchases',
   'Change W-9 status, taxpayer identifier, and 1099 eligibility', true),
  ('report.1099', 'Read the 1099 review dataset', 'Purchases',
   'Run the 1099 preparation report for a tax year', true);

-- Elevated by default (the user manual calls it elevated): admin only. An admin
-- can grant it to accountants from the permission matrix.
insert into acc_role_permission (role, permission_key, allowed) values
  ('admin',      'vendor.tax_manage', true),
  ('accountant', 'vendor.tax_manage', false),
  ('viewer',     'vendor.tax_manage', false),
  ('admin',      'report.1099',       true),
  ('accountant', 'report.1099',       true),
  ('viewer',     'report.1099',       false);

insert into acc_approval_policy (action_key, label, description) values
  ('vendor_tax_profile', 'Vendor tax profile change',
   'Changing W-9 status, taxpayer identifier, or 1099 eligibility');

-- ----------------------------------------------------------------------------
-- RLS. The box catalog is reference data. The profile holds a taxpayer
-- identifier, so a viewer may not read it at all, and there is no client write
-- path — saving goes through the SECURITY DEFINER function in 0039.
-- ----------------------------------------------------------------------------
alter table acc_1099_box             enable row level security;
alter table acc_vendor_tax_profile   enable row level security;

create policy acc_1099_box_read  on acc_1099_box for select using (acc_current_role() is not null);
create policy acc_1099_box_write on acc_1099_box for all using (acc_is_admin()) with check (acc_is_admin());

create policy acc_vendor_tax_profile_read on acc_vendor_tax_profile
  for select using (acc_is_staff());
