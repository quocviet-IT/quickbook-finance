-- 0159_credit_card_bank_accounts.sql
--
-- A credit card in Bank Transactions and Bank Reconciliation (2.45).
--
-- A bank account record is what statement imports, bank rules, bank feeds and
-- reconciliation hang off, and since 0072 it could belong only to a Bank-type
-- ledger account. A credit card is a Credit Card-type account — a liability —
-- whose statement is imported, coded and reconciled exactly as a bank's: every
-- line and balance is kept debit positive, so a charge is negative and the
-- balance owed is negative, which is how a card's CSV, OFX and bank feed sign
-- them already. Categorizing (0111), bank pairs (0127) and the reconciliation's
-- own arithmetic (0026, 0132, 0144) never look at the type and need nothing.
--
-- 1. acc_guard_bank_account_ledger takes a Credit Card-type account too. The
--    cash tin is still refused; a card has no detail to check.
-- 2. acc_coding_history counts a card that has a bank account record as the
--    statement side of an entry, so a card purchase — the card and an expense —
--    teaches the suggestions as a bank line does. A transfer from the bank to
--    the card then has two statement lines and teaches nothing, as a transfer
--    between two bank accounts never did. A card with no bank account record
--    is still an ordinary account, so nothing changes for a company that has
--    not set one up.
--
-- Nothing existing changes otherwise: no table, no data.
set search_path = public;

create or replace function acc_guard_bank_account_ledger() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_type   acc_account_type;
  v_detail text;
  v_name   text;
begin
  select account_type, detail_type, name
    into v_type, v_detail, v_name
    from acc_account where id = new.account_id;

  if not found then
    raise exception 'Ledger account not found';
  end if;
  if v_type not in ('bank', 'credit_card') then
    raise exception 'A bank account must be linked to a Bank-type or Credit Card ledger account (% is %)',
      v_name, v_type;
  end if;
  if v_type = 'bank' and v_detail = 'cash_on_hand' then
    raise exception
      'Cash on hand holds physical cash, not a bank balance — link this to a checking, savings or money market account (%)',
      v_name
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function acc_guard_bank_account_ledger() from public;

create or replace function acc_coding_history()
returns table (
  entry_id          uuid,
  entry_date        date,
  direction         text,
  account_id        uuid,
  entry_description text,
  other_memo        text,
  bank_description  text
)
language sql stable set search_path = public as $$
  with lines as (
    select l.id, l.journal_entry_id, l.account_id, l.memo,
           l.debit_minor - l.credit_minor as net,
           (a.account_type = 'bank'
             or (a.account_type = 'credit_card'
                 and exists (select 1 from acc_bank_account ba where ba.account_id = a.id))) as is_bank,
           coalesce(a.detail_type, '') in ('uncategorized_income', 'uncategorized_expense') as is_holding
      from acc_journal_line l
      join acc_journal_entry e on e.id = l.journal_entry_id and e.status = 'posted'
      join acc_account a on a.id = l.account_id
  ),
  shaped as (
    select journal_entry_id
      from lines
     group by journal_entry_id
    having count(*) filter (where is_bank) = 1
       and count(*) filter (where not is_bank) = 1
  )
  select e.id,
         e.entry_date,
         case when b.net >= 0 then 'in' else 'out' end,
         coalesce(rc.account_id, o.account_id),
         e.description,
         o.memo,
         (select t.description
            from acc_reconciliation r
            join acc_bank_transaction t on t.id = r.bank_transaction_id
           where r.journal_line_id = b.id and r.status = 'approved'
           limit 1)
    from shaped s
    join acc_journal_entry e on e.id = s.journal_entry_id
    join lines b on b.journal_entry_id = s.journal_entry_id and b.is_bank
    join lines o on o.journal_entry_id = s.journal_entry_id and not o.is_bank
    left join lateral (
      select rl.account_id
        from acc_journal_entry re
        join acc_journal_line rl on rl.journal_entry_id = re.id and rl.account_id <> o.account_id
       where re.source_type = 'bank' and re.source_id = e.id and re.status = 'posted'
       limit 1
    ) rc on o.is_holding
   where not o.is_holding or rc.account_id is not null
   order by e.id;
$$;
revoke all on function acc_coding_history() from public, anon;
grant execute on function acc_coding_history() to authenticated, service_role;

notify pgrst, 'reload schema';
