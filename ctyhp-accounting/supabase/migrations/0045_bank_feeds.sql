-- ============================================================================
-- Direct bank feeds and ledger-level automatic matching.
--
-- Provider tokens are encrypted by the application before they reach Postgres
-- and are kept in a table with no client SELECT policy. Imported feed rows stay
-- immutable: provider modifications retire the old revision and insert a new
-- revision instead of rewriting the bank's original record.
-- ============================================================================

alter table acc_bank_transaction
  add column source text not null default 'file_upload'
    check (source in ('file_upload', 'bank_feed')),
  add column external_transaction_id text,
  add column provider_account_id text,
  add column provider_revision int not null default 1 check (provider_revision > 0),
  add column pending boolean not null default false,
  add column authorized_date date,
  add column merchant_name text,
  add column category text,
  add column provider_removed_at timestamptz,
  add column updated_at timestamptz not null default now();

create unique index acc_bank_txn_active_external_uq
  on acc_bank_transaction (bank_account_id, external_transaction_id)
  where external_transaction_id is not null and provider_removed_at is null;

create index acc_bank_txn_external_history_idx
  on acc_bank_transaction (external_transaction_id, provider_revision desc)
  where external_transaction_id is not null;

create table acc_bank_connection (
  id                  uuid primary key default gen_random_uuid(),
  provider            text not null default 'plaid' check (provider in ('plaid')),
  provider_item_id    text not null,
  institution_id      text,
  institution_name    text not null,
  status              text not null default 'active'
    check (status in ('active', 'attention_required', 'disconnected')),
  sync_cursor         text,
  consent_expires_at  timestamptz,
  last_sync_at        timestamptz,
  last_error          text,
  created_by          uuid references auth.users (id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (provider, provider_item_id)
);

create table acc_bank_connection_secret (
  connection_id          uuid primary key references acc_bank_connection (id) on delete cascade,
  encrypted_access_token text not null,
  token_version          int not null default 1,
  updated_at             timestamptz not null default now()
);

create table acc_bank_feed_account (
  id                    uuid primary key default gen_random_uuid(),
  connection_id         uuid not null references acc_bank_connection (id) on delete cascade,
  bank_account_id       uuid not null references acc_bank_account (id) on delete cascade,
  provider_account_id   text not null,
  account_name          text not null,
  account_mask          text,
  account_type          text,
  account_subtype       text,
  currency_code         text not null references acc_currency (code),
  is_active             boolean not null default true,
  last_balance_minor    bigint,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (connection_id, provider_account_id),
  unique (bank_account_id)
);

create index acc_bank_feed_account_connection_idx
  on acc_bank_feed_account (connection_id, is_active);

create table acc_bank_feed_sync_run (
  id              uuid primary key default gen_random_uuid(),
  connection_id   uuid not null references acc_bank_connection (id) on delete cascade,
  status          text not null default 'running'
    check (status in ('running', 'succeeded', 'failed')),
  added_count     int not null default 0,
  modified_count  int not null default 0,
  removed_count   int not null default 0,
  matched_count   int not null default 0,
  error_message   text,
  started_by      uuid references auth.users (id),
  started_at      timestamptz not null default now(),
  completed_at    timestamptz
);

create index acc_bank_feed_sync_run_connection_idx
  on acc_bank_feed_sync_run (connection_id, started_at desc);

alter table acc_reconciliation
  add column journal_line_id uuid references acc_journal_line (id) on delete cascade;

create unique index acc_reconciliation_txn_journal_line_uq
  on acc_reconciliation (bank_transaction_id, journal_line_id)
  where journal_line_id is not null;

create unique index acc_reconciliation_approved_journal_line_uq
  on acc_reconciliation (journal_line_id)
  where journal_line_id is not null and status = 'approved';

-- New permissions are enforced at the RPC boundary.
insert into acc_permission (key, label, category, description, is_enforced) values
  ('bank_feed.manage', 'Manage direct bank feeds', 'Banking',
   'Connect financial institutions and synchronize bank transactions', true),
  ('banking.match', 'Review bank matches', 'Banking',
   'Generate, approve, and reject bank-to-ledger matches', true)
on conflict (key) do update
  set label = excluded.label,
      category = excluded.category,
      description = excluded.description,
      is_enforced = true;

insert into acc_role_permission (role, permission_key, allowed)
select r.role, p.key, r.role in ('admin'::acc_app_role, 'accountant'::acc_app_role)
  from (values ('admin'::acc_app_role), ('accountant'::acc_app_role), ('viewer'::acc_app_role)) r(role)
  cross join (values ('bank_feed.manage'), ('banking.match')) p(key)
on conflict (role, permission_key) do nothing;

insert into acc_sequence (key, prefix, next_value)
values ('bank_feed_sync', 'BFS-', 1)
on conflict (key) do nothing;

-- Metadata is visible to signed-in users. Connection mutations and every secret
-- operation are RPC-only. The secret table intentionally has no SELECT policy.
alter table acc_bank_connection        enable row level security;
alter table acc_bank_connection_secret enable row level security;
alter table acc_bank_feed_account      enable row level security;
alter table acc_bank_feed_sync_run     enable row level security;

create policy acc_bank_connection_read on acc_bank_connection
  for select using (acc_current_role() is not null);
create policy acc_bank_feed_account_read on acc_bank_feed_account
  for select using (acc_current_role() is not null);
create policy acc_bank_feed_sync_run_read on acc_bank_feed_sync_run
  for select using (acc_current_role() is not null);

create or replace function acc_bank_feed_authorized() returns boolean
language sql stable security definer set search_path = public as $$
  select acc_has_permission('bank_feed.manage') or auth.role() = 'service_role';
$$;

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
       account_mask, account_type, account_subtype, currency_code, last_balance_minor)
    values
      (v_connection,
       (v_mapping->>'bank_account_id')::uuid,
       v_mapping->>'provider_account_id',
       coalesce(nullif(v_mapping->>'account_name', ''), 'Connected account'),
       nullif(v_mapping->>'account_mask', ''),
       nullif(v_mapping->>'account_type', ''),
       nullif(v_mapping->>'account_subtype', ''),
       upper(v_mapping->>'currency_code'),
       nullif(v_mapping->>'last_balance_minor', '')::bigint)
    on conflict (connection_id, provider_account_id) do update
      set bank_account_id = excluded.bank_account_id,
          account_name = excluded.account_name,
          account_mask = excluded.account_mask,
          account_type = excluded.account_type,
          account_subtype = excluded.account_subtype,
          currency_code = excluded.currency_code,
          last_balance_minor = excluded.last_balance_minor,
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

