-- ============================================================================
-- 0130 — A loan instalment, posted as principal and interest.
--
-- A loan payment repays principal and pays interest; only the interest is an
-- expense. Given a waiting bank line, a loan from Cards and loans (0129) and
-- the interest a person accepted, this posts one entry: the loan account for
-- the principal, the interest account for the interest, the bank for the
-- payment. The two accounts come from the register, never from the caller;
-- the principal is worked out here. The entry is source 'bank' with no source
-- id, so Change takes it back through acc_uncategorise_bank_transaction.
--
-- Nothing existing changes.
-- ============================================================================

set search_path = public;

create or replace function acc_post_bank_loan_payment(
  p_transaction_id uuid,
  p_repayment_id uuid,
  p_interest_minor bigint
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_txn       acc_bank_transaction;
  v_bank      uuid;
  v_reg       acc_repayment_account;
  v_loan      acc_account;
  v_interest  acc_account;
  v_currency  text;
  v_abs       bigint;
  v_principal bigint;
  v_lines     jsonb := '[]'::jsonb;
  v_entry     uuid;
  v_line      uuid;
  v_number    text;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to post a loan payment';
  end if;

  select * into v_txn from acc_bank_transaction where id = p_transaction_id for update;
  if v_txn.id is null then
    raise exception 'Bank transaction not found';
  end if;
  if v_txn.status <> 'unmatched' or v_txn.pending then
    raise exception 'This line must still be waiting to be posted';
  end if;
  if exists (select 1 from acc_reconciliation where bank_transaction_id = p_transaction_id) then
    raise exception 'This line is already matched to the ledger';
  end if;
  if coalesce(v_txn.amount_minor, 0) >= 0 then
    raise exception 'A loan payment is money out of the bank';
  end if;

  select code into v_currency from acc_currency where is_base limit 1;
  if v_currency is null then raise exception 'No base currency is configured'; end if;
  select ba.account_id into v_bank
    from acc_bank_account ba
   where ba.id = v_txn.bank_account_id and ba.currency_code = v_currency;
  if v_bank is null then
    raise exception 'Loan payments are posted only from a bank account in %', v_currency;
  end if;

  select * into v_reg from acc_repayment_account where id = p_repayment_id;
  if v_reg.id is null or v_reg.kind <> 'loan' or not v_reg.is_active then
    raise exception 'Choose a loan that is switched on in Cards and loans';
  end if;
  select * into v_loan from acc_account where id = v_reg.account_id;
  if v_loan.id is null or v_loan.status <> 'active' or not v_loan.is_posting_account
     or v_loan.account_type::text not in ('current_liability', 'long_term_liability') then
    raise exception 'The loan account must be an active posting liability account';
  end if;
  select * into v_interest from acc_account where id = v_reg.interest_account_id;
  if v_interest.id is null or v_interest.status <> 'active' or not v_interest.is_posting_account
     or v_interest.account_type::text not in ('expense', 'other_expense') then
    raise exception 'The interest account must be an active posting expense account';
  end if;

  v_abs := abs(v_txn.amount_minor);
  if p_interest_minor is null or p_interest_minor < 0 or p_interest_minor > v_abs then
    raise exception 'Interest must be between 0 and the payment';
  end if;
  v_principal := v_abs - p_interest_minor;

  if v_principal > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', v_loan.id, 'debit_minor', v_principal, 'credit_minor', 0,
      'amount_base_minor', acc_to_base_minor(v_principal, v_currency, v_txn.txn_date), 'memo', 'Principal'));
  end if;
  if p_interest_minor > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', v_interest.id, 'debit_minor', p_interest_minor, 'credit_minor', 0,
      'amount_base_minor', acc_to_base_minor(p_interest_minor, v_currency, v_txn.txn_date), 'memo', 'Interest'));
  end if;
  v_lines := v_lines || jsonb_build_array(jsonb_build_object(
    'account_id', v_bank, 'debit_minor', 0, 'credit_minor', v_abs,
    'amount_base_minor', acc_to_base_minor(v_abs, v_currency, v_txn.txn_date), 'memo', v_txn.description));

  v_entry := acc_post_entry(
    v_txn.txn_date,
    coalesce(nullif(btrim(v_txn.description), ''), 'Bank line') || ' — loan payment',
    'bank', null, v_currency, v_lines);

  select id into v_line from acc_journal_line where journal_entry_id = v_entry and account_id = v_bank limit 1;
  insert into acc_reconciliation (bank_transaction_id, journal_line_id, status, confidence)
  values (p_transaction_id, v_line, 'approved', 1.000);
  update acc_bank_transaction set status = 'matched' where id = p_transaction_id;

  select entry_number into v_number from acc_journal_entry where id = v_entry;
  return jsonb_build_object('entry_id', v_entry, 'entry_number', v_number,
                            'principal_minor', v_principal, 'interest_minor', p_interest_minor);
end;
$$;

revoke all on function acc_post_bank_loan_payment(uuid, uuid, bigint) from public, anon;
grant execute on function acc_post_bank_loan_payment(uuid, uuid, bigint) to authenticated, service_role;
