-- ============================================================================
-- 0102  Importing a general ledger from another product
--
-- The file behind feedback 428ca4db is Wave's "Account Transactions" report: a
-- complete general ledger where every row is one side of a double entry and
-- the other side is a row in another account's section.
--
-- Pairing the halves would be guesswork. The client groups the rows by date
-- instead — in the real file all 554 dates balance exactly — and sends the
-- whole file here in one call, so it posts inside one transaction and a closed
-- period or an unknown account rolls all of it back.
--
-- Two things this migration exists to make possible:
--
--   * a file cannot be imported twice, whichever mode is chosen, because the
--     batch holds its sha256;
--   * an import can be undone, because the batch remembers every entry it
--     created. Nothing else in One Book can void a plain journal entry, and
--     three years of ledger with no way back is a button nobody dares press.
-- ============================================================================

set search_path = public;

-- ----------------------------------------------------------------------------
-- Matching an account reference the way a person reads it.
--
-- Wave writes "Taxes – Corporate Tax" with an EN DASH. A chart holding a plain
-- hyphen would not match, and the import would refuse a file over a difference
-- nobody can see. Every dash character becomes a hyphen before comparison.
-- ----------------------------------------------------------------------------
create or replace function acc_normalize_ref(p_ref text) returns text
language sql immutable as $$
  select lower(btrim(translate(coalesce(p_ref, ''), '‐‑‒–—―', '------')));
$$;

revoke all on function acc_normalize_ref(text) from public, anon;
grant execute on function acc_normalize_ref(text) to authenticated, service_role;

create or replace function acc_resolve_account_ref(p_ref text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  v_ref text := acc_normalize_ref(p_ref);
  v_id  uuid;
begin
  if v_ref = '' then return null; end if;

  select id into v_id from acc_account
   where acc_normalize_ref(account_code) = v_ref and status <> 'archived'
   limit 1;
  if v_id is not null then return v_id; end if;

  select id into v_id from acc_account
   where acc_normalize_ref(account_code || ' - ' || name) = v_ref and status <> 'archived'
   limit 1;
  if v_id is not null then return v_id; end if;

  select id into v_id from acc_account
   where acc_normalize_ref(name) = v_ref and status <> 'archived'
   limit 1;
  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- What was imported, and what it created.
-- ----------------------------------------------------------------------------
create table if not exists acc_import_batch (
  id              uuid primary key default gen_random_uuid(),
  source          text not null check (source in ('wave_ledger')),
  mode            text not null check (mode in ('history', 'balances')),
  file_name       text not null check (length(btrim(file_name)) > 0),
  sha256          text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  entry_count     int  not null check (entry_count >= 0),
  line_count      int  not null check (line_count >= 0),
  from_date       date,
  to_date         date,
  -- Total debits posted, so a batch can be recognised at a glance without
  -- reading its entries back.
  total_minor     bigint not null check (total_minor >= 0),
  saved_report_id uuid references acc_saved_report (id),
  status          text not null default 'active' check (status in ('active', 'voided')),
  imported_by     uuid references auth.users (id),
  imported_at     timestamptz not null default now(),
  voided_by       uuid references auth.users (id),
  voided_at       timestamptz,
  void_reason     text
);

-- One live import per file. Voiding frees the hash, so a corrected export of
-- the same ledger can be brought in after the mistake is undone.
create unique index if not exists acc_import_batch_sha_idx
  on acc_import_batch (sha256) where status = 'active';

create table if not exists acc_import_batch_entry (
  batch_id         uuid not null references acc_import_batch (id) on delete cascade,
  journal_entry_id uuid not null references acc_journal_entry (id),
  primary key (batch_id, journal_entry_id)
);

alter table acc_import_batch       enable row level security;
alter table acc_import_batch_entry enable row level security;

drop policy if exists acc_import_batch_sel on acc_import_batch;
create policy acc_import_batch_sel on acc_import_batch
  for select using (acc_has_permission('documents.read'));

drop policy if exists acc_import_batch_entry_sel on acc_import_batch_entry;
create policy acc_import_batch_entry_sel on acc_import_batch_entry
  for select using (acc_has_permission('documents.read'));

revoke all on table acc_import_batch, acc_import_batch_entry from public, anon;
grant select on table acc_import_batch, acc_import_batch_entry to authenticated;
grant all    on table acc_import_batch, acc_import_batch_entry to service_role;

/**
 * Post a whole general ledger file.
 *
 * p_entries is [{"date": "2023-01-03",
 *                "lines": [{"account": "121 - …", "signed_minor": 100,
 *                           "description": "…"}, …]}, …]
 * where a positive signed_minor debits and a negative one credits.
 *
 * The account references are resolved here and not taken on trust from the
 * screen: the server is the authority on what a name means.
 */
create or replace function acc_import_ledger_entries(
  p_source    text,
  p_mode      text,
  p_file_name text,
  p_sha256    text,
  p_entries   jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_batch     uuid;
  v_entry     jsonb;
  v_line      jsonb;
  v_date      date;
  v_account   uuid;
  v_signed    bigint;
  v_sum       bigint;
  v_lines     jsonb;
  v_currency  text;
  v_source    acc_journal_source;
  v_equity    uuid;
  v_entry_id  uuid;
  v_entries   int := 0;
  v_count     int := 0;
  v_total     bigint := 0;
  v_from      date;
  v_to        date;
  v_existing  record;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to import a ledger';
  end if;
  if p_mode not in ('history', 'balances') then
    raise exception 'Unknown import mode "%"', p_mode;
  end if;

  select b.imported_at, coalesce(nullif(btrim(u.full_name), ''), 'another user') as who
    into v_existing
    from acc_import_batch b
    left join acc_app_user u on u.id = b.imported_by
   where b.sha256 = p_sha256 and b.status = 'active'
   limit 1;
  if found then
    raise exception 'This file was already imported on % by %. Undo that import first.',
      to_char(v_existing.imported_at, 'YYYY-MM-DD'), v_existing.who;
  end if;

  select code into v_currency from acc_currency where is_base limit 1;
  if v_currency is null then raise exception 'No base currency is configured'; end if;

  v_source := case when p_mode = 'history' then 'manual' else 'opening_balance' end;

  insert into acc_import_batch
    (source, mode, file_name, sha256, entry_count, line_count, total_minor, imported_by)
  values (p_source, p_mode, btrim(p_file_name), p_sha256, 0, 0, 0, auth.uid())
  returning id into v_batch;

  for v_entry in select * from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb))
  loop
    v_date := (v_entry->>'date')::date;
    v_from := least(coalesce(v_from, v_date), v_date);
    v_to   := greatest(coalesce(v_to, v_date), v_date);
    v_lines := '[]'::jsonb;
    v_sum := 0;

    for v_line in select * from jsonb_array_elements(v_entry->'lines')
    loop
      v_signed := (v_line->>'signed_minor')::bigint;
      if v_signed = 0 then continue; end if;
      v_account := acc_resolve_account_ref(v_line->>'account');
      if v_account is null then
        raise exception 'Account not found for "%"', coalesce(v_line->>'account', '(none)');
      end if;
      v_sum := v_sum + v_signed;
      v_total := v_total + greatest(v_signed, 0);
      v_count := v_count + 1;
      v_lines := v_lines || jsonb_build_object(
        'account_id', v_account,
        'debit_minor',  case when v_signed > 0 then  v_signed else 0 end,
        'credit_minor', case when v_signed < 0 then -v_signed else 0 end,
        'amount_base_minor', acc_to_base_minor(abs(v_signed), v_currency, v_date),
        'memo', left(coalesce(v_line->>'description', ''), 200));
    end loop;

    if jsonb_array_length(v_lines) = 0 then continue; end if;

    -- A closing-balances file that does not net to zero is normal: it is a
    -- slice of somebody's books. The difference goes to Opening Balance
    -- Equity, which is what that account is for. A history file that does not
    -- balance is a parsing failure and must not post.
    if v_sum <> 0 then
      if p_mode <> 'balances' then
        raise exception 'The entries for % do not balance (% off)', v_date, v_sum;
      end if;
      select id into v_equity from acc_account where account_code = '3900' limit 1;
      if v_equity is null then
        raise exception 'Opening Balance Equity account (3900) is missing';
      end if;
      v_lines := v_lines || jsonb_build_object(
        'account_id', v_equity,
        'debit_minor',  case when v_sum < 0 then -v_sum else 0 end,
        'credit_minor', case when v_sum > 0 then  v_sum else 0 end,
        'amount_base_minor', acc_to_base_minor(abs(v_sum), v_currency, v_date),
        'memo', 'Opening balance difference');
      v_count := v_count + 1;
    end if;

    v_entry_id := acc_post_entry(
      v_date,
      case when p_mode = 'history'
        then 'Wave general ledger — ' || btrim(p_file_name)
        else 'Wave closing balances — ' || btrim(p_file_name) end,
      v_source, null, v_currency, v_lines);

    insert into acc_import_batch_entry (batch_id, journal_entry_id)
    values (v_batch, v_entry_id);
    v_entries := v_entries + 1;
  end loop;

  update acc_import_batch
     set entry_count = v_entries,
         line_count  = v_count,
         total_minor = v_total,
         from_date   = v_from,
         to_date     = v_to
   where id = v_batch;

  return jsonb_build_object('batch_id', v_batch, 'entries', v_entries, 'lines', v_count);
