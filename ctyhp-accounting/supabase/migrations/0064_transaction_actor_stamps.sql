-- ============================================================================
-- Immutable creation and modification stamps on financial documents.
--
-- Every document table already carried `created_by`, but nothing forced it to
-- hold the person who actually inserted the row, nothing moved `updated_at`
-- when a row changed outside an RPC that remembered to, and no column recorded
-- who made the change. An auditor reconciling a document to its evidence needs
-- all four, and needs them written by the database rather than by whichever
-- statement happened to touch the row (IRS Pub. 583 recordkeeping, SOX 302).
--
-- The audit snapshots in acc_audit_log (migration 0058) stay the record of what
-- changed; these columns are the summary that lives on the document itself.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Stamp trigger. Runs BEFORE the row is written, so the audit AFTER trigger
-- captures the stamped values. Only the columns a table actually has are
-- touched, which is what lets one function serve every document table.
-- ----------------------------------------------------------------------------
create or replace function acc_stamp_actor() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_row   jsonb := to_jsonb(new);
  v_old   jsonb;
  v_patch jsonb := '{}'::jsonb;
  v_actor uuid  := auth.uid();
begin
  if tg_op = 'INSERT' then
    if v_row ? 'created_at' then
      v_patch := v_patch || jsonb_build_object('created_at', now());
    end if;
    -- A signed-in user cannot claim someone else made the record. Background
    -- work (recurring runs, service_role imports) has no auth.uid(), so there
    -- the value the caller supplied — usually null, meaning "system" — stands.
    if v_row ? 'created_by' and v_actor is not null then
      v_patch := v_patch || jsonb_build_object('created_by', v_actor);
    end if;
    if v_row ? 'updated_at' then
      v_patch := v_patch || jsonb_build_object('updated_at', now());
    end if;
    if v_row ? 'updated_by' then
      v_patch := v_patch || jsonb_build_object('updated_by', v_actor);
    end if;
  else
    v_old := to_jsonb(old);
    -- Creation facts are immutable: an update that tries to rewrite them is
    -- silently given the original values back.
    if v_row ? 'created_at' then
      v_patch := v_patch || jsonb_build_object('created_at', v_old -> 'created_at');
    end if;
    if v_row ? 'created_by' then
      v_patch := v_patch || jsonb_build_object('created_by', v_old -> 'created_by');
    end if;
    if v_row ? 'updated_at' then
      v_patch := v_patch || jsonb_build_object('updated_at', now());
    end if;
    if v_row ? 'updated_by' then
      v_patch := v_patch || jsonb_build_object('updated_by', v_actor);
    end if;
  end if;

  new := jsonb_populate_record(new, v_patch);
  return new;
end;
$$;

revoke all on function acc_stamp_actor() from public;

-- ----------------------------------------------------------------------------
-- The transaction tables. Named explicitly rather than discovered, so adding a
-- table is a deliberate act and nothing is stamped by accident.
-- ----------------------------------------------------------------------------
do $$
declare
  v_table text;
  v_tables text[] := array[
    'acc_invoice',
    'acc_payment',
    'acc_bill',
    'acc_bill_payment',
    'acc_expense',
    'acc_tax_payment',
    'acc_credit_memo',
    'acc_vendor_credit',
    'acc_customer_refund',
    'acc_write_off',
    'acc_journal_entry',
    'acc_purchase_order',
    'acc_goods_receipt'
  ];
begin
  foreach v_table in array v_tables loop
    execute format(
      'alter table %I add column if not exists updated_by uuid references auth.users (id)',
      v_table);
    execute format('drop trigger if exists %I on %I', v_table || '_actor_stamp', v_table);
    execute format(
      'create trigger %I before insert or update on %I
         for each row execute function acc_stamp_actor()',
      v_table || '_actor_stamp', v_table);
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- User directory for attribution. A document shows "created by <email>", and
-- the audit filter offers the people who could have made a change, so every
-- signed-in role needs to resolve a user id to a name. Nothing here exposes a
-- role, a status, or anything else the users screen governs.
-- ----------------------------------------------------------------------------
create or replace function acc_actor_directory()
returns table (id uuid, email text, full_name text)
language plpgsql stable security definer set search_path = public as $$
begin
  if acc_current_role() is null then
    raise exception 'Not authorized to read the user directory';
  end if;
  return query
    select u.id, au.email::text, u.full_name
      from acc_app_user u
      join auth.users au on au.id = u.id
     order by au.email;
end;
$$;

revoke all on function acc_actor_directory() from public;
grant execute on function acc_actor_directory() to authenticated, service_role;
