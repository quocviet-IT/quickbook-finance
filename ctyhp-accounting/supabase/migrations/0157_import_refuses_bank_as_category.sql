-- 0157_import_refuses_bank_as_category.sql
--
-- A transactions import refuses a row whose Chart of account is its own bank.
--
-- Found on a real company's file (2026-10-22): every row named the bank
-- account in both the Bank account and the Chart of account columns. The
-- import screen let one choice of account answer for both columns, and with
-- the bank chosen it would have posted every row as a debit and a credit to
-- the same account. The categorise path (0111) already refuses this.
--
-- The function is replaced with the same signature and the same body as 0108,
-- with one check added after the two accounts are resolved. The user approved
-- changing acc_import_transactions for this.
set search_path = public;

create or replace function acc_import_transactions(
  p_rows jsonb,
  p_default_bank_account_id uuid,
  p_file_name text,
  p_sha256 text,
  p_line_count int
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r          jsonb;
  v_currency text;
  v_date     date;
  v_desc     text;
  v_signed   bigint;
  v_abs      bigint;
  v_base     bigint;
  v_bank     uuid;
  v_category uuid;
  v_feed     uuid;
  v_txn      uuid;
  v_entry    uuid;
  v_line     uuid;
  v_hash     text;
  v_batch    uuid;
  v_imported int := 0;
  v_skipped  int := 0;
  v_total    bigint := 0;
  v_from     date;
  v_to       date;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to import transactions';
  end if;
  if btrim(coalesce(p_file_name, '')) = '' then
    raise exception 'An import must say which file it came from';
  end if;
  if coalesce(p_sha256, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'An import must carry the checksum of its file';
  end if;

  -- The same file, still live, is a mistake worth naming rather than a run
  -- that quietly skips every row and reports nothing done.
  if exists (select 1 from acc_import_batch where sha256 = p_sha256 and status = 'active') then
    raise exception
      'This exact file has already been imported. Undo that import first if you meant to redo it.';
  end if;

  select code into v_currency from acc_currency where is_base limit 1;
  if v_currency is null then raise exception 'No base currency is configured'; end if;

  insert into acc_import_batch
    (source, mode, file_name, sha256, entry_count, line_count, total_minor, imported_by)
  values ('transactions', 'history', btrim(p_file_name), p_sha256, 0,
          greatest(coalesce(p_line_count, 0), 0), 0, auth.uid())
  returning id into v_batch;

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
    -- The bank on both sides is not a transaction. It is two lines cancelling
    -- on one account: the bank balance never moves, no income or expense is
    -- recorded, and the bank line is marked matched against nothing that
    -- explains it. 0111 refuses this when a line is categorised under Banking;
    -- the import let it through, and a file naming the bank in both columns
    -- would have posted every row that way.
    if v_category = v_bank then
      raise exception
        'The row dated % names the bank account itself as its Chart of account. Each row needs the income or expense account its money belongs to.',
        v_date;
    end if;

    v_hash := r->>'raw_hash';
    select id into v_feed from acc_bank_account where account_id = v_bank limit 1;
    -- No bank record, no dedupe: the unique index on (bank_account_id,
    -- raw_hash) is the *only* thing standing between a second import and a
    -- doubled ledger. Refusing here is the difference between an inconvenience
    -- and books nobody can trust.
    if v_feed is null then
      raise exception
        'No bank record for the account used here. Add it under Banking before importing, '
        'so a second import of the same file cannot post twice.';
    end if;

    -- The bank line first: if this row has been brought across before, the
    -- unique index refuses it and the row is skipped whole, ledger included.
    insert into acc_bank_transaction
      (bank_account_id, txn_date, description, amount_minor, raw_hash, status, source,
       transaction_batch_id)
    values (v_feed, v_date, v_desc, v_signed, v_hash, 'matched', 'file_upload', v_batch)
    on conflict (bank_account_id, raw_hash) do nothing
    returning id into v_txn;

    if v_txn is null then
      v_skipped := v_skipped + 1;
      continue;
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

    insert into acc_import_batch_entry (batch_id, journal_entry_id)
    values (v_batch, v_entry);

    -- A bank line marked matched that points at nothing would be a lie.
    select id into v_line from acc_journal_line
     where journal_entry_id = v_entry and account_id = v_bank limit 1;
    insert into acc_reconciliation (bank_transaction_id, journal_line_id, status, confidence)
    values (v_txn, v_line, 'approved', 1.000);

    v_imported := v_imported + 1;
    v_total    := v_total + v_abs;
    v_from     := least(coalesce(v_from, v_date), v_date);
    v_to       := greatest(coalesce(v_to, v_date), v_date);
  end loop;

  -- An import that posted nothing leaves no batch: a register full of empty
  -- rows nobody can undo is noise in front of the ones that matter.
  if v_imported = 0 then
    delete from acc_import_batch where id = v_batch;
    return jsonb_build_object('imported', 0, 'skipped', v_skipped, 'batch_id', null);
  end if;

  update acc_import_batch
     set entry_count = v_imported,
         total_minor = v_total,
         from_date   = v_from,
         to_date     = v_to
   where id = v_batch;

  return jsonb_build_object('imported', v_imported, 'skipped', v_skipped, 'batch_id', v_batch);
end;
$$;

revoke all on function acc_import_transactions(jsonb, uuid, text, text, int) from public, anon;
grant execute on function acc_import_transactions(jsonb, uuid, text, text, int)
  to authenticated, service_role;
