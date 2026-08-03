-- 0092 — Transaction List by Date.
--
-- The Journal Report already lists every entry, but a line at a time: to see
-- what a month actually did you read debits and credits and reassemble the
-- transaction in your head. This is the chronological one-row-per-transaction
-- view people audit and reconcile from, and it answers four questions the
-- journal cannot without work: who it was with, what it was for, which bank or
-- card it moved through, and whether it has been reconciled.
--
-- Read-only. It posts nothing and locks nothing.
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
  reconciled    boolean
)
language sql stable security definer set search_path = public as $$
  with entries as (
    select e.id, e.entry_number, e.entry_date, e.description, e.source_type, e.source_id, e.currency_code
      from acc_journal_entry e
     where e.status = 'posted'
       and e.entry_date between p_from and p_to
  ),
  -- Each line tagged with what kind of account it touched, which is what
  -- decides both the columns and the sign below.
  tagged as (
    select l.journal_entry_id,
           a.name as account_name,
           a.account_type,
           l.debit_minor - l.credit_minor as net_minor,
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
  labelled as (
    select journal_entry_id, bucket,
           count(distinct account_name) as accounts,
           min(account_name) as only_account,
           sum(net_minor) as net_minor
      from tagged
     group by journal_entry_id, bucket
  ),
  -- Amount reads as what the transaction did to the business, negative for
  -- money leaving. Cash first: a bank or card line is the plainest answer.
  -- Failing that a receivable or payable movement says what changed in what is
  -- owed. Failing both -- depreciation, an inventory write-down -- the category
  -- side is inverted, so a cost still reads negative.
  amounts as (
    select e.id,
           coalesce(
             (select net_minor from labelled where journal_entry_id = e.id and bucket = 'money'),
             (select net_minor from labelled where journal_entry_id = e.id and bucket = 'control'),
             -(select net_minor from labelled where journal_entry_id = e.id and bucket = 'category'),
             -- Nothing but assets and liabilities moved: a goods receipt, where
             -- inventory arrives against Goods Received Not Invoiced and the two
             -- cancel. The entry total says how much value landed.
             (select sum(l.debit_minor) from acc_journal_line l where l.journal_entry_id = e.id),
             0
           )::bigint as amount_minor
      from entries e
  )
  select
    e.id,
    e.entry_number,
    e.entry_date,
    coalesce(nullif(btrim(e.description), ''), initcap(replace(e.source_type::text, '_', ' '))),
    e.source_type::text,
    -- Documents are found from their own journal_entry_id rather than from
    -- acc_journal_entry.source_id, because source_id is only populated for some
    -- of them: invoices and bills set it, payments, bill payments and expenses
    -- never have. Goods receipts are the one party-bearing document with no
    -- journal_entry_id column, so they keep the source_id route.
    coalesce(
      (select c.name from acc_invoice d join acc_customer c on c.id = d.customer_id where d.journal_entry_id = e.id),
      (select c.name from acc_payment d join acc_customer c on c.id = d.customer_id where d.journal_entry_id = e.id),
      (select c.name from acc_credit_memo d join acc_customer c on c.id = d.customer_id where d.journal_entry_id = e.id),
      (select v.name from acc_bill d join acc_vendor v on v.id = d.vendor_id where d.journal_entry_id = e.id),
      (select v.name from acc_bill_payment d join acc_vendor v on v.id = d.vendor_id where d.journal_entry_id = e.id),
      (select v.name from acc_expense d join acc_vendor v on v.id = d.vendor_id where d.journal_entry_id = e.id),
      (select v.name from acc_vendor_credit d join acc_vendor v on v.id = d.vendor_id where d.journal_entry_id = e.id),
      (select v.name from acc_goods_receipt d join acc_vendor v on v.id = d.vendor_id where d.id = e.source_id)
    ),
    coalesce(
      (select case when accounts = 1 then only_account else '— Split —' end
         from labelled where journal_entry_id = e.id and bucket = 'category'),
      (select case when accounts = 1 then only_account else '— Split —' end
         from labelled where journal_entry_id = e.id and bucket = 'other')
    ),
    (select case when accounts = 1 then only_account else '— Split —' end
       from labelled where journal_entry_id = e.id and bucket = 'money'),
    a.amount_minor,
    e.currency_code,
    exists (
      select 1
        from acc_reconciliation r
        join acc_journal_line l on l.id = r.journal_line_id
       where l.journal_entry_id = e.id
         and r.status = 'approved'
    )
  from entries e
  join amounts a on a.id = e.id
  order by e.entry_date, e.entry_number;
$$;

revoke all on function acc_transaction_list(date, date) from public, anon;
grant execute on function acc_transaction_list(date, date) to authenticated;
