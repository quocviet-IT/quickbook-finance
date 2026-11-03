-- ============================================================================
-- 0187  Posting defaults: where new documents land unless someone says (3.01)
--
-- Every form that moves money asked for its accounts afresh. Receive payment
-- and Pay Bills started with no account at all, an expense or a bill line with
-- no expense account, an invoice line without an item with no income account,
-- and the vendor's own default expense account, kept on the vendor since 0011 (0170 lets its screen set it),
-- was never offered. The company now keeps four defaults, as the approved
-- design's Company tab does:
--
--   deposit_account_id   where money in lands: Receive payment, Sales receipt
--   pay_from_account_id  where money out comes from: Pay Bills, Expenses
--   income_account_id    an invoice, estimate or sales receipt line with no item
--   expense_account_id   a bill or expense line, when the vendor has none
--
-- They only fill a form. Each document keeps whatever it was posted to, so
-- changing a default never rewrites a posted figure, and every form still
-- shows the account before anything is saved.
--
-- One row, read by anyone in the company, written only through
-- acc_save_posting_defaults: settings.manage, the account checked against the
-- same rule the form uses to offer it, and an audit entry with before and after.
-- Nothing existing is changed.
-- ============================================================================
set search_path = public;

create table if not exists acc_posting_default (
  id                  boolean primary key default true check (id),
  deposit_account_id  uuid references acc_account (id) on delete set null,
  pay_from_account_id uuid references acc_account (id) on delete set null,
  income_account_id   uuid references acc_account (id) on delete set null,
  expense_account_id  uuid references acc_account (id) on delete set null,
  updated_at          timestamptz not null default now(),
  updated_by          uuid references auth.users (id)
);

alter table acc_posting_default enable row level security;

drop policy if exists acc_posting_default_read on acc_posting_default;
create policy acc_posting_default_read on acc_posting_default
  for select using (acc_current_role() is not null);

revoke all on acc_posting_default from public, anon;
revoke insert, update, delete, truncate on acc_posting_default from authenticated;
grant select on acc_posting_default to authenticated;
grant all on acc_posting_default to service_role;

create or replace function acc_save_posting_defaults(
  p_deposit_account_id  uuid,
  p_pay_from_account_id uuid,
  p_income_account_id   uuid,
  p_expense_account_id  uuid
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_before jsonb;
  v_after  jsonb;
begin
  if not acc_has_permission('settings.manage') then
    raise exception 'You do not have permission to change company settings';
  end if;

  -- Each account by the rule its form offers it by, active and open to posting.
  if p_deposit_account_id is not null and not exists (
    select 1 from acc_account a
     where a.id = p_deposit_account_id and a.is_posting_account and a.status = 'active'
       and (a.account_type = 'bank' or a.detail_type = 'undeposited_funds' or a.account_code = '1210')
  ) then
    raise exception 'Money in can land only in an active bank account or Undeposited Funds';
  end if;
  if p_pay_from_account_id is not null and not exists (
    select 1 from acc_account a
     where a.id = p_pay_from_account_id and a.is_posting_account and a.status = 'active'
       and a.account_type in ('bank', 'credit_card')
  ) then
    raise exception 'Money out can come only from an active bank or credit card account';
  end if;
  if p_income_account_id is not null and not exists (
    select 1 from acc_account a
     where a.id = p_income_account_id and a.is_posting_account and a.status = 'active'
       and a.account_type = 'income'
  ) then
    raise exception 'The default income account must be an active income account';
  end if;
  if p_expense_account_id is not null and not exists (
    select 1 from acc_account a
     where a.id = p_expense_account_id and a.is_posting_account and a.status = 'active'
       and a.account_type in ('expense', 'cost_of_goods_sold', 'other_expense')
  ) then
    raise exception 'The default expense account must be an active expense or cost of goods sold account';
  end if;

  select to_jsonb(d) - 'updated_at' - 'updated_by' into v_before from acc_posting_default d where d.id;

  insert into acc_posting_default
    (id, deposit_account_id, pay_from_account_id, income_account_id, expense_account_id, updated_at, updated_by)
  values
    (true, p_deposit_account_id, p_pay_from_account_id, p_income_account_id, p_expense_account_id, now(), auth.uid())
  on conflict (id) do update
     set deposit_account_id  = excluded.deposit_account_id,
         pay_from_account_id = excluded.pay_from_account_id,
         income_account_id   = excluded.income_account_id,
         expense_account_id  = excluded.expense_account_id,
         updated_at          = excluded.updated_at,
         updated_by          = excluded.updated_by;

  select to_jsonb(d) - 'updated_at' - 'updated_by' into v_after from acc_posting_default d where d.id;

  insert into acc_audit_log (table_name, record_id, action, actor_id, before_json, after_json)
    values ('acc_posting_default', null, case when v_before is null then 'insert' else 'update' end,
            auth.uid(), v_before, v_after);
end;
$$;

revoke all on function acc_save_posting_defaults(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function acc_save_posting_defaults(uuid, uuid, uuid, uuid) to authenticated, service_role;
