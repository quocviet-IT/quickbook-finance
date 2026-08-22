-- ============================================================================
-- 0122  An attachment filed outside the first company
--
-- The same defect 0104 fixed for feedback screenshots, in the place nobody went
-- back to fix. `storage.objects` policies are global — one copy for the whole
-- database — and every guard on the `accounting-documents` bucket was pinned to
-- `public`. An invoice in another company has an id that `public.acc_invoice`
-- has never heard of, so the path check returned false and the browser upload
-- was refused before it began.
--
-- Measured before this change, with the guard called directly:
--
--     public    invoice c2fb38f7 → acc_document_storage_path_allowed = true
--     co_pc     invoice 58b975da → acc_document_storage_path_allowed = false
--
-- Migration 0101 recorded the gap in its own header and stepped around it by
-- carrying every saved-report transfer through the service role instead. This
-- closes it for documents rather than stepping around it, because the browser
-- uploads these bytes directly and there is nowhere to step to.
--
-- ## The hole that is not about company isolation
--
-- `acc_document_orphan_delete` exists so the screen can remove an object it
-- just uploaded when registering the metadata fails. It permitted a delete when
-- no row in **`public`** claimed the path — so a user holding `documents.manage`
-- in the first company could delete the bytes behind another company's
-- registered, audited accounting evidence, and the row would survive pointing at
-- nothing. It is unreachable today only because no attachment has ever been
-- uploaded. It is closed here as part of the same change.
--
-- ## Note for whoever changes this next
--
-- Every statement below names `onebook.`, so `scopeOf()` holds all of them back
-- from company schemas and only the copy in `public` is built. That is
-- deliberate and must stay that way: the policies bind to these functions, and a
-- half-replayed migration is what the first attempt at 0104 produced — a company
-- schema whose guard called a helper that had been held back.
--
-- The per-schema `acc_document_storage_path_allowed` is deliberately left alone.
-- It guards the INSERT policy on `acc_document_attachment`, which is a per-schema
-- table: a row going into `co_pc` must name an entity that exists in `co_pc`, and
-- asking every company there would be wrong.
-- ============================================================================

set search_path = public;

/**
 * Which company's books hold this entity, or null.
 *
 * Returns the schema name rather than a boolean because every caller then has a
 * second question — may this person write there, may they read there — and that
 * question can only be asked of the company that owns the record.
 *
 * The register is the list of schemas; `%I` quotes each one, and `schema_name`
 * is constrained by the register to a plain identifier besides.
 */
create or replace function onebook.document_entity_owner(
  p_entity_type text,
  p_entity_id uuid
) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v_schema text;
  v_table  text;
  v_found  boolean;
begin
  if p_entity_id is null then return null; end if;

  -- The entity type decides the table. An unknown type falls through to null
  -- rather than to a table name built from the caller's string.
  v_table := case p_entity_type
    when 'invoice'          then 'acc_invoice'
    when 'bill'             then 'acc_bill'
    when 'expense'          then 'acc_expense'
    when 'purchase_order'   then 'acc_purchase_order'
    when 'payment'          then 'acc_payment'
    when 'bill_payment'     then 'acc_bill_payment'
    when 'credit_memo'      then 'acc_credit_memo'
    when 'vendor_credit'    then 'acc_vendor_credit'
    when 'journal_entry'    then 'acc_journal_entry'
    when 'fixed_asset'      then 'acc_fixed_asset'
    when 'bank_transaction' then 'acc_bank_transaction'
    when 'goods_receipt'    then 'acc_goods_receipt'
    else null
  end;
  if v_table is null then return null; end if;

  for v_schema in
    select schema_name from onebook.company where status = 'active' order by display_order
  loop
    execute format('select exists (select 1 from %I.%I where id = $1)', v_schema, v_table)
      into v_found using p_entity_id;
    if v_found then return v_schema; end if;
  end loop;
  return null;
end;
$$;

/**
 * The company an object path belongs to, or null when the path is malformed or
 * names nothing.
 *
 * The shape is unchanged from 0055 — `entity_type/entity_id/<uuid>.<ext>` — and
 * so is the refusal of anything that is not exactly three segments with a v4
 * uuid filename. Only the search widens.
 */
create or replace function onebook.document_path_owner(p_name text)
returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v_parts text[];
  v_id    uuid;
