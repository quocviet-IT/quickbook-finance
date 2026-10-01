-- ============================================================================
-- 0128  The transaction list, in one pass
--
-- 0105's acc_transaction_list answered each entry with correlated subqueries
-- against `labelled`, a CTE it reads several times and so materialises without
-- an index. Every entry scanned every other entry's rows, so the time grew with
-- the square of the window: one year of a 5,068-entry book took 1.9 s, two
-- years 7.1 s, and the whole book passed the 8 s statement timeout. That broke
-- Reports › Transactions over a long window and the Beancount export, which
-- reads the whole book through this function.
--
-- Each per-entry figure is now aggregated once, by entry, and joined. Same
-- parameters, same columns, same rows, same order — scripts/verify-transaction-
-- list.mjs compares this function with 0105's on every company's books.
-- ============================================================================

set search_path = public;

create or replace function acc_transaction_list(
  p_from date,
  p_to   date
) returns table (
  entry_id      uuid,
  entry_number  text,
  entry_date    date,
  description   text,
  source_type   text,
  party_name    text,
  category_label text,
  money_label   text,
  amount_minor  bigint,
  currency_code text,
  reconciled    boolean,
  account_ids   uuid[]
)
language sql stable security definer set search_path = public as $$
  with entries as (
    select e.id, e.entry_number, e.entry_date, e.description, e.source_type, e.source_id, e.currency_code
      from acc_journal_entry e
     where e.status = 'posted'
       and e.entry_date between p_from and p_to
  ),
  lines as (
    select l.journal_entry_id, l.account_id, l.debit_minor, l.credit_minor, a.name as account_name,
           case
             when a.account_type in ('bank', 'credit_card') then 'money'
             when a.account_type in ('accounts_receivable', 'accounts_payable') then 'control'
             when a.account_type in ('income', 'other_income', 'expense', 'other_expense',
                                     'cost_of_goods_sold') then 'category'
             else 'other'
           end as bucket
      from acc_journal_line l
      join acc_account a on a.id = l.account_id
     where l.journal_entry_id in (select id from entries)
  ),
  -- One row per entry and kind of account: how many accounts of that kind it
  -- touched, the one account when there is one, and their net.
  labelled as (
    select journal_entry_id, bucket,
           case when count(distinct account_name) = 1 then min(account_name) else '— Split —' end as label,
           sum(debit_minor - credit_minor) as net_minor
      from lines
     group by journal_entry_id, bucket
  ),
  -- The same facts pivoted to one row per entry. A kind the entry did not touch
  -- is null, exactly as 0105's subquery returned no row for it.
  per_entry as (
    select journal_entry_id,
           max(net_minor) filter (where bucket = 'money')    as money_net,
           max(net_minor) filter (where bucket = 'control')  as control_net,
           max(net_minor) filter (where bucket = 'category') as category_net,
           max(label)     filter (where bucket = 'money')    as money_label,
           max(label)     filter (where bucket = 'category') as category_label,
           max(label)     filter (where bucket = 'other')    as other_label
      from labelled
     group by journal_entry_id
  ),
  totals as (
    select journal_entry_id,
           sum(debit_minor) as debit_total,
           array_agg(distinct account_id) as account_ids
      from lines
     group by journal_entry_id
  ),
  reconciled as (
    select distinct l.journal_entry_id
      from acc_reconciliation r
      join acc_journal_line l on l.id = r.journal_line_id
     where r.status = 'approved'
       and l.journal_entry_id in (select id from entries)
  ),
  -- Documents are found from their own journal_entry_id rather than from
  -- acc_journal_entry.source_id, because source_id is only populated for some
  -- of them. Goods receipts are the one party-bearing document with no
  -- journal_entry_id column, so they keep the source_id route. The rank is
  -- 0105's coalesce order.
  parties as (
    select distinct on (journal_entry_id) journal_entry_id, name
      from (
        select d.journal_entry_id, c.name, 1 as rank from acc_invoice d join acc_customer c on c.id = d.customer_id
         where d.journal_entry_id in (select id from entries)
        union all
        select d.journal_entry_id, c.name, 2 from acc_payment d join acc_customer c on c.id = d.customer_id
         where d.journal_entry_id in (select id from entries)
        union all
        select d.journal_entry_id, c.name, 3 from acc_credit_memo d join acc_customer c on c.id = d.customer_id
         where d.journal_entry_id in (select id from entries)
        union all
        select d.journal_entry_id, v.name, 4 from acc_bill d join acc_vendor v on v.id = d.vendor_id
         where d.journal_entry_id in (select id from entries)
        union all
        select d.journal_entry_id, v.name, 5 from acc_bill_payment d join acc_vendor v on v.id = d.vendor_id
         where d.journal_entry_id in (select id from entries)
        union all
        select d.journal_entry_id, v.name, 6 from acc_expense d join acc_vendor v on v.id = d.vendor_id
         where d.journal_entry_id in (select id from entries)
        union all
        select d.journal_entry_id, v.name, 7 from acc_vendor_credit d join acc_vendor v on v.id = d.vendor_id
         where d.journal_entry_id in (select id from entries)
        union all
        select e.id, v.name, 8 from entries e
          join acc_goods_receipt d on d.id = e.source_id
          join acc_vendor v on v.id = d.vendor_id
      ) found
     where name is not null
     order by journal_entry_id, rank
  )
  select
    e.id,
    e.entry_number,
    e.entry_date,
    coalesce(nullif(btrim(e.description), ''), initcap(replace(e.source_type::text, '_', ' '))),
    e.source_type::text,
    p.name,
    coalesce(pe.category_label, pe.other_label),
    pe.money_label,
    -- Amount reads as what the transaction did to the business, negative for
    -- money leaving: cash first, then what is owed, then the category side
    -- inverted, then — nothing but assets and liabilities moved — the entry
    -- total.
    coalesce(pe.money_net, pe.control_net, -pe.category_net, t.debit_total, 0)::bigint,
    e.currency_code,
    r.journal_entry_id is not null,
    coalesce(t.account_ids, array[]::uuid[])
  from entries e
  left join per_entry pe on pe.journal_entry_id = e.id
  left join totals t on t.journal_entry_id = e.id
  left join reconciled r on r.journal_entry_id = e.id
  left join parties p on p.journal_entry_id = e.id
  order by e.entry_date, e.entry_number;
$$;

revoke all on function acc_transaction_list(date, date) from public, anon;
grant execute on function acc_transaction_list(date, date) to authenticated;