end;
$$;

/**
 * Undo an import.
 *
 * It voids the entries this batch created and nothing else — this is not a
 * general "void any journal entry" door. Voiding an entry dated in a closed
 * period is refused by the trigger from migration 0029, which is correct: a
 * closed period is corrected by a reversal, not by rewriting history.
 */
create or replace function acc_void_import_batch(p_batch_id uuid, p_reason text)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_voided int;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to undo an import';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Say why this import is being undone';
  end if;
  if not exists (select 1 from acc_import_batch where id = p_batch_id and status = 'active') then
    raise exception 'Import not found, or already undone';
  end if;

  update acc_journal_entry e
     set status = 'void', voided_at = now()
   where e.status = 'posted'
     and e.id in (select journal_entry_id from acc_import_batch_entry where batch_id = p_batch_id);
  get diagnostics v_voided = row_count;

  update acc_import_batch
     set status = 'voided', voided_by = auth.uid(), voided_at = now(),
         void_reason = btrim(p_reason)
   where id = p_batch_id;

  return v_voided;
end;
$$;

/** Attach the copy of the original file that was kept under Saved Reports. */
create or replace function acc_link_import_batch_report(p_batch_id uuid, p_report_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to change an import';
  end if;
  update acc_import_batch set saved_report_id = p_report_id where id = p_batch_id;
  if not found then raise exception 'Import not found'; end if;
end;
$$;

revoke all on function acc_import_ledger_entries(text, text, text, text, jsonb) from public, anon;
grant execute on function acc_import_ledger_entries(text, text, text, text, jsonb)
  to authenticated, service_role;

revoke all on function acc_void_import_batch(uuid, text) from public, anon;
grant execute on function acc_void_import_batch(uuid, text) to authenticated, service_role;

revoke all on function acc_link_import_batch_report(uuid, uuid) from public, anon;
grant execute on function acc_link_import_batch_report(uuid, uuid) to authenticated, service_role;
