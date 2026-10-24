-- ============================================================================
-- 0161  A bank feed does not bring in lines already in OneBook (2.48)
--
-- Connecting a bank fetched about six months of its history, and the only
-- duplicate a sync knew was its own: a transaction it had already brought in
-- under the same provider id. A company that had imported its statements for
-- those months got every line a second time in Bank Transactions, one click
-- away from being posted twice. Two guards now stand in front of every line a
-- feed brings in, written down so the screen can say what was skipped and why:
--
--   1. Where the feed starts. Each mapped account may carry feed_starts_on;
--      a line dated before it is skipped. Connect bank offers the date of the
--      account's last line already in OneBook, so the feed picks up where the
--      statements stopped.
--   2. A line already here. From that date on, a posted line is skipped when
--      the account already holds a line of the same amount dated within two
--      days of it that came from somewhere else: a statement import, a line
--      typed in, or another connection (a bank connected again gets new
--      provider ids for the same transactions). Each line already here stands
--      for one feed line only, so two real $5.40 charges a day apart are two
--      lines, not one. A pending line is never skipped this way: the bank
--      replaces it with the posted one, which is checked when it arrives.
--
--   acc_bank_feed_skip                 what a sync skipped, and why
--   acc_bank_feed_account.feed_starts_on
--   acc_bank_feed_start_defaults()     each bank account's last line in OneBook
--   acc_bank_feed_try_skip(...)        both guards for one line
--   acc_apply_bank_feed_page           redefined: asks acc_bank_feed_try_skip
--                                      before inserting; returns the skips
--   acc_save_bank_connection           redefined: keeps feed_starts_on
--   acc_bank_feed_syncs                redefined: a skipped column, and a sync
--                                      that only skipped is still listed
--
-- A connection saved before this has no start date and skips only lines
-- already here. Nothing that exists is deleted or rewritten.
-- ============================================================================
set search_path = public;

-- ----------------------------------------------------------------------------
-- 1. Where a feed starts, and what it skipped.
-- ----------------------------------------------------------------------------
alter table acc_bank_feed_account add column if not exists feed_starts_on date;

create table if not exists acc_bank_feed_skip (
  id                       uuid primary key default gen_random_uuid(),
  run_id                   uuid not null references acc_bank_feed_sync_run (id) on delete cascade,
  bank_account_id          uuid not null references acc_bank_account (id) on delete cascade,
  external_transaction_id  text not null,
  txn_date                 date not null,
  amount_minor             bigint not null,
  description              text not null default '',
  reason                   text not null check (reason in ('before_start', 'already_here')),
  -- For a line already here: the line it is.
  twin_bank_transaction_id uuid references acc_bank_transaction (id) on delete set null,
  created_at               timestamptz not null default now(),
  unique (bank_account_id, external_transaction_id)
);
create index if not exists acc_bank_feed_skip_run_idx on acc_bank_feed_skip (run_id);
create index if not exists acc_bank_feed_skip_twin_idx on acc_bank_feed_skip (twin_bank_transaction_id);

alter table acc_bank_feed_skip enable row level security;
drop policy if exists acc_bank_feed_skip_read on acc_bank_feed_skip;
create policy acc_bank_feed_skip_read on acc_bank_feed_skip
  for select using (acc_current_role() is not null);
-- Read by signed-in users; written only by the sync.
revoke all on acc_bank_feed_skip from public, anon;
grant select on acc_bank_feed_skip to authenticated;
grant all on acc_bank_feed_skip to service_role;

-- ----------------------------------------------------------------------------
-- 2. Each bank account's last line in OneBook: what Connect bank offers as the
--    date the feed starts. Lines a feed retired are not lines any more.
-- ----------------------------------------------------------------------------
create or replace function acc_bank_feed_start_defaults()
returns table (bank_account_id uuid, last_line_on date)
language sql stable as $$
  select t.bank_account_id, max(t.txn_date)
    from acc_bank_transaction t
   where t.provider_removed_at is null
   group by t.bank_account_id;
