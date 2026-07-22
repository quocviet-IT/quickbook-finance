-- ============================================================================
-- Fix void double-reversal in acc_void_invoice (Module 2).
--
-- Reports and balances count only journal entries with status='posted'
-- (see 0009_reporting.sql). The original void implementation BOTH marked the
-- source entry 'void' (removing it from posted totals) AND posted a reversal
-- entry — double-counting the reversal and leaving negative account balances.
--
-- Correct behaviour: voiding the entry (status='void') is itself the reversal,
-- because reports exclude void entries. Do NOT also post a reversal.
--
-- The payables void functions (acc_void_bill, acc_void_expense,
-- acc_void_bill_payment) are defined correctly in 0012; this migration brings
-- the pre-existing invoicing void in line with the same rule.
-- ============================================================================

create or replace function acc_void_invoice(p_invoice_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_inv acc_invoice;
begin
  if not acc_is_staff() then raise exception 'Not authorized to void invoices'; end if;

  select * into v_inv from acc_invoice where id = p_invoice_id for update;
  if not found then raise exception 'Invoice not found'; end if;
  if v_inv.status = 'void' then raise exception 'Invoice is already void'; end if;
  if v_inv.status = 'draft' then
    update acc_invoice set status = 'void', updated_at = now() where id = p_invoice_id;
    return;
  end if;
  if v_inv.balance_due_minor <> v_inv.total_minor then
    raise exception 'Cannot void an invoice with payments applied; remove payments first';
  end if;

  -- Voiding the entry reverses its ledger effect (reports use status='posted' only);
  -- do NOT also post a reversal.
  if v_inv.journal_entry_id is not null then
    update acc_journal_entry set status = 'void', voided_at = now()
     where id = v_inv.journal_entry_id;
  end if;

  update acc_invoice set status = 'void', balance_due_minor = 0, updated_at = now()
   where id = p_invoice_id;
end;
$$;