create or replace function acc_get_bank_connection_token(p_connection_id uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare v_token text;
begin
  if not acc_bank_feed_authorized() then
    raise exception 'You do not have permission to synchronize bank feeds';
  end if;
  select encrypted_access_token into v_token
    from acc_bank_connection_secret
   where connection_id = p_connection_id;
  if v_token is null then raise exception 'Bank connection token was not found'; end if;
  return v_token;
end;
$$;

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
  insert into acc_bank_feed_sync_run (connection_id, started_by)
  values (p_connection_id, auth.uid())
  returning id into v_run;
  return v_run;
end;
$$;

create or replace function acc_apply_bank_feed_page(
  p_connection_id uuid,
  p_added          jsonb,
  p_modified       jsonb,
  p_removed        jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row jsonb;
  v_provider_id text;
  v_bank_account_id uuid;
  v_revision int;
  v_added int := 0;
  v_modified int := 0;
  v_removed int := 0;
begin
  if not acc_bank_feed_authorized() then
    raise exception 'You do not have permission to synchronize bank feeds';
  end if;

  for v_row in select value from jsonb_array_elements(coalesce(p_removed, '[]'::jsonb)) loop
    v_provider_id := case when jsonb_typeof(v_row) = 'string'
      then trim(both '"' from v_row::text) else v_row->>'external_transaction_id' end;
    update acc_bank_transaction
       set provider_removed_at = now(), status = 'ignored', updated_at = now()
     where external_transaction_id = v_provider_id
       and provider_removed_at is null
       and provider_account_id in (
         select provider_account_id from acc_bank_feed_account where connection_id = p_connection_id
       );
    get diagnostics v_revision = row_count;
    v_removed := v_removed + v_revision;
  end loop;

  for v_row in select value from jsonb_array_elements(coalesce(p_modified, '[]'::jsonb)) loop
    v_provider_id := v_row->>'external_transaction_id';
    select bank_account_id into v_bank_account_id
      from acc_bank_feed_account
     where connection_id = p_connection_id
       and provider_account_id = v_row->>'provider_account_id'
       and is_active;
    if v_bank_account_id is null then continue; end if;

    update acc_bank_transaction
       set provider_removed_at = now(), status = 'ignored', updated_at = now()
     where bank_account_id = v_bank_account_id
       and external_transaction_id = v_provider_id
       and provider_removed_at is null;

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
       nullif(v_row->>'category', ''));
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
       nullif(v_row->>'category', ''));
    v_added := v_added + 1;
  end loop;

  return jsonb_build_object('added', v_added, 'modified', v_modified, 'removed', v_removed);