$$;
revoke all on function acc_bank_feed_start_defaults() from public, anon;
grant execute on function acc_bank_feed_start_defaults() to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. Both guards for one line the feed brings in. Records the skip and returns
--    its reason, or returns null when the line is to be brought in.
-- ----------------------------------------------------------------------------
create or replace function acc_bank_feed_try_skip(
  p_connection_id   uuid,
  p_run_id          uuid,
  p_bank_account_id uuid,
  p_starts_on       date,
  p_row             jsonb
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_date    date   := (p_row->>'txn_date')::date;
  v_amount  bigint := (p_row->>'amount_minor')::bigint;
  v_pending boolean := coalesce((p_row->>'pending')::boolean, false);
  v_twin    uuid;
  v_reason  text;
begin
  if p_starts_on is not null and v_date < p_starts_on then
    v_reason := 'before_start';
  elsif not v_pending then
    select t.id into v_twin
      from acc_bank_transaction t
     where t.bank_account_id = p_bank_account_id
       and t.amount_minor = v_amount
       and t.txn_date between v_date - 2 and v_date + 2
       and t.provider_removed_at is null
       -- Not one of this connection's own lines: those it knows by their id.
       and (t.source <> 'bank_feed'
            or t.provider_account_id is null
            or t.provider_account_id not in (
              select f.provider_account_id from acc_bank_feed_account f where f.connection_id = p_connection_id))
       -- One line already here stands for one feed line of this connection.
       and not exists (
         select 1 from acc_bank_feed_skip s
           join acc_bank_feed_sync_run r on r.id = s.run_id
          where s.twin_bank_transaction_id = t.id
            and r.connection_id = p_connection_id
            and r.status <> 'undone')
     order by abs(t.txn_date - v_date), t.txn_date, t.id
     limit 1;
    if v_twin is not null then v_reason := 'already_here'; end if;
  end if;

  if v_reason is null then return null; end if;
  insert into acc_bank_feed_skip
    (run_id, bank_account_id, external_transaction_id, txn_date, amount_minor, description, reason, twin_bank_transaction_id)
  values
    (p_run_id, p_bank_account_id, p_row->>'external_transaction_id', v_date, v_amount,
     coalesce(p_row->>'description', ''), v_reason, v_twin)
  on conflict (bank_account_id, external_transaction_id) do nothing;
  return v_reason;
end;
$$;
revoke all on function acc_bank_feed_try_skip(uuid, uuid, uuid, date, jsonb) from public, anon;
grant execute on function acc_bank_feed_try_skip(uuid, uuid, uuid, date, jsonb) to service_role;

-- ----------------------------------------------------------------------------
-- 4. A sync page: as 0137, with the guards in front of every line it would
--    insert that this connection has not brought in before.
-- ----------------------------------------------------------------------------
create or replace function acc_apply_bank_feed_page(
  p_connection_id uuid,
  p_run_id        uuid,
  p_added         jsonb,
  p_modified      jsonb,
  p_removed       jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row jsonb;
  v_conn_status text;
  v_provider_id text;
  v_bank_account_id uuid;
  v_starts_on date;
  v_revision int;
  v_new_id uuid;
  v_count int;
  v_reason text;
  v_added int := 0;
  v_modified int := 0;
  v_removed int := 0;
  v_before_start int := 0;
  v_already_here int := 0;
begin
  if not acc_bank_feed_authorized() then
    raise exception 'You do not have permission to synchronize bank feeds';
  end if;
  if not exists (
    select 1 from acc_bank_feed_sync_run
     where id = p_run_id and connection_id = p_connection_id and status = 'running'
  ) then
    raise exception 'This sync run is not running for this bank connection';
  end if;
  -- Held while the page is written: a disconnect waits for this page instead of
  -- committing under it.
  select status into v_conn_status from acc_bank_connection where id = p_connection_id for share;
  if v_conn_status = 'disconnected' then
    raise exception 'This bank connection was disconnected';
  end if;
  -- Asked again under that lock: an undo may have settled this run while the
  -- page waited, and a run cut off writes nothing more.
  if not exists (
    select 1 from acc_bank_feed_sync_run
     where id = p_run_id and status = 'running' and not acc_bank_feed_sync_cut_off(status, started_at)
  ) then
    raise exception 'This sync run is not running for this bank connection';
  end if;

  for v_row in select value from jsonb_array_elements(coalesce(p_removed, '[]'::jsonb)) loop
    v_provider_id := case when jsonb_typeof(v_row) = 'string'
      then trim(both '"' from v_row::text) else v_row->>'external_transaction_id' end;
    with old as (
      select t.id, t.status
        from acc_bank_transaction t
       where t.external_transaction_id = v_provider_id
         and t.provider_removed_at is null
         and t.provider_account_id in (
           select provider_account_id from acc_bank_feed_account where connection_id = p_connection_id
         )
         for update
    ), retired as (
      update acc_bank_transaction t
         set provider_removed_at = now(), status = 'ignored', updated_at = now()
        from old
       where t.id = old.id
      returning t.id, old.status
    )
    insert into acc_bank_feed_sync_change (run_id, bank_transaction_id, kind, prior_status)
    select p_run_id, id, 'retired', status from retired;
    get diagnostics v_count = row_count;
    v_removed := v_removed + v_count;
  end loop;

  for v_row in select value from jsonb_array_elements(coalesce(p_modified, '[]'::jsonb)) loop
    v_provider_id := v_row->>'external_transaction_id';
    select bank_account_id, feed_starts_on into v_bank_account_id, v_starts_on
      from acc_bank_feed_account
     where connection_id = p_connection_id
       and provider_account_id = v_row->>'provider_account_id'
       and is_active;
    if v_bank_account_id is null then continue; end if;

    -- A transaction this connection never brought in: it was skipped before,
    -- and stays skipped; or it is new here, and faces the guards.
    if not exists (
      select 1 from acc_bank_transaction
       where bank_account_id = v_bank_account_id and external_transaction_id = v_provider_id
    ) then
      if exists (
        select 1 from acc_bank_feed_skip
         where bank_account_id = v_bank_account_id and external_transaction_id = v_provider_id
      ) then
        continue;
      end if;
      v_reason := acc_bank_feed_try_skip(p_connection_id, p_run_id, v_bank_account_id, v_starts_on, v_row);
      if v_reason = 'before_start' then v_before_start := v_before_start + 1; continue; end if;
      if v_reason = 'already_here' then v_already_here := v_already_here + 1; continue; end if;
    end if;

    with old as (
      select t.id, t.status
        from acc_bank_transaction t
       where t.bank_account_id = v_bank_account_id
         and t.external_transaction_id = v_provider_id
         and t.provider_removed_at is null
         for update
    ), retired as (
      update acc_bank_transaction t
         set provider_removed_at = now(), status = 'ignored', updated_at = now()
        from old
       where t.id = old.id
      returning t.id, old.status
    )
    insert into acc_bank_feed_sync_change (run_id, bank_transaction_id, kind, prior_status)
    select p_run_id, id, 'retired', status from retired;

    select coalesce(max(provider_revision), 0) + 1 into v_revision
      from acc_bank_transaction
     where bank_account_id = v_bank_account_id and external_transaction_id = v_provider_id;

    insert into acc_bank_transaction
      (bank_account_id, txn_date, description, reference, amount_minor,
       running_balance_minor, raw_line, raw_hash, source, external_transaction_id,
       provider_account_id, provider_revision, pending, authorized_date,
       merchant_name, category)
    values
      (v_bank_account_id,
       (v_row->>'txn_date')::date,
       coalesce(v_row->>'description', ''),
       nullif(v_row->>'reference', ''),
       (v_row->>'amount_minor')::bigint,
       nullif(v_row->>'running_balance_minor', '')::bigint,
       v_row->>'raw_line',
       v_row->>'raw_hash',
       'bank_feed',
       v_provider_id,
       v_row->>'provider_account_id',
       v_revision,
       coalesce((v_row->>'pending')::boolean, false),
       nullif(v_row->>'authorized_date', '')::date,
       nullif(v_row->>'merchant_name', ''),
       nullif(v_row->>'category', ''))
    returning id into v_new_id;
    insert into acc_bank_feed_sync_change (run_id, bank_transaction_id, kind)
    values (p_run_id, v_new_id, 'added');
    v_modified := v_modified + 1;
  end loop;

  for v_row in select value from jsonb_array_elements(coalesce(p_added, '[]'::jsonb)) loop
    v_provider_id := v_row->>'external_transaction_id';
    select bank_account_id, feed_starts_on into v_bank_account_id, v_starts_on
      from acc_bank_feed_account
     where connection_id = p_connection_id
       and provider_account_id = v_row->>'provider_account_id'
       and is_active;
    if v_bank_account_id is null then continue; end if;
    if exists (
      select 1 from acc_bank_transaction
       where bank_account_id = v_bank_account_id
         and external_transaction_id = v_provider_id
         and provider_removed_at is null
    ) then
      continue;
    end if;
    if exists (
      select 1 from acc_bank_feed_skip
       where bank_account_id = v_bank_account_id and external_transaction_id = v_provider_id
    ) then
      continue;
    end if;
    v_reason := acc_bank_feed_try_skip(p_connection_id, p_run_id, v_bank_account_id, v_starts_on, v_row);
    if v_reason = 'before_start' then v_before_start := v_before_start + 1; continue; end if;
    if v_reason = 'already_here' then v_already_here := v_already_here + 1; continue; end if;

    select coalesce(max(provider_revision), 0) + 1 into v_revision
      from acc_bank_transaction
     where bank_account_id = v_bank_account_id and external_transaction_id = v_provider_id;

    insert into acc_bank_transaction
      (bank_account_id, txn_date, description, reference, amount_minor,
       running_balance_minor, raw_line, raw_hash, source, external_transaction_id,
       provider_account_id, provider_revision, pending, authorized_date,
       merchant_name, category)
    values
      (v_bank_account_id,
       (v_row->>'txn_date')::date,
       coalesce(v_row->>'description', ''),
       nullif(v_row->>'reference', ''),
       (v_row->>'amount_minor')::bigint,
       nullif(v_row->>'running_balance_minor', '')::bigint,
       v_row->>'raw_line',
       v_row->>'raw_hash',
       'bank_feed',
       v_provider_id,
       v_row->>'provider_account_id',
       greatest(v_revision, 1),
       coalesce((v_row->>'pending')::boolean, false),
       nullif(v_row->>'authorized_date', '')::date,
       nullif(v_row->>'merchant_name', ''),
       nullif(v_row->>'category', ''))
    returning id into v_new_id;
    insert into acc_bank_feed_sync_change (run_id, bank_transaction_id, kind)
    values (p_run_id, v_new_id, 'added');
    v_added := v_added + 1;
  end loop;

  return jsonb_build_object(
    'added', v_added, 'modified', v_modified, 'removed', v_removed,
    'skipped_before_start', v_before_start, 'skipped_already_here', v_already_here);
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Saving a connection keeps where each mapped account's feed starts.
--    As 0045 otherwise.
-- ----------------------------------------------------------------------------
create or replace function acc_save_bank_connection(
  p_provider_item_id       text,
  p_institution_id         text,
  p_institution_name       text,
  p_encrypted_access_token text,
  p_accounts               jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_connection uuid;
  v_mapping jsonb;
  v_book acc_bank_account;
begin
  if not acc_bank_feed_authorized() then
    raise exception 'You do not have permission to manage bank feeds';
  end if;
  if coalesce(btrim(p_provider_item_id), '') = '' then raise exception 'Provider item ID is required'; end if;
  if coalesce(btrim(p_institution_name), '') = '' then raise exception 'Institution name is required'; end if;
  if coalesce(btrim(p_encrypted_access_token), '') = '' then raise exception 'Encrypted access token is required'; end if;
  if jsonb_array_length(coalesce(p_accounts, '[]'::jsonb)) < 1 then
    raise exception 'Map at least one connected account';
  end if;

  insert into acc_bank_connection
    (provider, provider_item_id, institution_id, institution_name, status, created_by)
  values
    ('plaid', p_provider_item_id, nullif(p_institution_id, ''), p_institution_name, 'active', auth.uid())
  on conflict (provider, provider_item_id) do update
    set institution_id = excluded.institution_id,
        institution_name = excluded.institution_name,
        status = 'active',
        last_error = null,
        updated_at = now()
  returning id into v_connection;

  insert into acc_bank_connection_secret (connection_id, encrypted_access_token)
  values (v_connection, p_encrypted_access_token)
  on conflict (connection_id) do update
    set encrypted_access_token = excluded.encrypted_access_token,
        token_version = acc_bank_connection_secret.token_version + 1,
        updated_at = now();

  for v_mapping in select value from jsonb_array_elements(p_accounts) loop
    select * into v_book
      from acc_bank_account
     where id = (v_mapping->>'bank_account_id')::uuid;
    if not found then raise exception 'Mapped ledger bank account was not found'; end if;
    if v_book.currency_code <> upper(v_mapping->>'currency_code') then
      raise exception 'Currency mismatch for %: ledger uses %, provider uses %',
        v_book.bank_name, v_book.currency_code, upper(v_mapping->>'currency_code');
    end if;

    insert into acc_bank_feed_account
      (connection_id, bank_account_id, provider_account_id, account_name,
       account_mask, account_type, account_subtype, currency_code, last_balance_minor,
       feed_starts_on)
    values
      (v_connection,
       (v_mapping->>'bank_account_id')::uuid,
       v_mapping->>'provider_account_id',
       coalesce(nullif(v_mapping->>'account_name', ''), 'Connected account'),
       nullif(v_mapping->>'account_mask', ''),
       nullif(v_mapping->>'account_type', ''),
       nullif(v_mapping->>'account_subtype', ''),
       upper(v_mapping->>'currency_code'),
       nullif(v_mapping->>'last_balance_minor', '')::bigint,
       nullif(v_mapping->>'feed_starts_on', '')::date)
    on conflict (connection_id, provider_account_id) do update
      set bank_account_id = excluded.bank_account_id,
          account_name = excluded.account_name,
          account_mask = excluded.account_mask,
          account_type = excluded.account_type,
          account_subtype = excluded.account_subtype,
          currency_code = excluded.currency_code,
          last_balance_minor = excluded.last_balance_minor,
          feed_starts_on = excluded.feed_starts_on,
          is_active = true,
          updated_at = now();
  end loop;

  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
  values ('acc_bank_connection', v_connection, 'insert', auth.uid(),
          jsonb_build_object('provider', 'plaid', 'institution_name', p_institution_name,
                             'mapped_accounts', jsonb_array_length(p_accounts)));
  return v_connection;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. The syncs list: how many lines each sync skipped. A sync that only
--    skipped is listed too: it is how anyone sees that the guard worked.
--    The return type changes, so the function is dropped and made again.
-- ----------------------------------------------------------------------------
drop function if exists acc_bank_feed_syncs(uuid);
create function acc_bank_feed_syncs(p_bank_account_id uuid)
returns table (
  run_id uuid, connection_id uuid, institution_name text, connection_status text,
  status text, started_at timestamptz, completed_at timestamptz,
  added_count int, modified_count int, removed_count int, error_message text,
  undone_at timestamptz, undo_reason text,
  changes int, is_newest boolean, locked_lines int, skipped_count int
)
language sql stable security definer set search_path = public as $$
  select r.id, r.connection_id, c.institution_name, c.status,
         case when acc_bank_feed_sync_cut_off(r.status, r.started_at) then 'failed' else r.status end,
         r.started_at, r.completed_at,
         r.added_count, r.modified_count, r.removed_count,
         case when acc_bank_feed_sync_cut_off(r.status, r.started_at)
              then coalesce(r.error_message, 'The sync stopped before it finished')
              else r.error_message end,
         r.undone_at, r.undo_reason,
         (select count(*)::int from acc_bank_feed_sync_change x where x.run_id = r.id),
         acc_bank_feed_sync_is_newest(r.id),
         acc_bank_feed_sync_locked_lines(r.id),
         (select count(*)::int from acc_bank_feed_skip s where s.run_id = r.id)
    from acc_bank_feed_sync_run r
    join acc_bank_connection c on c.id = r.connection_id
   where acc_current_role() is not null
     and r.connection_id in (select f.connection_id from acc_bank_feed_account f where f.bank_account_id = p_bank_account_id)
     and (r.status <> 'succeeded'
          or exists (select 1 from acc_bank_feed_sync_change x where x.run_id = r.id)
          or exists (select 1 from acc_bank_feed_skip s where s.run_id = r.id))
   order by r.started_at desc, r.id desc;
$$;
revoke all on function acc_bank_feed_syncs(uuid) from public, anon;
grant execute on function acc_bank_feed_syncs(uuid) to authenticated, service_role;
