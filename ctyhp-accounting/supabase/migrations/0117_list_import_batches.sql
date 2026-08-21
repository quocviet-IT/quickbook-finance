-- ============================================================================
-- 0117  Every import is on the record, and every one can be taken back
--
-- Asked for straight after 0116 put invoices on the register: the chart of
-- accounts, contacts and products tabs need the same thing.
--
-- Two rules decide what undo can honestly do here, and they are not the ones
-- that applied to invoices.
--
-- **Only what the import created.** These importers update as well as create:
-- an existing customer keeps its name and has its blank fields filled in. The
-- old values were never captured, so there is nothing to restore, and an undo
-- claiming to reverse an update would be inventing the past. Undo removes the
-- records the import brought into existence and leaves the rest alone.
--
-- **Only what nothing else is using.** An account imported last week may have
-- a journal line posted against it today; a customer may be named on an
-- invoice. Rather than list every table that could point at one -- a list that
-- would rot the first time somebody adds a table -- each delete is tried
-- inside a savepoint and a foreign key violation is caught. The database
-- already knows every reference; asking it is simpler and more correct than
-- keeping a second copy of the answer.
-- ============================================================================

set search_path = public;

-- --- Room for the remaining kinds -------------------------------------------
-- Listed whole, every time: a check constraint is replaced, not extended, and
-- omitting a value already in use makes the migration refuse a company that is
-- already using it.
alter table acc_import_batch drop constraint if exists acc_import_batch_source_check;
alter table acc_import_batch add constraint acc_import_batch_source_check
  check (source in ('wave_ledger', 'transactions', 'invoices',
                    'chart_of_accounts', 'customers', 'vendors', 'items'));

alter table acc_import_batch_document
  drop constraint if exists acc_import_batch_document_document_kind_check;
alter table acc_import_batch_document add constraint acc_import_batch_document_document_kind_check
  check (document_kind in ('invoice', 'account', 'customer', 'vendor', 'item'));

-- --- The importers say what they created ------------------------------------
-- Bodies taken from the live functions and changed in one way only: each
-- insert that counts a create now reports the row it made. Dropped first
-- because a `returns table` cannot change shape in place.
drop function if exists acc_import_accounts(jsonb);
drop function if exists acc_import_contacts(jsonb, text);
drop function if exists acc_import_items(jsonb);

create or replace function acc_import_accounts(p_rows jsonb)

returns table(created integer, updated integer, skipped integer, conflicts text, created_ids uuid[])

language plpgsql
security definer
set search_path = public
as $$
declare
  v_new uuid;
  v_ids uuid[] := array[]::uuid[];
  rec         record;
  v_created   int := 0;
  v_updated   int := 0;
  v_skipped   int := 0;
  v_conflicts text[] := array[]::text[];
  v_existing  acc_account;
  v_type      acc_account_type;
begin
  if not acc_is_admin() then raise exception 'Only an admin can import a chart of accounts'; end if;

  for rec in
    select r->>'account_code' as code,
           r->>'name' as name,
           r->>'account_type' as account_type,
           nullif(r->>'description', '') as description
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
  loop
    if coalesce(btrim(rec.code), '') = '' or coalesce(btrim(rec.name), '') = '' then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    v_type := rec.account_type::acc_account_type;

    select * into v_existing from acc_account where account_code = rec.code;

    if not found then
      insert into acc_account (account_code, name, account_type, description,
                               currency_code, is_posting_account, status)
      values (rec.code, rec.name, v_type, rec.description,
              (select code from acc_currency where is_base limit 1), true, 'active')
        returning id into v_new;
      v_created := v_created + 1;
      v_ids := v_ids || v_new;

    elsif v_existing.account_type <> v_type then
      -- The same number, a different kind of account. Left exactly as it was.
      v_conflicts := v_conflicts || format(
        '%s is %s here but %s in the file (%s) — left unchanged',
        rec.code, v_existing.account_type, v_type, rec.name);
      v_skipped := v_skipped + 1;

    else
      update acc_account
         set name = rec.name,
             description = coalesce(rec.description, description)
       where id = v_existing.id;
      v_updated := v_updated + 1;
    end if;
  end loop;

  return query select v_created, v_updated, v_skipped,
    case when array_length(v_conflicts, 1) is null then null
         else array_to_string(v_conflicts, E'\n') end, v_ids;
end;
$$;

create or replace function acc_import_contacts(p_rows jsonb, p_kind text)

returns table(created integer, updated integer, skipped integer, created_ids uuid[])

