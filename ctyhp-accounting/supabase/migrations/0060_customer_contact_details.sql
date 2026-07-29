-- Customer contact and billing address (US-FR-030).
--
-- An invoice a customer can accept needs a "Bill to" block, and the customer
-- record had only a name and an email. Columns are nullable: every existing
-- customer stays valid, and an invoice for a customer without an address still
-- prints, just without those lines.

alter table acc_customer
  add column if not exists contact_name  text,
  add column if not exists phone         text,
  add column if not exists address_line1 text,
  add column if not exists address_line2 text,
  add column if not exists city          text,
  add column if not exists region        text,
  add column if not exists postal_code   text,
  add column if not exists country       text;

comment on column acc_customer.region is
  'State or province. Named region to match acc_company_setting_version.';

-- Changes to customer master data already flow through the atomic audit
-- trigger installed by 0058 (acc_customer_atomic_audit), so the new columns are
-- audited with no further work.

notify pgrst, 'reload schema';
