-- ============================================================================
-- 0077 — The journal entry beside each settlement.
--
-- The settlement history already answers "how did this balance get here":
-- which payments, credits and write-offs landed, and when. What it could not
-- answer is "and where is that on the ledger" — which is the next question an
-- auditor asks, and the one Issue #5 made answerable everywhere else.
-- ============================================================================

-- The shape changes, so the old definition has to go first; Postgres will not
-- replace a function whose return type differs.
drop function if exists acc_bill_settlements(uuid);
create or replace function acc_bill_settlements(p_bill_id uuid)
returns table (
  settled_on      date,
  settlement_type text,
  document_number text,
  method          text,
  reference       text,
  memo            text,
  amount_minor    bigint,
  entry_number    text
)
language sql stable security definer set search_path = public as $$
  select bp.payment_date, 'payment', bp.payment_number, bp.method, bp.reference, bp.memo,
         a.amount_minor, je.entry_number
    from acc_bill_payment_allocation a
    join acc_bill_payment bp on bp.id = a.bill_payment_id
    left join acc_journal_entry je on je.id = bp.journal_entry_id
   where a.bill_id = p_bill_id and bp.status <> 'void'
  union all
  select vc.credit_date, 'vendor_credit', vc.vendor_credit_number, null, null, vc.memo,
         va.amount_minor, je.entry_number
    from acc_vendor_credit_allocation va
    join acc_vendor_credit vc on vc.id = va.vendor_credit_id
    left join acc_journal_entry je on je.id = vc.journal_entry_id
   where va.bill_id = p_bill_id and vc.status <> 'void'
  union all
  select w.write_off_date, 'write_off', w.write_off_number, null, null, w.reason,
         w.amount_minor, je.entry_number
    from acc_write_off w
    left join acc_journal_entry je on je.id = w.journal_entry_id
   where w.bill_id = p_bill_id and w.status <> 'void'
  order by 1, 3;
$$;

revoke all on function acc_bill_settlements(uuid) from public;
grant execute on function acc_bill_settlements(uuid) to authenticated, service_role;

drop function if exists acc_invoice_settlements(uuid);
create or replace function acc_invoice_settlements(p_invoice_id uuid)
returns table (
  settled_on      date,
  settlement_type text,
  document_number text,
  method          text,
  reference       text,
  memo            text,
  amount_minor    bigint,
  entry_number    text
)
language sql stable security definer set search_path = public as $$
  select p.payment_date, 'payment', p.payment_number, p.method, p.reference, p.memo,
         a.amount_minor, je.entry_number
    from acc_payment_allocation a
    join acc_payment p on p.id = a.payment_id
    left join acc_journal_entry je on je.id = p.journal_entry_id
   where a.invoice_id = p_invoice_id and p.status <> 'void'
  union all
  select cm.memo_date, 'credit_memo', cm.credit_memo_number, null, null, cm.memo,
         ca.amount_minor, je.entry_number
    from acc_credit_memo_allocation ca
    join acc_credit_memo cm on cm.id = ca.credit_memo_id
    left join acc_journal_entry je on je.id = cm.journal_entry_id
   where ca.invoice_id = p_invoice_id and cm.status <> 'void'
  union all
  select w.write_off_date, 'write_off', w.write_off_number, null, null, w.reason,
         w.amount_minor, je.entry_number
    from acc_write_off w
    left join acc_journal_entry je on je.id = w.journal_entry_id
   where w.invoice_id = p_invoice_id and w.status <> 'void'
  order by 1, 3;
$$;

revoke all on function acc_invoice_settlements(uuid) from public;
grant execute on function acc_invoice_settlements(uuid) to authenticated, service_role;
