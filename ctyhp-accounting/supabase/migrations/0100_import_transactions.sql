-- ============================================================================
-- 0100  Bringing categorized transactions across from another product
--
-- Asked for on video, 2026-08-05: "transactions coming from Wave because it is
-- already categorized there". Each row carries both sides — a bank account and
-- a chart-of-account — so each row is a journal entry, not a line waiting to be
-- matched by hand.
--
-- Two rules this function exists to keep:
--
--   * It posts through acc_post_entry like every other document, so the closed
--     period guard and the balance check are the ones already trusted.
--   * It writes an acc_bank_transaction marked matched for every entry. Without
--     it, connecting a bank feed for the same account later would import the
--     same money a second time with nothing to say it was already here.
--
-- An account the chart does not have raises. Creating one from a transaction
-- row is how a chart of accounts fills with typos.
-- ============================================================================

set search_path = public;

-- Resolve "121", "121 - PC49 BoA CK 3388" or "PC49 BoA CK 3388" to one account.
create or replace function acc_resolve_account_ref(p_ref text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  v_ref text := lower(btrim(coalesce(p_ref, '')));
  v_id  uuid;
begin
  if v_ref = '' then return null; end if;

  select id into v_id from acc_account
   where lower(btrim(account_code)) = v_ref and status <> 'archived'
   limit 1;
  if v_id is not null then return v_id; end if;

  select id into v_id from acc_account
   where lower(btrim(account_code || ' - ' || name)) = v_ref and status <> 'archived'
   limit 1;
  if v_id is not null then return v_id; end if;

  select id into v_id from acc_account
   where lower(btrim(name)) = v_ref and status <> 'archived'
   limit 1;
  return v_id;
end;
$$;

revoke all on function acc_resolve_account_ref(text) from public, anon;
grant execute on function acc_resolve_account_ref(text) to authenticated, service_role;

create or replace function acc_import_transactions(
  p_rows jsonb,
  p_default_bank_account_id uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r          jsonb;
  v_bank     uuid;
  v_category uuid;
  v_signed   bigint;
  v_abs      bigint;
  v_date     date;
  v_desc     text;
  v_hash     text;
  v_currency text;
  v_base     bigint;
  v_entry    uuid;
  v_txn      uuid;
  v_line     uuid;
  v_feed     uuid;
  v_imported int := 0;
  v_skipped  int := 0;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to import transactions';
  end if;

  select code into v_currency from acc_currency where is_base limit 1;
  if v_currency is null then raise exception 'No base currency is configured'; end if;

  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    v_date   := (r->>'txn_date')::date;
    v_desc   := btrim(coalesce(r->>'description', ''));
    v_signed := (r->>'signed_minor')::bigint;
    v_abs    := abs(v_signed);
    if v_signed = 0 then
      raise exception 'A transaction of zero cannot be posted (%)', v_date;
    end if;

    -- The client resolved these too; doing it again here is what makes the
    -- server the authority rather than the screen.
    v_bank := coalesce(acc_resolve_account_ref(r->>'bank_account'), p_default_bank_account_id);
    if v_bank is null then
      raise exception 'Account not found for bank "%"', coalesce(r->>'bank_account', '(none)');
    end if;
    v_category := acc_resolve_account_ref(r->>'category_account');
    if v_category is null then
      raise exception 'Account not found for "%"', coalesce(r->>'category_account', '(none)');
    end if;

    v_hash := r->>'raw_hash';
    select id into v_feed from acc_bank_account where account_id = v_bank limit 1;

    -- The bank line first: if this file has been imported before, the unique
    -- index refuses it and the row is skipped whole, ledger included.
    v_txn := null;
    if v_feed is not null then
      insert into acc_bank_transaction
        (bank_account_id, txn_date, description, amount_minor, raw_hash, status, source)
      values (v_feed, v_date, v_desc, v_signed, v_hash, 'matched', 'file_upload')
      on conflict (bank_account_id, raw_hash) do nothing
      returning id into v_txn;

      if v_txn is null then
        v_skipped := v_skipped + 1;
        continue;
      end if;
    end if;

    v_base := acc_to_base_minor(v_abs, v_currency, v_date);

    v_entry := acc_post_entry(
      v_date,
      case when v_desc = '' then 'Imported transaction' else v_desc end,
      'bank', null, v_currency,
      case when v_signed > 0 then
        jsonb_build_array(
          jsonb_build_object('account_id', v_bank, 'debit_minor', v_abs, 'credit_minor', 0,
            'amount_base_minor', v_base, 'memo', v_desc),
          jsonb_build_object('account_id', v_category, 'debit_minor', 0, 'credit_minor', v_abs,
            'amount_base_minor', v_base, 'memo', v_desc)
        )
      else
        jsonb_build_array(
          jsonb_build_object('account_id', v_category, 'debit_minor', v_abs, 'credit_minor', 0,
            'amount_base_minor', v_base, 'memo', v_desc),
          jsonb_build_object('account_id', v_bank, 'debit_minor', 0, 'credit_minor', v_abs,
            'amount_base_minor', v_base, 'memo', v_desc)
        )
      end);

    -- A bank line marked matched that points at nothing would be a lie.
    if v_txn is not null then
      select id into v_line from acc_journal_line
       where journal_entry_id = v_entry and account_id = v_bank limit 1;
      insert into acc_reconciliation (bank_transaction_id, journal_line_id, status, confidence)
      values (v_txn, v_line, 'approved', 1.000);
    end if;

    v_imported := v_imported + 1;
  end loop;

  return jsonb_build_object('imported', v_imported, 'skipped', v_skipped);
end;
$$;

revoke all on function acc_import_transactions(jsonb, uuid) from public, anon;
grant execute on function acc_import_transactions(jsonb, uuid) to authenticated, service_role;
