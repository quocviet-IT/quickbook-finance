-- ============================================================================
-- 0098  A label of your own on a bank line
--
-- Asked for in feedback 773843b7 on /banking: "please add another column where
-- I can freely categorized a bank transaction". The screenshot showed their
-- vocabulary — Deposit, Inventory, Website Platform, Payroll — not ours.
--
-- Two things this deliberately is not:
--
--   * It is not `acc_bank_transaction.category`. That column holds what the
--     bank feed said, and the screen already shows it under the description.
--     Writing a person's label there would destroy imported data.
--   * It is not a posting. A bank line becomes an accounting fact by being
--     matched to a document or settled, and that path keeps its guards. A
--     dropdown that posted would be a second way into the ledger.
--
-- The immutability trigger from 0010 is untouched: it guards the amount, date,
-- description, reference and hash, and a label is none of those.
-- ============================================================================

set search_path = public;

create table if not exists acc_bank_category (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) between 1 and 60),
  is_active  boolean not null default true,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now()
);

-- One label per name, whatever case it was typed in: "Inventory" and
-- "inventory" are the same category to everyone except a computer.
create unique index if not exists acc_bank_category_name_key
  on acc_bank_category (lower(btrim(name)));

drop trigger if exists acc_bank_category_actor_stamp on acc_bank_category;
create trigger acc_bank_category_actor_stamp
  before insert or update on acc_bank_category
  for each row execute function acc_stamp_actor();

alter table acc_bank_transaction
  add column if not exists bank_category_id uuid
    references acc_bank_category (id) on delete set null;
create index if not exists acc_bank_txn_category_idx
  on acc_bank_transaction (bank_category_id);

alter table acc_bank_category enable row level security;

drop policy if exists acc_bank_category_sel on acc_bank_category;
create policy acc_bank_category_sel on acc_bank_category
  for select using (acc_is_staff() or acc_current_role() = 'viewer');
drop policy if exists acc_bank_category_ins on acc_bank_category;
create policy acc_bank_category_ins on acc_bank_category
  for insert with check (acc_is_staff());
drop policy if exists acc_bank_category_upd on acc_bank_category;
create policy acc_bank_category_upd on acc_bank_category
  for update using (acc_is_staff());

revoke all on acc_bank_category from public, anon;
grant select, insert, update on acc_bank_category to authenticated;
grant all on acc_bank_category to service_role;

-- --- Creating a label --------------------------------------------------------
create or replace function acc_upsert_bank_category(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_id   uuid;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to manage bank categories';
  end if;
  if length(v_name) = 0 then raise exception 'A category name is required'; end if;
  if length(v_name) > 60 then
    raise exception 'A category name cannot exceed 60 characters';
  end if;

  -- Typing the same name on two rows must produce one label, not two.
  select id into v_id from acc_bank_category
   where lower(btrim(name)) = lower(v_name);
  if v_id is not null then
    update acc_bank_category set is_active = true where id = v_id and not is_active;
    return v_id;
  end if;

  insert into acc_bank_category (name) values (v_name) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function acc_upsert_bank_category(text) from public, anon;
grant execute on function acc_upsert_bank_category(text) to authenticated, service_role;

-- --- Attaching one to a bank line -------------------------------------------
create or replace function acc_set_bank_transaction_category(
  p_txn_id uuid,
  p_category_id uuid
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to categorize bank transactions';
  end if;
  if not exists (select 1 from acc_bank_transaction where id = p_txn_id) then
    raise exception 'Bank transaction not found';
  end if;
  if p_category_id is not null and not exists (
    select 1 from acc_bank_category where id = p_category_id and is_active
  ) then
    raise exception 'That category does not exist';
  end if;

  -- One column, named once: this function is the whitelist. Nothing here can
  -- reach an amount, and the 0010 immutability trigger still sees no change to
  -- the fields it guards.
  update acc_bank_transaction
     set bank_category_id = p_category_id
   where id = p_txn_id;
end;
$$;

revoke all on function acc_set_bank_transaction_category(uuid, uuid) from public, anon;
grant execute on function acc_set_bank_transaction_category(uuid, uuid)
  to authenticated, service_role;
