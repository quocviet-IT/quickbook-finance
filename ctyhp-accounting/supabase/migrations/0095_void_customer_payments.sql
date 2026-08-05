-- ============================================================================
-- 0095  Void a customer payment
--
-- A receipt entered against the wrong customer, or entered twice, cannot simply
-- be deleted: it holds a number, a journal entry and an audit trail, and the
-- invoices it settled have been reading as paid ever since. Voiding is the only
-- honest correction, and it has to do three things at once — put the balances
-- back, take the ledger effect away, and say who did it and why.
--
-- All of it lives in one function so it is one transaction. A void that
-- restored invoices and then failed on the journal entry would leave the books
-- claiming money that was never received.
-- ============================================================================

set search_path = public;

-- --- Attribution ------------------------------------------------------------
-- Who voided this, when, and why. The reason is not decoration: the payment
-- number survives, so this is the only record of what the void was for.

alter table acc_payment
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references auth.users (id),
  add column if not exists void_reason text;

-- Nothing has ever voided a payment before this migration, but a company
-- restored from an older export could carry one. Give it the best attribution
-- available rather than failing the constraint below.
update acc_payment
   set voided_at = coalesce(voided_at, updated_at, created_at),
       voided_by = coalesce(voided_by, updated_by, created_by),
       void_reason = coalesce(nullif(btrim(void_reason), ''), 'Voided before attribution was introduced')
 where status = 'void';

alter table acc_payment drop constraint if exists acc_payment_void_metadata_ck;
alter table acc_payment add constraint acc_payment_void_metadata_ck check (
  (status = 'void' and voided_at is not null
    and void_reason is not null and length(btrim(void_reason)) between 1 and 500)
  or
  (status <> 'void' and voided_at is null and voided_by is null and void_reason is null)
);

-- --- The void itself --------------------------------------------------------
create or replace function acc_void_payment(
  p_payment_id uuid,
  p_reason text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_payment    acc_payment;
  v_invoice    acc_invoice;
  v_allocation record;
  v_reason     text := btrim(coalesce(p_reason, ''));
  v_restored   bigint;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to void customer payments';
  end if;
  if length(v_reason) = 0 then
    raise exception 'A void reason is required';
  end if;
  if length(v_reason) > 500 then
    raise exception 'A void reason cannot exceed 500 characters';
  end if;

  -- Locked for the whole function: two people voiding the same receipt would
  -- otherwise restore the same invoice balance twice.
  select * into v_payment
    from acc_payment where id = p_payment_id for update;
  if not found then raise exception 'Payment not found'; end if;
  if v_payment.status = 'void' then raise exception 'Payment is already void'; end if;

  -- Money already refunded out of this receipt cannot be un-received.
  if exists (
    select 1 from acc_customer_refund
     where payment_id = p_payment_id and status <> 'void'
  ) then
    raise exception 'Void the customer refund before voiding this payment';
  end if;

  -- A bank line still pointing at this payment would keep it "matched" to cash
  -- that the void says never arrived. Since migration 0045 a match may name the
  -- payment directly OR one of its journal lines, so both have to be checked —
  -- looking only at payment_id would let a line-level match survive the void.
  if exists (
    select 1
      from acc_reconciliation r
      left join acc_journal_line jl on jl.id = r.journal_line_id
     where r.status in ('suggested', 'approved')
       and (
         r.payment_id = p_payment_id
         or (v_payment.journal_entry_id is not null
             and jl.journal_entry_id = v_payment.journal_entry_id)
       )
  ) then
    raise exception 'Reject or undo the bank match before voiding this payment';
  end if;

  -- Cleared on a statement means a human has tied it to the bank. Removing the
  -- entry underneath that tie would silently unbalance the reconciliation.
  if exists (
    select 1
      from acc_reconciliation_line line
      join acc_journal_line journal_line on journal_line.id = line.journal_line_id
     where journal_line.journal_entry_id = v_payment.journal_entry_id
  ) then
    raise exception 'Remove this payment from statement reconciliation before voiding it';
  end if;

  -- Give each invoice back exactly what this payment took from it. Capped at
  -- the invoice total because a credit memo or write-off may have moved the
  -- balance since, and an invoice can never owe more than it was raised for.
  for v_allocation in
    select invoice_id, amount_minor
      from acc_payment_allocation
     where payment_id = p_payment_id
     order by id
  loop
    select * into v_invoice
      from acc_invoice where id = v_allocation.invoice_id for update;
    if v_invoice.status <> 'void' then
      v_restored := least(
        v_invoice.total_minor,
        v_invoice.balance_due_minor + v_allocation.amount_minor
      );
      update acc_invoice
         set balance_due_minor = v_restored,
             status = (case
               when v_restored = 0 then 'paid'
               when v_restored >= total_minor then 'issued'
               else 'partial'
             end)::acc_invoice_status
       where id = v_invoice.id;
    end if;
  end loop;

  -- Voiding the entry removes its ledger effect (reports read status='posted'
  -- only); do NOT also post a reversal. If the entry sits in a closed period,
  -- acc_journal_entry_closed_period_void refuses here and PostgreSQL rolls back
  -- the invoice restorations above with it.
  if v_payment.journal_entry_id is not null then
    update acc_journal_entry
       set status = 'void', voided_at = now()
     where id = v_payment.journal_entry_id;
  end if;

  -- The row stays, the number stays, the allocations stay. Only the status and
  -- the attribution change; acc_stamp_actor owns updated_at/updated_by.
  update acc_payment
     set status = 'void',
         unapplied_minor = 0,
         voided_at = now(),
         voided_by = auth.uid(),
         void_reason = v_reason
   where id = p_payment_id;
end;
$$;

revoke all on function acc_void_payment(uuid, text) from public;
grant execute on function acc_void_payment(uuid, text) to authenticated, service_role;
