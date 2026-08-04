-- 0094 — Importing many invoices at once.
--
-- Typing one invoice is fine; typing two hundred is what the request was about.
--
-- This resolves names to records and delegates everything else. It does NOT
-- write acc_invoice or acc_invoice_line: acc_create_draft_invoice owns how a
-- draft is built, what its lines must satisfy, and its audit trail, and a second
-- writer would be a second set of rules to keep in step.
--
-- Two deliberate refusals, both because the alternative is worse than failing:
--
--   * An unknown customer name is reported, never created. "Elena Brooks" and
--     "Elena brooks" would become two customers, and nobody would find out
--     until the receivables stopped tying.
--   * An income account that is not active, posting, and of type `income` is
--     refused. Same rule the invoice screen enforces since 0092's sibling work:
--     other_income holds accounts the system posts to on its own, and a sale
--     billed there lands in the wrong half of the Profit & Loss.
--
-- Everything lands as a DRAFT. Issuing debits Accounts Receivable and consumes
-- a number from the sequence; two hundred of those from an unreviewed file is
-- not something an import screen should be able to do.
create or replace function acc_import_invoices(p_rows jsonb)
returns table (created int, skipped int, problems jsonb)
language plpgsql security definer set search_path = public as $$
declare
  doc        jsonb;
  ln         jsonb;
  v_created  int := 0;
  v_skipped  int := 0;
  v_problems jsonb := '[]'::jsonb;
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

    -- The customer must already be on file. Matched without regard to case or
    -- surrounding space, because a spreadsheet carries both.
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
        -- By code first, then by name: a file may carry either, and a code is
        -- the less ambiguous of the two.
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

    -- The file's own number goes into the memo rather than into the document
    -- number: acc_sequence issues ours when the invoice is issued, and a number
    -- from another system must not be mistaken for one of ours.
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
  end loop;

  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
  values ('acc_invoice', gen_random_uuid(), 'insert', auth.uid(),
          jsonb_build_object('source', 'invoice_import', 'created', v_created,
                             'skipped', v_skipped, 'problems', v_problems));

  return query select v_created, v_skipped, v_problems;
end;
$$;

revoke all on function acc_import_invoices(jsonb) from public, anon;
grant execute on function acc_import_invoices(jsonb) to authenticated;
