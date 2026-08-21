-- ============================================================================
-- 0116  The import register covers invoices, and an invoice import can be undone
--
-- Asked for after a real import: "bổ sung thêm tính năng này sau khi import.
-- Nhớ ghi nhận thêm cột người import. có thể undo lại để clear dữ liệu."
--
-- 0102 built a register for one kind of import — a Wave general ledger — and
-- gave it what a register needs: who brought the file in, when, and a way to
-- undo it. Everything else imported silently. An invoice import left no record
-- at all, so nobody could say afterwards which file the drafts came from, who
-- ran it, or how to take them back out.
--
-- This widens that register rather than building a second one beside it. A
-- second register would be a second answer to "what has been imported into
-- this company", and the two would drift.
--
-- Undo is deliberately not the ledger's undo. A ledger import posts entries, so
-- undoing it voids them and the trail stays. An invoice import raises DRAFTS —
-- no number consumed, nothing posted — so undoing it deletes them, which is the
-- only thing that actually clears the data the reader is looking at. An invoice
-- that has since been issued is left exactly where it is and reported: it has a
-- number from our own sequence and a journal entry behind it, and 0066 refuses
-- to delete it for the same reason a person should.
-- ============================================================================

set search_path = public;

-- --- The importer says which invoices it raised ------------------------------
-- 0094 returned only counts, which was enough when nothing linked back to the
-- documents. The register needs the ids, so the function now returns them.
-- Dropped and recreated rather than replaced: Postgres will not change the
-- shape of a `returns table` in place, and the only caller is our own service.
drop function if exists acc_import_invoices(jsonb);

create or replace function acc_import_invoices(p_rows jsonb)
returns table (created int, skipped int, problems jsonb, invoice_ids uuid[])
language plpgsql security definer set search_path = public as $$
declare
  doc        jsonb;
  ln         jsonb;
  v_created  int := 0;
  v_skipped  int := 0;
  v_problems jsonb := '[]'::jsonb;
  v_ids      uuid[] := array[]::uuid[];
  v_customer uuid;
  v_account  uuid;
  v_tax      uuid;
  v_lines    jsonb;
  v_currency text;
  v_ref      text;
  v_bad      text;
  v_invoice  uuid;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to import invoices';
  end if;

  select code into v_currency from acc_currency where is_base limit 1;

  for doc in select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    v_ref := coalesce(doc->>'external_reference', '(no reference)');
    v_bad := null;
    v_lines := '[]'::jsonb;

    select id into v_customer
      from acc_customer
     where lower(btrim(name)) = lower(btrim(doc->>'customer'))
     order by created_at
     limit 1;

    if v_customer is null then
      v_bad := format('No customer named %s', doc->>'customer');
    end if;

    if v_bad is null then
      for ln in select value from jsonb_array_elements(coalesce(doc->'lines', '[]'::jsonb))
      loop
        select id into v_account
          from acc_account
         where (account_code = btrim(ln->>'income_account')
                or lower(btrim(name)) = lower(btrim(ln->>'income_account')))
           and account_type = 'income'
           and is_posting_account
           and status = 'active'
         order by account_code
         limit 1;

        if v_account is null then
          v_bad := format('No active income account matches %s', ln->>'income_account');
          exit;
        end if;

        v_tax := null;
        if coalesce(btrim(ln->>'tax_code'), '') <> '' then
          select id into v_tax
            from acc_tax_code
           where lower(btrim(code)) = lower(btrim(ln->>'tax_code'))
              or lower(btrim(name)) = lower(btrim(ln->>'tax_code'))
           limit 1;
          if v_tax is null then
            v_bad := format('No sales tax code matches %s', ln->>'tax_code');
            exit;
          end if;
        end if;

        v_lines := v_lines || jsonb_build_object(
          'description', coalesce(ln->>'description', ''),
          'quantity', (ln->>'quantity')::numeric,
          'unit_price_minor', (ln->>'unit_price_minor')::bigint,
          'income_account_id', v_account,
          'tax_code_id', v_tax);
      end loop;
    end if;

    if v_bad is null and jsonb_array_length(v_lines) = 0 then
      v_bad := 'No usable lines';
    end if;

    if v_bad is not null then
      v_skipped := v_skipped + 1;
      v_problems := v_problems || jsonb_build_object('reference', v_ref, 'message', v_bad);
      continue;
    end if;

    v_invoice := acc_create_draft_invoice(
      v_customer,
      (doc->>'issue_date')::date,
      nullif(doc->>'due_date', '')::date,
      v_currency,
      btrim(concat_ws(' · ', nullif(btrim(coalesce(doc->>'memo', '')), ''),
                      format('Imported as %s', v_ref))),
      v_lines,
      null);

    v_created := v_created + 1;
    v_ids := v_ids || v_invoice;
  end loop;

  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
  values ('acc_invoice', gen_random_uuid(), 'insert', auth.uid(),
          jsonb_build_object('source', 'invoice_import', 'created', v_created,
                             'skipped', v_skipped, 'problems', v_problems));

  return query select v_created, v_skipped, v_problems, v_ids;
end;
$$;

revoke all on function acc_import_invoices(jsonb) from public, anon;
grant execute on function acc_import_invoices(jsonb) to authenticated;

