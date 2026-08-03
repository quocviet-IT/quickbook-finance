-- 0091 — Fix: acc_settle_from_bank_transaction could not resolve its party.
--
-- 0090 picked the single customer or vendor behind the allocated documents with
-- min(uuid). Postgres has no min() for uuid, so every call failed at the first
-- statement that mattered -- after the permission gate and the over-allocation
-- guard, which is why the structural check of the deployed function passed
-- while the function itself could not settle anything.
--
-- array_agg(distinct ...) does the same job for a type with no ordering
-- operator, and the count(distinct ...) beside it still enforces "exactly one".
--
-- The whole function is restated rather than patched, because 0090 is applied
-- everywhere and migrations are tracked by filename: editing it in place would
-- leave every schema that already ran it on the broken version.

create or replace function acc_settle_from_bank_transaction(
  p_bank_transaction_id uuid,
  p_allocations         jsonb,   -- [{ "document_id": uuid, "amount_minor": bigint }]
  p_method              text default null,
  p_memo                text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_txn        acc_bank_transaction;
  v_bank       acc_bank_account;
  v_size       bigint;
  v_alloc_sum  bigint;
  v_alloc_n    int;
  v_party      uuid;
  v_parties    int;
  v_settlement uuid;
  v_payload    jsonb;
begin
  if not acc_has_permission('banking.match') then
    raise exception 'You do not have permission to match bank transactions';
  end if;

  select * into v_txn from acc_bank_transaction where id = p_bank_transaction_id for update;
  if not found then raise exception 'Bank transaction was not found'; end if;

  -- The lock plus this check are what stop one bank line paying twice.
  if v_txn.status <> 'unmatched' then
    raise exception 'This bank transaction is already %, so it cannot settle anything', v_txn.status;
  end if;
  if v_txn.amount_minor = 0 then
    raise exception 'A bank transaction of zero settles nothing';
  end if;

  select * into v_bank from acc_bank_account where id = v_txn.bank_account_id;
  if not found then raise exception 'The bank account behind this transaction was not found'; end if;

  v_size := abs(v_txn.amount_minor);

  select count(*), coalesce(sum((a->>'amount_minor')::bigint), 0)
    into v_alloc_n, v_alloc_sum
    from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) a;

  if v_alloc_n = 0 then raise exception 'Allocate this transaction to at least one document'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_allocations) a
     where (a->>'amount_minor')::bigint <= 0
  ) then
    raise exception 'Every allocation must be a positive amount';
  end if;

  -- The bank is the authority on how much money moved. Less than the whole line
  -- may be allocated -- the remainder stays unapplied, which both settlement
  -- RPCs already model -- but never more.
  if v_alloc_sum > v_size then
    raise exception 'Allocations (%) exceed the bank transaction (%)', v_alloc_sum, v_size;
  end if;

  if v_txn.amount_minor > 0 then
    -- Money in: a customer receipt against open invoices.
    select count(distinct i.customer_id), (array_agg(distinct i.customer_id))[1]
      into v_parties, v_party
      from jsonb_array_elements(p_allocations) a
      join acc_invoice i on i.id = (a->>'document_id')::uuid;

    if v_parties = 0 then raise exception 'No invoice was found for this allocation'; end if;
    if v_parties > 1 then
      raise exception 'One bank transaction cannot settle invoices for more than one customer';
    end if;

    select jsonb_agg(jsonb_build_object(
             'invoice_id', (a->>'document_id')::uuid,
             'amount_minor', (a->>'amount_minor')::bigint))
      into v_payload
      from jsonb_array_elements(p_allocations) a;

    v_settlement := acc_record_payment(
      v_party, v_txn.txn_date, v_bank.currency_code, v_size,
      v_bank.account_id, p_method, p_memo, v_payload, v_txn.reference);

    insert into acc_reconciliation
      (bank_transaction_id, payment_id, rule_applied, confidence, status, approved_by)
    values
      (v_txn.id, v_settlement, 'manual_settlement', 1.000, 'approved', auth.uid());
  else
    -- Money out: a bill payment against open bills.
    select count(distinct b.vendor_id), (array_agg(distinct b.vendor_id))[1]
      into v_parties, v_party
      from jsonb_array_elements(p_allocations) a
      join acc_bill b on b.id = (a->>'document_id')::uuid;

    if v_parties = 0 then raise exception 'No bill was found for this allocation'; end if;
    if v_parties > 1 then
      raise exception 'One bank transaction cannot settle bills for more than one vendor';
    end if;

    -- Discounts are not offered here. An early payment discount changes how much
    -- cash leaves, and the cash has already left -- the bank says so.
    select jsonb_agg(jsonb_build_object(
             'bill_id', (a->>'document_id')::uuid,
             'amount_minor', (a->>'amount_minor')::bigint,
             'discount_minor', 0))
      into v_payload
      from jsonb_array_elements(p_allocations) a;

    v_settlement := acc_pay_bills(
      v_party, v_txn.txn_date, v_bank.currency_code, v_size,
      v_bank.account_id, p_method, p_memo, v_payload, v_txn.reference);

    insert into acc_reconciliation
      (bank_transaction_id, bill_payment_id, rule_applied, confidence, status, approved_by)
    values
      (v_txn.id, v_settlement, 'manual_settlement', 1.000, 'approved', auth.uid());
  end if;

  -- The question has been answered, so any guess still standing is withdrawn.
  update acc_reconciliation
     set status = 'rejected', updated_at = now()
   where bank_transaction_id = v_txn.id
     and status = 'suggested';

  update acc_bank_transaction
     set status = 'matched', updated_at = now()
   where id = v_txn.id;

  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
  values ('acc_bank_transaction', v_txn.id, 'update', auth.uid(),
          jsonb_build_object('status', 'matched',
                             'settled_via', case when v_txn.amount_minor > 0 then 'payment' else 'bill_payment' end,
                             'settlement_id', v_settlement,
                             'allocations', p_allocations));

  return v_settlement;
end;
$$;

revoke all on function acc_settle_from_bank_transaction(uuid, jsonb, text, text) from public, anon;
grant execute on function acc_settle_from_bank_transaction(uuid, jsonb, text, text) to authenticated;
