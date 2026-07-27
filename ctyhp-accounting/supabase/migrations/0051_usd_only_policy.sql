-- ============================================================================
-- Single-currency policy: this company operates and reports only in USD.
--
-- Historical currency catalog rows may remain for referential safety, but
-- every operational/master-data currency field is constrained to USD.
-- ============================================================================

-- Fail rather than silently reinterpret any historical non-USD amount.
do $$
declare
  v_column record;
  v_non_usd bigint;
begin
  for v_column in
    select table_name, column_name
      from information_schema.columns
     where table_schema = 'public'
       and column_name in ('currency_code', 'base_currency_code')
     order by table_name, column_name
  loop
    execute format(
      'select count(*) from %I where %I is not null and %I <> %L',
      v_column.table_name,
      v_column.column_name,
      v_column.column_name,
      'USD'
    ) into v_non_usd;
    if v_non_usd > 0 then
      raise exception 'USD-only migration blocked: %.% contains % non-USD row(s)',
        v_column.table_name, v_column.column_name, v_non_usd;
    end if;
  end loop;
end;
$$;

-- Nullable master-data currency fields previously meant "use the base
-- currency." Materialize that value so every record is explicit.
update acc_account set currency_code = 'USD' where currency_code is null;
update acc_customer set currency_code = 'USD' where currency_code is null;
update acc_vendor set currency_code = 'USD' where currency_code is null;

alter table acc_account
  alter column currency_code set default 'USD',
  alter column currency_code set not null;
alter table acc_customer
  alter column currency_code set default 'USD',
  alter column currency_code set not null;
alter table acc_vendor
  alter column currency_code set default 'USD',
  alter column currency_code set not null;

-- Add one consistently named check to every table carrying a transaction or
-- base currency. Constraint names only need to be unique within each table.
do $$
declare
  v_column record;
begin
  for v_column in
    select table_name, column_name
      from information_schema.columns
     where table_schema = 'public'
       and column_name in ('currency_code', 'base_currency_code')
     order by table_name, column_name
  loop
    if not exists (
      select 1
        from pg_constraint c
        join pg_class t on t.oid = c.conrelid
        join pg_namespace n on n.oid = t.relnamespace
       where n.nspname = 'public'
         and t.relname = v_column.table_name
         and c.conname = 'acc_usd_currency_check'
    ) then
      execute format(
        'alter table %I add constraint acc_usd_currency_check check (%I = %L) not valid',
        v_column.table_name,
        v_column.column_name,
        'USD'
      );
      execute format(
        'alter table %I validate constraint acc_usd_currency_check',
        v_column.table_name
      );
    end if;
  end loop;
end;
$$;

-- USD must remain the sole base currency. Legacy catalog rows may be retained
-- but cannot be activated as the base or expanded with new foreign currencies.
update acc_currency set is_base = (code = 'USD');

create or replace function acc_enforce_usd_currency_catalog()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.code = 'USD' then
      raise exception 'USD is the required company currency and cannot be deleted';
    end if;
    return old;
  end if;

  if new.code <> 'USD' and tg_op = 'INSERT' then
    raise exception 'This company supports USD only';
  end if;
  if new.code <> 'USD' and new.is_base then
    raise exception 'USD must remain the base currency';
  end if;
  if new.code = 'USD' and not new.is_base then
    raise exception 'USD must remain the base currency';
  end if;
  return new;
end;
$$;

drop trigger if exists acc_currency_usd_only on acc_currency;
create trigger acc_currency_usd_only
before insert or update or delete on acc_currency
for each row execute function acc_enforce_usd_currency_catalog();