-- --- The register learns two more words -------------------------------------
-- Every value the register already accepts has to be listed again: a check
-- constraint is replaced whole, not added to, and dropping one silently
-- narrows what the table will hold. 0108 added 'transactions' to 0102's
-- 'wave_ledger', and leaving it out here made the migration refuse a company
-- that had already imported transactions.
alter table acc_import_batch drop constraint if exists acc_import_batch_source_check;
alter table acc_import_batch add constraint acc_import_batch_source_check
  check (source in ('wave_ledger', 'transactions', 'invoices'));

alter table acc_import_batch drop constraint if exists acc_import_batch_mode_check;
alter table acc_import_batch add constraint acc_import_batch_mode_check
  check (mode in ('history', 'balances', 'documents'));

-- --- What a batch of documents produced -------------------------------------
-- Kept apart from acc_import_batch_entry, which links journal entries: these
-- are documents, and a draft has no journal entry to link.
create table if not exists acc_import_batch_document (
  batch_id      uuid not null references acc_import_batch (id) on delete cascade,
  document_kind text not null check (document_kind in ('invoice')),
  document_id   uuid not null,
  primary key (batch_id, document_kind, document_id)
);

create index if not exists acc_import_batch_document_doc_idx
  on acc_import_batch_document (document_kind, document_id);

alter table acc_import_batch_document enable row level security;

drop policy if exists acc_import_batch_document_sel on acc_import_batch_document;
create policy acc_import_batch_document_sel on acc_import_batch_document
  for select using (acc_current_role() is not null);

revoke all on table acc_import_batch_document from public, anon;
grant select on table acc_import_batch_document to authenticated;
grant all    on table acc_import_batch_document to service_role;

/**
 * Record what an invoice import brought in, and link every draft it raised.
 *
 * Called after acc_import_invoices, with the ids it created. The file's hash
 * goes in for the same reason the ledger import records one: the unique index
 * on an active batch means the same file cannot be imported twice while its
 * first import still stands.
 */
create or replace function acc_record_invoice_import(
  p_file_name  text,
  p_sha256     text,
  p_invoices   uuid[],
  p_line_count int,
  p_total_minor bigint
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_batch uuid;
  v_id    uuid;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to import invoices';
  end if;

  insert into acc_import_batch (
    source, mode, file_name, sha256, entry_count, line_count, total_minor, imported_by
  ) values (
    'invoices', 'documents', p_file_name, p_sha256,
    coalesce(array_length(p_invoices, 1), 0), greatest(coalesce(p_line_count, 0), 0),
    greatest(coalesce(p_total_minor, 0), 0), auth.uid()
  ) returning id into v_batch;

  foreach v_id in array coalesce(p_invoices, array[]::uuid[])
  loop
    insert into acc_import_batch_document (batch_id, document_kind, document_id)
    values (v_batch, 'invoice', v_id)
    on conflict do nothing;
  end loop;

  return v_batch;
end $$;

/**
 * Take an invoice import back out.
 *
 * Deletes the drafts this batch raised — that is what "clear the data" means
 * for a document that never posted. An invoice that has been issued since is
 * skipped and counted: it holds a number from acc_sequence and a posted
 * journal entry, and taking it back is a void, which is a decision for a
 * person on the invoice itself rather than a side effect of undoing a file.
 *
 * Returns the two figures a reader needs afterwards: how many drafts went, and
 * how many were left behind because they had moved on.
 */
create or replace function acc_undo_invoice_import(p_batch_id uuid, p_reason text)
returns table (removed int, kept int)
language plpgsql security definer set search_path = public as $$
declare
  v_removed int := 0;
  v_kept    int := 0;
  v_id      uuid;
  v_status  text;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to undo an import';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Say why this import is being undone';
  end if;
  if not exists (
    select 1 from acc_import_batch
     where id = p_batch_id and status = 'active' and source = 'invoices'
  ) then
    raise exception 'Import not found, or already undone';
  end if;

  for v_id in
    select document_id from acc_import_batch_document
     where batch_id = p_batch_id and document_kind = 'invoice'
  loop
    select status::text into v_status from acc_invoice where id = v_id;
    if v_status is null then
      -- Already gone by another route. Nothing to remove, nothing to keep.
      continue;
    end if;
    if v_status <> 'draft' then
      v_kept := v_kept + 1;
      continue;
    end if;
    delete from acc_invoice_line where invoice_id = v_id;
    delete from acc_invoice where id = v_id;
    v_removed := v_removed + 1;
  end loop;

  update acc_import_batch
     set status = 'voided', voided_by = auth.uid(), voided_at = now(),
         void_reason = btrim(p_reason)
   where id = p_batch_id;

  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
  values ('acc_import_batch', p_batch_id, 'update', auth.uid(),
          jsonb_build_object('source', 'invoice_import_undo',
                             'removed', v_removed, 'kept', v_kept,
                             'reason', btrim(p_reason)));

  return query select v_removed, v_kept;
end $$;

revoke all on function acc_record_invoice_import(text, text, uuid[], int, bigint) from public, anon;
grant execute on function acc_record_invoice_import(text, text, uuid[], int, bigint)
  to authenticated, service_role;
revoke all on function acc_undo_invoice_import(uuid, text) from public, anon;
grant execute on function acc_undo_invoice_import(uuid, text) to authenticated, service_role;
