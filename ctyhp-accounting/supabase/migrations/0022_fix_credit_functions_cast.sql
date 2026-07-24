-- Fix: SUM(bigint) returns numeric in Postgres, so the grouped income/tax
-- amounts must be cast back to bigint before calling acc_to_base_minor(bigint..).
-- Same class of bug as 0007's fix for acc_issue_invoice; here it affects
-- acc_issue_credit_memo and acc_issue_vendor_credit (grouped-line loops).
create or replace function acc_issue_credit_memo(p_credit_memo_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_cm    acc_credit_memo;
  v_ar    uuid;
  v_number text;
  v_lines jsonb := '[]'::jsonb;
  v_entry uuid;
  rec     record;
begin
  if not acc_is_staff() then raise exception 'Not authorized to issue credit memos'; end if;
  select * into v_cm from acc_credit_memo where id = p_credit_memo_id for update;
  if not found then raise exception 'Credit memo not found'; end if;
  if v_cm.status <> 'draft' then raise exception 'Only draft credit memos can be issued'; end if;
  if v_cm.total_minor <= 0 then raise exception 'Credit memo total must be positive'; end if;

  v_ar := acc_active_ar_account();
  if v_ar is null then raise exception 'No active Accounts Receivable account configured'; end if;

  -- DR income (grouped by income account)
  for rec in
    select income_account_id as acc, sum(line_subtotal_minor)::bigint as amt
      from acc_credit_memo_line where credit_memo_id = p_credit_memo_id
      group by income_account_id having sum(line_subtotal_minor) <> 0
  loop
    v_lines := v_lines || jsonb_build_object('account_id', rec.acc, 'debit_minor', rec.amt,
      'credit_minor', 0, 'amount_base_minor', acc_to_base_minor(rec.amt, v_cm.currency_code, v_cm.memo_date),
      'memo', 'Credit memo income');
  end loop;
  -- DR sales tax payable (grouped by tax account)
  for rec in
    select tc.tax_account_id as acc, sum(l.line_tax_minor)::bigint as amt
      from acc_credit_memo_line l join acc_tax_code tc on tc.id = l.tax_code_id
     where l.credit_memo_id = p_credit_memo_id and l.line_tax_minor > 0 and tc.tax_account_id is not null
     group by tc.tax_account_id
  loop
    v_lines := v_lines || jsonb_build_object('account_id', rec.acc, 'debit_minor', rec.amt,
      'credit_minor', 0, 'amount_base_minor', acc_to_base_minor(rec.amt, v_cm.currency_code, v_cm.memo_date),
      'memo', 'Credit memo tax');
  end loop;
  -- CR Accounts Receivable (total)
  v_lines := v_lines || jsonb_build_object('account_id', v_ar, 'debit_minor', 0,
    'credit_minor', v_cm.total_minor, 'amount_base_minor', acc_to_base_minor(v_cm.total_minor, v_cm.currency_code, v_cm.memo_date),
    'memo', 'Accounts receivable credit');

  v_number := acc_next_number('credit_memo');
  v_entry := acc_post_entry(v_cm.memo_date, 'Credit memo ' || v_number, 'manual', p_credit_memo_id, v_cm.currency_code, v_lines);

  update acc_credit_memo set credit_memo_number = v_number, status = 'issued',
      balance_remaining_minor = total_minor, journal_entry_id = v_entry, updated_at = now()
   where id = p_credit_memo_id;
  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_credit_memo', p_credit_memo_id, 'post', auth.uid());
  return v_entry;
end;
$$;

create or replace function acc_issue_vendor_credit(p_vendor_credit_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_vc acc_vendor_credit; v_ap uuid; v_number text; v_lines jsonb := '[]'::jsonb; v_entry uuid; rec record;
begin
  if not acc_is_staff() then raise exception 'Not authorized to issue vendor credits'; end if;
  select * into v_vc from acc_vendor_credit where id = p_vendor_credit_id for update;
  if not found then raise exception 'Vendor credit not found'; end if;
  if v_vc.status <> 'draft' then raise exception 'Only draft vendor credits can be issued'; end if;
  if v_vc.total_minor <= 0 then raise exception 'Vendor credit total must be positive'; end if;

  v_ap := coalesce((select ap_account_id from acc_vendor where id = v_vc.vendor_id), acc_active_ap_account());
  if v_ap is null then raise exception 'No active Accounts Payable account configured'; end if;

  v_lines := v_lines || jsonb_build_object('account_id', v_ap, 'debit_minor', v_vc.total_minor, 'credit_minor', 0,
    'amount_base_minor', acc_to_base_minor(v_vc.total_minor, v_vc.currency_code, v_vc.credit_date), 'memo', 'Accounts payable credit');
  for rec in
    select expense_account_id as acc, sum(amount_minor)::bigint as amt
      from acc_vendor_credit_line where vendor_credit_id = p_vendor_credit_id
      group by expense_account_id having sum(amount_minor) <> 0
  loop
    v_lines := v_lines || jsonb_build_object('account_id', rec.acc, 'debit_minor', 0, 'credit_minor', rec.amt,
      'amount_base_minor', acc_to_base_minor(rec.amt, v_vc.currency_code, v_vc.credit_date), 'memo', 'Vendor credit expense');
  end loop;

  v_number := acc_next_number('vendor_credit');
  v_entry := acc_post_entry(v_vc.credit_date, 'Vendor credit ' || v_number, 'manual', p_vendor_credit_id, v_vc.currency_code, v_lines);
  update acc_vendor_credit set vendor_credit_number = v_number, status='issued',
      balance_remaining_minor = total_minor, journal_entry_id = v_entry, updated_at=now()
   where id = p_vendor_credit_id;
  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_vendor_credit', p_vendor_credit_id, 'post', auth.uid());
  return v_entry;
end;
$$;
