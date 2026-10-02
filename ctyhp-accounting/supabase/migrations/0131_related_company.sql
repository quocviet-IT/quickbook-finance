-- ============================================================================
-- 0131 — Related companies: money between companies the same owners run.
--
-- Money sent to a sister company is a loan to it, and money received from one
-- is a loan from it — never income or a cost. Coded singly in each book, the
-- same movement becomes income in one and a cost in the other. Each company
-- lists its related companies with the words its bank prints for them and the
-- one account that carries what each owes or is owed: money out debits it,
-- money in credits it. lib/domain/related-companies.ts recognises a line
-- naming one, in or out, before any rule or history; it posts through
-- acc_categorise_bank_transaction as before.
--
-- Nothing existing changes.
-- ============================================================================

set search_path = public;

create table if not exists acc_related_company (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  account_id   uuid not null unique references acc_account (id),
  match_words  text not null,
  is_active    boolean not null default true,
  created_by   uuid references auth.users (id),
  created_at   timestamptz not null default now(),
  updated_by   uuid references auth.users (id),
  updated_at   timestamptz not null default now(),
  constraint acc_related_company_name_ck
    check (length(btrim(name)) between 1 and 120),
  constraint acc_related_company_words_ck
    check (btrim(match_words) <> '' and length(match_words) <= 200)
);

create unique index if not exists acc_related_company_name_key
  on acc_related_company (lower(btrim(name)));

drop trigger if exists acc_related_company_actor_stamp on acc_related_company;
create trigger acc_related_company_actor_stamp
  before insert or update on acc_related_company
  for each row execute function acc_stamp_actor();

drop trigger if exists acc_related_company_atomic_audit on acc_related_company;
create trigger acc_related_company_atomic_audit
  after insert or update or delete on acc_related_company
  for each row execute function acc_audit_row_change();

alter table acc_related_company enable row level security;

drop policy if exists acc_related_company_sel on acc_related_company;
create policy acc_related_company_sel on acc_related_company
  for select using (acc_is_staff() or acc_current_role() = 'viewer');
drop policy if exists acc_related_company_ins on acc_related_company;
create policy acc_related_company_ins on acc_related_company
  for insert with check (acc_is_staff());
drop policy if exists acc_related_company_upd on acc_related_company;
create policy acc_related_company_upd on acc_related_company
  for update using (acc_is_staff()) with check (acc_is_staff());
drop policy if exists acc_related_company_del on acc_related_company;
create policy acc_related_company_del on acc_related_company
  for delete using (acc_is_staff());

revoke all on acc_related_company from public, anon;
grant select, insert, update, delete on acc_related_company to authenticated;
grant all on acc_related_company to service_role;
