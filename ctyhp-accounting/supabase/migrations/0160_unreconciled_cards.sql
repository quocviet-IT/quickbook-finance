-- ============================================================================
-- 0160  Credit cards' unreconciled activity (2.47)
--
--   acc_unreconciled_cards(p_as_of)   one row: how many credit cards are kept
--                                     under Banking (a Credit Card ledger
--                                     account with a bank account record,
--                                     2.45), and the posted lines on them
--                                     dated on or before p_as_of that no
--                                     completed reconciliation has ticked —
--                                     how many, and what they come to, debit
--                                     positive as the books keep them (a
--                                     charge negative). Read only.
--
--   acc_bank_close_standing(p_as_of)  one row per bank account record (bank
--                                     or credit card): the statement ending
--                                     date of its latest completed
--                                     reconciliation, whenever it ends, and
--                                     how many of its bank lines dated on or
--                                     before p_as_of are still unmatched. The
--                                     month-end checklist reads it so a card
--                                     neither passes the bank's step nor goes
--                                     unchecked. Read only.
--
-- acc_unreconciled_bank (0144) counts Bank-type accounts only, so a card's
-- unreconciled charges never reached the dashboard. A card that is not under
-- Banking has no statement to reconcile and is left out, as the cash tin is
-- left out of the bank's figure. New functions: nothing that exists changes.
-- Both are invoker functions, so the tables' own row security decides who
-- reads them, as with acc_unreconciled_bank.
-- ============================================================================
set search_path = public;

create or replace function acc_unreconciled_cards(p_as_of date)
returns table (card_count bigint, item_count bigint, amount_minor bigint)
language sql stable as $$
  with cards as (
    select a.id
      from acc_account a
     where a.account_type = 'credit_card'
       and exists (select 1 from acc_bank_account b where b.account_id = a.id)
  ),
  open_lines as (
    select case when l.debit_minor > 0 then l.amount_base_minor else -l.amount_base_minor end as signed_minor
      from acc_journal_line l
      join cards c             on c.id = l.account_id
      join acc_journal_entry e on e.id = l.journal_entry_id
     where e.status = 'posted'
       and e.entry_date <= p_as_of
       and not exists (
         select 1 from acc_reconciliation_line rl
         join acc_statement_reconciliation r on r.id = rl.reconciliation_id
         where rl.journal_line_id = l.id and r.status = 'completed'
       )
  )
  select (select count(*) from cards)::bigint,
         (select count(*) from open_lines)::bigint,
         (select coalesce(sum(signed_minor), 0) from open_lines)::bigint;
$$;
revoke all on function acc_unreconciled_cards(date) from public, anon;
grant execute on function acc_unreconciled_cards(date) to authenticated, service_role;

-- The latest completed reconciliation is taken whenever its statement ends: a
-- statement ending after the period end still covers the period end. Unmatched
-- lines are counted as the Bank Transactions screen counts them: not pending,
-- not removed by the feed, dated on or before p_as_of.
create or replace function acc_bank_close_standing(p_as_of date)
returns table (
  bank_account_id   uuid,
  account_code      text,
  account_name      text,
  is_card           boolean,
  last_completed_on date,
  unmatched_count   bigint
)
language sql stable as $$
  select b.id,
         a.account_code,
         a.name,
         a.account_type = 'credit_card',
         (select max(r.statement_ending_date)
            from acc_statement_reconciliation r
           where r.bank_account_id = b.id and r.status = 'completed'),
         (select count(*)
            from acc_bank_transaction t
           where t.bank_account_id = b.id
             and t.status = 'unmatched'
             and t.pending = false
             and t.provider_removed_at is null
             and t.txn_date <= p_as_of)::bigint
    from acc_bank_account b
    join acc_account a on a.id = b.account_id
   order by a.account_code;
$$;
revoke all on function acc_bank_close_standing(date) from public, anon;
grant execute on function acc_bank_close_standing(date) to authenticated, service_role;