language plpgsql
security definer
set search_path = public
as $$
declare
  v_new uuid;
  v_ids uuid[] := array[]::uuid[];
  rec       record;
  v_created int := 0;
  v_updated int := 0;
  v_skipped int := 0;
  v_id      uuid;
begin
  if not acc_is_staff() then raise exception 'Not authorized to import contacts'; end if;
  if p_kind not in ('customer', 'vendor') then raise exception 'Unknown contact kind: %', p_kind; end if;

  for rec in
    select btrim(r->>'name') as name,
           nullif(btrim(coalesce(r->>'email', '')), '') as email,
           nullif(btrim(coalesce(r->>'contact_name', '')), '') as contact_name,
           nullif(btrim(coalesce(r->>'phone', '')), '') as phone,
           nullif(btrim(coalesce(r->>'city', '')), '') as city,
           nullif(btrim(coalesce(r->>'region', '')), '') as region,
           nullif(btrim(coalesce(r->>'postal_code', '')), '') as postal_code,
           nullif(btrim(coalesce(r->>'country', '')), '') as country
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
  loop
    if coalesce(rec.name, '') = '' then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if p_kind = 'customer' then
      select id into v_id from acc_customer where lower(name) = lower(rec.name);
      if v_id is null then
        insert into acc_customer (name, email, contact_name, phone, city, region, postal_code,
                                  country, currency_code)
        values (rec.name, rec.email, rec.contact_name, rec.phone, rec.city, rec.region,
                rec.postal_code, rec.country, (select code from acc_currency where is_base limit 1))
          returning id into v_new;
        v_created := v_created + 1;
        v_ids := v_ids || v_new;
      else
        update acc_customer
           set email = coalesce(rec.email, email),
               contact_name = coalesce(rec.contact_name, contact_name),
               phone = coalesce(rec.phone, phone),
               city = coalesce(rec.city, city),
               region = coalesce(rec.region, region),
               postal_code = coalesce(rec.postal_code, postal_code),
               country = coalesce(rec.country, country)
         where id = v_id;
        v_updated := v_updated + 1;
      end if;
    else
      -- Vendors carry a name, an email and a phone number. Address columns
      -- from the file are read and discarded rather than silently failing.
      select id into v_id from acc_vendor where lower(name) = lower(rec.name);
      if v_id is null then
        insert into acc_vendor (name, email, phone, currency_code)
        values (rec.name, rec.email, rec.phone,
                (select code from acc_currency where is_base limit 1))
          returning id into v_new;
        v_created := v_created + 1;
        v_ids := v_ids || v_new;
      else
        update acc_vendor
           set email = coalesce(rec.email, email),
               phone = coalesce(rec.phone, phone)
         where id = v_id;
        v_updated := v_updated + 1;
      end if;
    end if;
  end loop;

  return query select v_created, v_updated, v_skipped, v_ids;
end;
$$;

create or replace function acc_import_items(p_rows jsonb)

returns table(created integer, updated integer, skipped integer, created_ids uuid[])

language plpgsql
security definer
set search_path = public
as $$
declare
  v_new uuid;
  v_ids uuid[] := array[]::uuid[];
  rec       record;
  v_created int := 0;
  v_updated int := 0;
  v_skipped int := 0;
  v_id      uuid;
  v_income  uuid;
  v_expense uuid;
begin
  if not acc_is_staff() then raise exception 'Not authorized to import products'; end if;

  select id into v_income from acc_account
   where account_type = 'income' and is_posting_account and status = 'active'
   order by account_code limit 1;
  select id into v_expense from acc_account
   where account_type = 'cost_of_goods_sold' and is_posting_account and status = 'active'
   order by account_code limit 1;

  for rec in
    select nullif(btrim(coalesce(r->>'item_code', '')), '') as item_code,
           btrim(r->>'name') as name,
           coalesce(r->>'description', '') as description,
           coalesce((r->>'sales_price_minor')::bigint, 0) as sales_price,
           coalesce((r->>'purchase_cost_minor')::bigint, 0) as purchase_cost,
           coalesce((r->>'is_inventory')::boolean, false) as is_inventory
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
  loop
    if coalesce(rec.name, '') = '' then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- Match on the code where there is one, otherwise on the name: an export
    -- without SKUs is common, and it should still be re-runnable.
    if rec.item_code is not null then
      select id into v_id from acc_item where item_code = rec.item_code;
    else
      select id into v_id from acc_item where lower(name) = lower(rec.name);
    end if;

    if v_id is null then
      insert into acc_item (item_code, name, description, is_sold, sales_price_minor,
                            income_account_id, is_purchased, purchase_cost_minor,
                            expense_account_id, is_inventory)
      values (rec.item_code, rec.name, rec.description, true, rec.sales_price,
              v_income, rec.purchase_cost > 0, rec.purchase_cost,
              v_expense, false)
        returning id into v_new;
      v_created := v_created + 1;
      v_ids := v_ids || v_new;
    else
      -- Inventory tracking is deliberately not changed by an import. Turning it
      -- on for an item that already has movements would leave the subledger
      -- describing history the ledger never recorded.
      update acc_item
         set name = rec.name,
             description = case when rec.description = '' then description else rec.description end,
             sales_price_minor = rec.sales_price,
             purchase_cost_minor = rec.purchase_cost
       where id = v_id;
      v_updated := v_updated + 1;
    end if;
  end loop;

  return query select v_created, v_updated, v_skipped, v_ids;
