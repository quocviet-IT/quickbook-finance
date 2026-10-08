-- ============================================================================
-- 1.87 — a bank feed can be disconnected, and a sync can be undone.
--
-- A connection whose sync failed stayed "attention required" for good: the
-- status `disconnected` existed, and a sync refused it, but nothing set it —
-- and its bank account could never be connected again, because a bank account
-- could be mapped once, active or not.
--
-- A statement import could be undone since 0109; lines a sync brought in could
-- only be deleted one at a time, because nothing recorded which lines a sync
-- added, or which it retired (a modified transaction retires its old revision
-- and inserts a new one; a removed one is retired). Every sync now writes down
-- what it did, and an undo plays that back: the lines it added go, the lines it
-- retired come back as they were. The sync cursor is not rewound — undone lines
-- do not come back with the next sync; connecting again fetches the history.
-- A sync that failed part-way never moved the cursor, so the next sync fetches
-- its changes again.
--
-- A sync whose function was killed (a timeout, a crash, a deploy) never reaches
-- acc_finish_bank_feed_sync and would stay `running` for good, blocking every
-- undo of its connection. The sync route stops after 300 seconds, so a run still
-- running 15 minutes after it began was cut off: it counts as failed.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. What each sync did.
-- ----------------------------------------------------------------------------
create table if not exists acc_bank_feed_sync_change (
  id                  uuid primary key default gen_random_uuid(),
  run_id              uuid not null references acc_bank_feed_sync_run (id) on delete cascade,
  bank_transaction_id uuid not null references acc_bank_transaction (id) on delete cascade,
  kind                text not null check (kind in ('added', 'retired')),
  -- For a retired line: its status before the sync retired it.
  prior_status        acc_bank_txn_status,
  created_at          timestamptz not null default now(),
  check ((kind = 'retired') = (prior_status is not null))
);
create index if not exists acc_bank_feed_sync_change_run_idx on acc_bank_feed_sync_change (run_id, kind);
create index if not exists acc_bank_feed_sync_change_txn_idx on acc_bank_feed_sync_change (bank_transaction_id);

alter table acc_bank_feed_sync_change enable row level security;
drop policy if exists acc_bank_feed_sync_change_read on acc_bank_feed_sync_change;
create policy acc_bank_feed_sync_change_read on acc_bank_feed_sync_change
  for select using (acc_current_role() is not null);
-- Read by signed-in users; written only by the sync and undo functions.
revoke all on acc_bank_feed_sync_change from public, anon;
grant select on acc_bank_feed_sync_change to authenticated;
grant all on acc_bank_feed_sync_change to service_role;

-- ----------------------------------------------------------------------------
-- 2. A sync can be undone; a bank account can be connected again.
-- ----------------------------------------------------------------------------
alter table acc_bank_feed_sync_run
  add column if not exists undone_by uuid references auth.users (id),
  add column if not exists undone_at timestamptz,
  add column if not exists undo_reason text;
alter table acc_bank_feed_sync_run drop constraint if exists acc_bank_feed_sync_run_status_check;
alter table acc_bank_feed_sync_run add constraint acc_bank_feed_sync_run_status_check
  check (status in ('running', 'succeeded', 'failed', 'undone'));

alter table acc_bank_feed_account drop constraint if exists acc_bank_feed_account_bank_account_id_key;
create unique index if not exists acc_bank_feed_account_active_bank_uq
  on acc_bank_feed_account (bank_account_id) where is_active;

-- ----------------------------------------------------------------------------
-- 3. A sync page records what it changes.
--
--    The run must be this connection's, still running, and the connection not
--    disconnected: a sync that was running when the connection was disconnected
--    stops at its next page instead of retiring lines of a connection nobody
--    syncs any more.
-- ----------------------------------------------------------------------------
drop function if exists acc_apply_bank_feed_page(uuid, jsonb, jsonb, jsonb);
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
  v_revision int;
  v_new_id uuid;
  v_count int;
  v_added int := 0;
  v_modified int := 0;
  v_removed int := 0;
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
    select bank_account_id into v_bank_account_id
      from acc_bank_feed_account
     where connection_id = p_connection_id
       and provider_account_id = v_row->>'provider_account_id'
       and is_active;
    if v_bank_account_id is null then continue; end if;

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
    select bank_account_id into v_bank_account_id
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

  return jsonb_build_object('added', v_added, 'modified', v_modified, 'removed', v_removed);