end;
$$;

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
     set sync_cursor = case when p_error_message is null then p_cursor else sync_cursor end,
         last_sync_at = case when p_error_message is null then now() else last_sync_at end,
         last_error = p_error_message,
         status = case when p_error_message is null then 'active' else 'attention_required' end,
         updated_at = now()
   where id = v_connection;
end;
$$;

create or replace function acc_upsert_bank_match_suggestions(p_suggestions jsonb)
returns int
language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  if not (acc_has_permission('banking.match') or auth.role() = 'service_role') then
    raise exception 'You do not have permission to generate bank matches';
  end if;
  insert into acc_reconciliation
    (bank_transaction_id, journal_line_id, rule_applied, confidence, status)
  select
    (s->>'bank_transaction_id')::uuid,
    (s->>'journal_line_id')::uuid,
    s->>'rule_applied',
    (s->>'confidence')::numeric,
    'suggested'
  from jsonb_array_elements(coalesce(p_suggestions, '[]'::jsonb)) s
  on conflict (bank_transaction_id, journal_line_id) where journal_line_id is not null
  do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function acc_decide_bank_match(p_reconciliation_id uuid, p_decision text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_rec acc_reconciliation;
begin
  if not acc_has_permission('banking.match') then
    raise exception 'You do not have permission to review bank matches';
  end if;
  if p_decision not in ('approved', 'rejected') then raise exception 'Invalid match decision'; end if;

  select * into v_rec from acc_reconciliation where id = p_reconciliation_id for update;
  if not found then raise exception 'Bank match was not found'; end if;
  if v_rec.status <> 'suggested' then raise exception 'Only a suggested match can be decided'; end if;

  if p_decision = 'approved' then
    if v_rec.journal_line_id is not null and exists (
      select 1 from acc_reconciliation
       where journal_line_id = v_rec.journal_line_id
         and status = 'approved'
         and id <> p_reconciliation_id
    ) then
      raise exception 'This ledger line is already matched to another bank transaction';
    end if;
    update acc_reconciliation
       set status = 'rejected', updated_at = now()
     where bank_transaction_id = v_rec.bank_transaction_id
       and id <> p_reconciliation_id
       and status = 'suggested';
    update acc_bank_transaction
       set status = 'matched', updated_at = now()
     where id = v_rec.bank_transaction_id;
  end if;

  update acc_reconciliation
     set status = p_decision::acc_reconciliation_status,
         approved_by = case when p_decision = 'approved' then auth.uid() else null end,
         updated_at = now()
   where id = p_reconciliation_id;

  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
  values ('acc_reconciliation', p_reconciliation_id, 'update', auth.uid(),
          jsonb_build_object('status', p_decision,
                             'bank_transaction_id', v_rec.bank_transaction_id,
                             'journal_line_id', v_rec.journal_line_id));
end;
$$;

revoke all on function acc_save_bank_connection(text, text, text, text, jsonb) from public, anon;
revoke all on function acc_get_bank_connection_token(uuid) from public, anon;
revoke all on function acc_begin_bank_feed_sync(uuid) from public, anon;
revoke all on function acc_apply_bank_feed_page(uuid, jsonb, jsonb, jsonb) from public, anon;
revoke all on function acc_finish_bank_feed_sync(uuid, text, int, int, int, int, text) from public, anon;
revoke all on function acc_upsert_bank_match_suggestions(jsonb) from public, anon;
revoke all on function acc_decide_bank_match(uuid, text) from public, anon;

grant execute on function acc_save_bank_connection(text, text, text, text, jsonb) to authenticated;
grant execute on function acc_get_bank_connection_token(uuid) to authenticated, service_role;
grant execute on function acc_begin_bank_feed_sync(uuid) to authenticated, service_role;
grant execute on function acc_apply_bank_feed_page(uuid, jsonb, jsonb, jsonb) to authenticated, service_role;
grant execute on function acc_finish_bank_feed_sync(uuid, text, int, int, int, int, text) to authenticated, service_role;
grant execute on function acc_upsert_bank_match_suggestions(jsonb) to authenticated, service_role;
grant execute on function acc_decide_bank_match(uuid, text) to authenticated;