end;
$$;

revoke all on function acc_import_accounts(jsonb) from public, anon;
grant execute on function acc_import_accounts(jsonb) to authenticated, service_role;
revoke all on function acc_import_contacts(jsonb, text) from public, anon;
grant execute on function acc_import_contacts(jsonb, text) to authenticated, service_role;
revoke all on function acc_import_items(jsonb) from public, anon;
grant execute on function acc_import_items(jsonb) to authenticated, service_role;

/**
 * Record a list import and link every record it created.
 *
 * One function for four tabs: the register does not care whether the rows were
 * accounts or vendors, only what the file was, who ran it, and what came in.
 */
create or replace function acc_record_list_import(
  p_source     text,
  p_kind       text,
  p_file_name  text,
  p_sha256     text,
  p_created    uuid[],
  p_row_count  int
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_batch uuid;
  v_id    uuid;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to import';
  end if;

  insert into acc_import_batch (
    source, mode, file_name, sha256, entry_count, line_count, total_minor, imported_by
  ) values (
    p_source, 'documents', p_file_name, p_sha256,
    coalesce(array_length(p_created, 1), 0), greatest(coalesce(p_row_count, 0), 0), 0, auth.uid()
  ) returning id into v_batch;

  foreach v_id in array coalesce(p_created, array[]::uuid[])
  loop
    insert into acc_import_batch_document (batch_id, document_kind, document_id)
    values (v_batch, p_kind, v_id)
    on conflict do nothing;
  end loop;

  return v_batch;
end $$;

/**
 * Take a list import back out.
 *
 * Deletes the records this import created and nothing else is using. A row the
 * ledger or a document now points at is left where it is and counted back --
 * removing it would break the thing that references it, and the database says
 * so itself through the foreign key rather than through a list kept here.
 */
create or replace function acc_undo_list_import(p_batch_id uuid, p_reason text)
returns table (removed int, kept int)
language plpgsql security definer set search_path = public as $$
declare
  v_removed int := 0;
  v_kept    int := 0;
  v_kind    text;
  v_id      uuid;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to undo an import';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Say why this import is being undone';
  end if;
  if not exists (
    select 1 from acc_import_batch
     where id = p_batch_id and status = 'active'
       and source in ('chart_of_accounts', 'customers', 'vendors', 'items')
  ) then
    raise exception 'Import not found, or already undone';
  end if;

  for v_kind, v_id in
    select document_kind, document_id from acc_import_batch_document where batch_id = p_batch_id
  loop
    begin
      case v_kind
        when 'account'  then delete from acc_account  where id = v_id;
        when 'customer' then delete from acc_customer where id = v_id;
        when 'vendor'   then delete from acc_vendor   where id = v_id;
        when 'item'     then delete from acc_item     where id = v_id;
        else raise exception 'Unknown record kind %', v_kind;
      end case;
      if found then
        v_removed := v_removed + 1;
      end if;
    exception
      when foreign_key_violation then
        -- Something points at it now. That is a fact about the books, not a
        -- failure of the undo, and the whole batch must not roll back over it.
        v_kept := v_kept + 1;
    end;
  end loop;

  update acc_import_batch
     set status = 'voided', voided_by = auth.uid(), voided_at = now(),
         void_reason = btrim(p_reason)
   where id = p_batch_id;

  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
  values ('acc_import_batch', p_batch_id, 'update', auth.uid(),
          jsonb_build_object('source', 'list_import_undo', 'removed', v_removed,
                             'kept', v_kept, 'reason', btrim(p_reason)));

  return query select v_removed, v_kept;
end $$;

revoke all on function acc_record_list_import(text, text, text, text, uuid[], int) from public, anon;
grant execute on function acc_record_list_import(text, text, text, text, uuid[], int)
  to authenticated, service_role;
revoke all on function acc_undo_list_import(uuid, text) from public, anon;
grant execute on function acc_undo_list_import(uuid, text) to authenticated, service_role;