end;
$$;

revoke all on function acc_apply_bank_feed_page(uuid, uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function acc_apply_bank_feed_page(uuid, uuid, jsonb, jsonb, jsonb) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. Syncs are told apart by when they began, so they begin at the clock's
--    time, not the transaction's: two syncs started in one transaction would
--    otherwise share a moment, and "newest first" would be a coin toss.
-- ----------------------------------------------------------------------------
-- The one place that says a run was cut off: still running 15 minutes after it
-- began, though the sync route stops after 300 seconds.
create or replace function acc_bank_feed_sync_cut_off(p_status text, p_started_at timestamptz)
returns boolean
language sql stable security definer set search_path = public as $$
  select acc_current_role() is not null
     and p_status = 'running'
     and p_started_at < now() - interval '15 minutes';
$$;

revoke all on function acc_bank_feed_sync_cut_off(text, timestamptz) from public, anon;
grant execute on function acc_bank_feed_sync_cut_off(text, timestamptz) to authenticated, service_role;

create or replace function acc_begin_bank_feed_sync(p_connection_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_run uuid;
begin
  if not acc_bank_feed_authorized() then
    raise exception 'You do not have permission to synchronize bank feeds';
  end if;
  if not exists (select 1 from acc_bank_connection where id = p_connection_id and status <> 'disconnected') then
    raise exception 'Active bank connection was not found';
  end if;
  -- Runs of this connection that were cut off stop looking as if they ran.
  update acc_bank_feed_sync_run
     set status = 'failed', completed_at = clock_timestamp(),
         error_message = coalesce(error_message, 'The sync stopped before it finished')
   where connection_id = p_connection_id
     and acc_bank_feed_sync_cut_off(status, started_at);
  insert into acc_bank_feed_sync_run (connection_id, started_by, started_at)
  values (p_connection_id, auth.uid(), clock_timestamp())
  returning id into v_run;
  return v_run;
end;
$$;

revoke all on function acc_begin_bank_feed_sync(uuid) from public, anon;
grant execute on function acc_begin_bank_feed_sync(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. A sync that ends after its connection was disconnected leaves it so.
-- ----------------------------------------------------------------------------
create or replace function acc_finish_bank_feed_sync(
  p_run_id          uuid,
  p_cursor          text,
  p_added_count     int,
  p_modified_count  int,
  p_removed_count   int,
  p_matched_count   int,
  p_error_message   text
) returns void
language plpgsql security definer set search_path = public as $$
declare v_connection uuid;
begin
  if not acc_bank_feed_authorized() then
    raise exception 'You do not have permission to synchronize bank feeds';
  end if;
  select connection_id into v_connection from acc_bank_feed_sync_run where id = p_run_id for update;
  if v_connection is null then raise exception 'Bank-feed sync run was not found'; end if;

  update acc_bank_feed_sync_run
     set status = case when p_error_message is null then 'succeeded' else 'failed' end,
         added_count = coalesce(p_added_count, 0),
         modified_count = coalesce(p_modified_count, 0),
         removed_count = coalesce(p_removed_count, 0),
         matched_count = coalesce(p_matched_count, 0),
         error_message = p_error_message,
         completed_at = now()
   where id = p_run_id;

  update acc_bank_connection
     set sync_cursor = case when p_error_message is null and status <> 'disconnected' then p_cursor else sync_cursor end,
         last_sync_at = case when p_error_message is null and status <> 'disconnected' then now() else last_sync_at end,
         last_error = case when status = 'disconnected' then last_error else p_error_message end,
         status = case
           when status = 'disconnected' then 'disconnected'
           when p_error_message is null then 'active'
           else 'attention_required'
         end,
         updated_at = now()
   where id = v_connection;
end;
$$;

revoke all on function acc_finish_bank_feed_sync(uuid, text, int, int, int, int, text) from public, anon;
grant execute on function acc_finish_bank_feed_sync(uuid, text, int, int, int, int, text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6. Which syncs can be undone, and why not.
--
--    One place decides, so the button and the undo cannot disagree. A sync is
--    taken back newest first: only a connection's newest sync that changed
--    something, is not undone, and is not followed by a running one.
--
--    A failed sync can be undone too, if it changed something. It never moved
--    the connection's cursor, so after its undo the next sync fetches its
--    changes again. A cut-off run counts as failed here: it does not block
--    older syncs as a running one does, and it can itself be undone.
-- ----------------------------------------------------------------------------
create or replace function acc_bank_feed_sync_is_newest(p_run_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from acc_bank_feed_sync_run r
     where r.id = p_run_id
       and acc_current_role() is not null
       and (r.status in ('succeeded', 'failed') or acc_bank_feed_sync_cut_off(r.status, r.started_at))
       and exists (select 1 from acc_bank_feed_sync_change c where c.run_id = r.id)
       and not exists (
         select 1 from acc_bank_feed_sync_run n
          where n.connection_id = r.connection_id
            and n.id <> r.id
            and ((n.status = 'running' and not acc_bank_feed_sync_cut_off(n.status, n.started_at))
                 or (n.status <> 'undone'
                     and (n.started_at, n.id) > (r.started_at, r.id)
                     and exists (select 1 from acc_bank_feed_sync_change c2 where c2.run_id = n.id)))
       )
  );
$$;

create or replace function acc_bank_feed_sync_locked_lines(p_run_id uuid)
returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int
    from acc_bank_feed_sync_change c
    join acc_bank_transaction t on t.id = c.bank_transaction_id
   where c.run_id = p_run_id
     and acc_current_role() is not null
     and c.kind = 'added'
     -- A line a later sync retired comes back only when that sync is undone.
     and t.provider_removed_at is null
     and (t.status <> 'unmatched'
          or exists (select 1 from acc_reconciliation m where m.bank_transaction_id = t.id and m.status = 'approved'));
$$;

revoke all on function acc_bank_feed_sync_is_newest(uuid) from public, anon;
grant execute on function acc_bank_feed_sync_is_newest(uuid) to authenticated, service_role;
revoke all on function acc_bank_feed_sync_locked_lines(uuid) from public, anon;
grant execute on function acc_bank_feed_sync_locked_lines(uuid) to authenticated, service_role;

-- The syncs of every connection that ever fed this bank account, newest first.
-- A sync that changed nothing and did not fail is left out: the daily sync
-- would otherwise bury the ones that matter.
create or replace function acc_bank_feed_syncs(p_bank_account_id uuid)
returns table (
  run_id uuid, connection_id uuid, institution_name text, connection_status text,
  status text, started_at timestamptz, completed_at timestamptz,
  added_count int, modified_count int, removed_count int, error_message text,
  undone_at timestamptz, undo_reason text,
  changes int, is_newest boolean, locked_lines int
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
         acc_bank_feed_sync_locked_lines(r.id)
    from acc_bank_feed_sync_run r
    join acc_bank_connection c on c.id = r.connection_id
   where acc_current_role() is not null
     and r.connection_id in (select f.connection_id from acc_bank_feed_account f where f.bank_account_id = p_bank_account_id)
     and (r.status <> 'succeeded' or exists (select 1 from acc_bank_feed_sync_change x where x.run_id = r.id))
   order by r.started_at desc, r.id desc;
$$;

revoke all on function acc_bank_feed_syncs(uuid) from public, anon;
grant execute on function acc_bank_feed_syncs(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 7. Undo a sync.
-- ----------------------------------------------------------------------------
create or replace function acc_undo_bank_feed_sync(p_run_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_run      acc_bank_feed_sync_run;
  v_locked   int;
  v_removed  int;
  v_restored int;
begin
  if not acc_bank_feed_authorized() then
    raise exception 'You do not have permission to manage bank feeds';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Say why this sync is being undone';
  end if;

  select * into v_run from acc_bank_feed_sync_run where id = p_run_id for update;
  if not found then raise exception 'Bank-feed sync not found'; end if;
  -- One undo of a connection at a time.
  perform 1 from acc_bank_connection where id = v_run.connection_id for update;
  if v_run.status = 'undone' then raise exception 'This sync has already been undone'; end if;
  if acc_bank_feed_sync_cut_off(v_run.status, v_run.started_at) then
    -- Cut off, not running: it ends as failed before it is undone.
    update acc_bank_feed_sync_run
       set status = 'failed', completed_at = clock_timestamp(),
           error_message = coalesce(error_message, 'The sync stopped before it finished')
     where id = p_run_id;
    v_run.status := 'failed';
  end if;
  if v_run.status = 'running' then raise exception 'This sync is still running'; end if;
  if not exists (select 1 from acc_bank_feed_sync_change where run_id = p_run_id) then
    raise exception 'This sync changed nothing in Bank Transactions';
  end if;
  if not acc_bank_feed_sync_is_newest(p_run_id) then
    raise exception 'Undo the newer syncs of this bank connection first';
  end if;

  -- Lock the lines first: a person approving a match or coding a line at the
  -- same moment waits for the undo, so an approved match is never cascaded away.
  -- Their matches are locked before the lines themselves, in the order
  -- acc_decide_bank_match takes them, so the two cannot deadlock.
  perform 1 from acc_reconciliation
   where bank_transaction_id in (select bank_transaction_id from acc_bank_feed_sync_change where run_id = p_run_id)
     for update;
  perform 1 from acc_bank_transaction
   where id in (select bank_transaction_id from acc_bank_feed_sync_change where run_id = p_run_id)
     for update;

  v_locked := acc_bank_feed_sync_locked_lines(p_run_id);
  if v_locked > 0 then
    raise exception
      '% line(s) of this sync have been matched, coded or ignored — unmatch them first. '
      'Removing a line the books point at would leave them short.', v_locked;
  end if;

  -- The lines it added go first, so a line it retired can take its place again.
  delete from acc_bank_transaction
   where id in (select bank_transaction_id from acc_bank_feed_sync_change where run_id = p_run_id and kind = 'added');
  get diagnostics v_removed = row_count;

  update acc_bank_transaction t
     set provider_removed_at = null, status = c.prior_status, updated_at = now()
    from acc_bank_feed_sync_change c
   where c.run_id = p_run_id and c.kind = 'retired' and c.bank_transaction_id = t.id;
  get diagnostics v_restored = row_count;

  update acc_bank_feed_sync_run
     set status = 'undone', undone_by = auth.uid(), undone_at = now(), undo_reason = btrim(p_reason)
   where id = p_run_id;

  insert into acc_audit_log (table_name, record_id, action, actor_id, before_json)
  values ('acc_bank_feed_sync_run', p_run_id, 'undo', auth.uid(),
          jsonb_build_object('connection_id', v_run.connection_id,
                             'lines_removed', v_removed,
                             'lines_restored', v_restored,
                             'reason', btrim(p_reason)));
  return jsonb_build_object('removed', v_removed, 'restored', v_restored);
end;
$$;

revoke all on function acc_undo_bank_feed_sync(uuid, text) from public, anon;
grant execute on function acc_undo_bank_feed_sync(uuid, text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 8. Disconnect.
--
--    The app removes the connection at Plaid first; p_note says when Plaid did
--    not confirm and the person chose to disconnect in OneBook only. The lines
--    the connection brought in stay; its accounts are free to connect again.
-- ----------------------------------------------------------------------------
create or replace function acc_disconnect_bank_connection(p_connection_id uuid, p_reason text, p_note text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_conn     acc_bank_connection;
  v_accounts int;
begin
  if not acc_bank_feed_authorized() then
    raise exception 'You do not have permission to manage bank feeds';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Say why this bank connection is being disconnected';
  end if;
  select * into v_conn from acc_bank_connection where id = p_connection_id for update;
  if not found then raise exception 'Bank connection not found'; end if;
  if v_conn.status = 'disconnected' then raise exception 'This bank connection is already disconnected'; end if;

  update acc_bank_connection
     set status = 'disconnected', last_error = nullif(btrim(coalesce(p_note, '')), ''), updated_at = now()
   where id = p_connection_id;
  delete from acc_bank_connection_secret where connection_id = p_connection_id;
  update acc_bank_feed_account set is_active = false, updated_at = now()
   where connection_id = p_connection_id and is_active;
  get diagnostics v_accounts = row_count;

  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
  values ('acc_bank_connection', p_connection_id, 'disconnect', auth.uid(),
          jsonb_build_object('institution_name', v_conn.institution_name,
                             'accounts', v_accounts,
                             'reason', btrim(p_reason),
                             'note', nullif(btrim(coalesce(p_note, '')), '')));
end;
$$;

revoke all on function acc_disconnect_bank_connection(uuid, text, text) from public, anon;
grant execute on function acc_disconnect_bank_connection(uuid, text, text) to authenticated, service_role;