begin
  if p_name is null then return null; end if;
  v_parts := string_to_array(p_name, '/');
  if array_length(v_parts, 1) <> 3 then return null; end if;
  if v_parts[3] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[a-z0-9]{1,10}$' then
    return null;
  end if;
  begin
    v_id := v_parts[2]::uuid;
  exception when others then
    return null;
  end;
  return onebook.document_entity_owner(v_parts[1], v_id);
end;
$$;

/**
 * May the caller put bytes at this path?
 *
 * Only if the record it names exists, and only if they hold `documents.manage`
 * **in the company that holds that record**. An administrator of one company
 * gains no right to file evidence against another's invoice by way of this fix.
 */
create or replace function onebook.document_upload_allowed(p_name text)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_schema text;
  v_ok     boolean;
begin
  v_schema := onebook.document_path_owner(p_name);
  if v_schema is null then return false; end if;
  execute format('select %I.acc_has_permission(''documents.manage'')', v_schema) into v_ok;
  return coalesce(v_ok, false);
end;
$$;

/**
 * May the caller read the bytes at this path?
 *
 * Answered by the company whose attachment row names it: the row must be active
 * and must have passed a scan, and the caller must hold `documents.read` there.
 *
 * The scan condition is the same one the application and `acc_log_document_access`
 * apply, restated here because this is the layer a signed URL actually crosses.
 * Three independent statements of one rule, deliberately — a blocked file must
 * not become reachable because one of them was edited.
 */
create or replace function onebook.document_object_readable(p_name text)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_schema text;
  v_ok     boolean;
begin
  if p_name is null then return false; end if;
  for v_schema in
    select schema_name from onebook.company where status = 'active' order by display_order
  loop
    execute format(
      'select exists (
         select 1 from %I.acc_document_attachment a
          where a.storage_path = $1
            and a.status = ''active''
            and a.scan_status in (''clean'', ''not_configured'')
            and %I.acc_has_permission(''documents.read'')
       )', v_schema, v_schema)
      into v_ok using p_name;
    if v_ok then return true; end if;
  end loop;
  return false;
end;
$$;

/**
 * Is this object registered in any company's books?
 *
 * The orphan-delete policy is the reason this asks *every* company rather than
 * one. Asking only `public` meant an object registered elsewhere looked
 * unclaimed, and deleting it would have left an audited attachment row pointing
 * at bytes that no longer exist — the one thing a document store must never do.
 */
create or replace function onebook.document_object_registered(p_name text)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_schema text;
  v_found  boolean;
begin
  if p_name is null then return false; end if;
  for v_schema in
    select schema_name from onebook.company where status = 'active' order by display_order
  loop
    execute format(
      'select exists (select 1 from %I.acc_document_attachment where storage_path = $1)', v_schema)
      into v_found using p_name;
    if v_found then return true; end if;
  end loop;
  return false;
end;
$$;

revoke all on function onebook.document_entity_owner(text, uuid) from public, anon;
grant execute on function onebook.document_entity_owner(text, uuid) to authenticated, service_role;
revoke all on function onebook.document_path_owner(text) from public, anon;
grant execute on function onebook.document_path_owner(text) to authenticated, service_role;
revoke all on function onebook.document_upload_allowed(text) from public, anon;
grant execute on function onebook.document_upload_allowed(text) to authenticated, service_role;
revoke all on function onebook.document_object_readable(text) from public, anon;
grant execute on function onebook.document_object_readable(text) to authenticated, service_role;
revoke all on function onebook.document_object_registered(text) from public, anon;
grant execute on function onebook.document_object_registered(text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- The three policies. `storage.objects` is global in its own right, so these are
-- applied once whatever else they name.
-- ----------------------------------------------------------------------------

-- Read: the owning company's `documents.read`, and only a file that has passed
-- a scan. Unchanged in meaning; changed in which company is asked.
drop policy if exists acc_document_object_read on storage.objects;
create policy acc_document_object_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'accounting-documents'
    and onebook.document_object_readable(name)
  );

-- Insert: the owning company's `documents.manage`, and a path that names a
-- record that actually exists there.
drop policy if exists acc_document_object_insert on storage.objects;
create policy acc_document_object_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'accounting-documents'
    and onebook.document_upload_allowed(name)
  );

-- Delete: cleaning up your own failed upload, and nothing else. Two conditions,
-- and the second is the one that was wrong: the object must be claimed by *no*
-- company, not merely unclaimed by the first one.
drop policy if exists acc_document_orphan_delete on storage.objects;
create policy acc_document_orphan_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'accounting-documents'
    and onebook.document_upload_allowed(name)
    and not onebook.document_object_registered(name)
  );

notify pgrst, 'reload schema';
