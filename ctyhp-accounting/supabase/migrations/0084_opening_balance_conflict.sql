-- ============================================================================
-- 0084 — The same rule, applied to the money as well as the account.
--
-- 0083 stopped an import repurposing an existing account: 2100 is a Visa card
-- in the file and Sales Tax Payable here, so the account was left alone.
--
-- The *balance* was not. It still went to account 2100 — the sales tax control
-- account — and put it out by the value of somebody's credit card. Refusing to
-- rename an account while cheerfully posting a foreign balance to it is half a
-- rule, and half a rule is what produces the quiet kind of wrong.
--
-- So the balance carries the type the file believed the account to be, and if
-- that is not what the account actually is, nothing posts.
-- ============================================================================

create or replace function acc_post_opening_balances(p_as_of date, p_rows jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  rec       record;
  v_obe     uuid;
  v_lines   jsonb := '[]'::jsonb;
  v_net     bigint := 0;
  v_account acc_account;
  v_entry   uuid;
begin
  if not acc_is_admin() then raise exception 'Only an admin can post opening balances'; end if;

  v_obe := acc_opening_balance_equity_account();
  if v_obe is null then raise exception 'No Opening Balance Equity account is configured'; end if;

  for rec in
    select r->>'account_code' as code,
           nullif(r->>'account_type', '') as expected_type,
           coalesce((r->>'amount_minor')::bigint, 0) as amount
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
  loop
    if rec.amount = 0 then continue; end if;

    select * into v_account from acc_account where account_code = rec.code;
    if not found then
      raise exception 'No account % — import the chart of accounts first', rec.code;
    end if;

    if v_account.account_type in ('accounts_receivable', 'accounts_payable') then
      raise exception
        'Account % is a control account. Bring its opening balance across on the customer or vendor list, so the subledger and the control account agree.',
        rec.code;
    end if;

    -- The number matched but the account did not. Posting here would put a
    -- balance from one kind of account onto another kind entirely.
    if rec.expected_type is not null
       and v_account.account_type <> rec.expected_type::acc_account_type then
      raise exception
        'Account % is %s here but the file calls it %s. Nothing was posted — reconcile the chart of accounts first.',
        rec.code, v_account.account_type, rec.expected_type;
    end if;

    if v_account.account_type in ('bank', 'current_asset', 'fixed_asset', 'cost_of_goods_sold',
                                  'expense', 'other_expense') then
      v_lines := v_lines || jsonb_build_object(
        'account_id', v_account.id,
        'debit_minor', greatest(rec.amount, 0), 'credit_minor', greatest(-rec.amount, 0),
        'amount_base_minor', abs(rec.amount), 'memo', 'Opening balance');
      v_net := v_net + rec.amount;
    else
      v_lines := v_lines || jsonb_build_object(
        'account_id', v_account.id,
        'debit_minor', greatest(-rec.amount, 0), 'credit_minor', greatest(rec.amount, 0),
        'amount_base_minor', abs(rec.amount), 'memo', 'Opening balance');
      v_net := v_net - rec.amount;
    end if;
  end loop;

  if jsonb_array_length(v_lines) = 0 then
    raise exception 'No opening balances to post';
  end if;

  if v_net <> 0 then
    v_lines := v_lines || jsonb_build_object(
      'account_id', v_obe,
      'debit_minor', greatest(-v_net, 0), 'credit_minor', greatest(v_net, 0),
      'amount_base_minor', abs(v_net), 'memo', 'Opening balance equity');
  end if;

  v_entry := acc_post_entry(
    p_as_of, 'Opening balances', 'manual', null,
    (select code from acc_currency where is_base limit 1), v_lines);
  return v_entry;
end;
$$;
