-- 0093 — Allowance for Doubtful Accounts.
--
-- The aging report has always existed and reconciles to the Accounts
-- Receivable control account. What was missing is the other half: the estimate
-- of how much of that receivable will never arrive. Migration 0069 said so in
-- as many words — "a credit limit is the control, the allowance is the
-- estimate — this is the control" — and left the estimate unbuilt.
--
-- Until now the only route was the direct write-off, which removes a specific
-- invoice once it is known to be uncollectible. That is not the same thing and
-- is not what US GAAP asks for on material balances: the allowance method
-- recognises expected loss while the receivable is still open, so the balance
-- sheet carries receivables at what they are actually worth.
--
-- The allowance is a contra-asset. It is deliberately typed `current_asset`
-- and NOT `accounts_receivable`, because acc_active_ar_account() takes the
-- first receivable-typed account by code and acc_control_reconciliation ties
-- the subledger to it. A second receivable-typed account would quietly corrupt
-- both.

insert into acc_account (account_code, name, account_type, currency_code, is_posting_account, status)
select '1190', 'Allowance for Doubtful Accounts', 'current_asset',
       (select code from acc_currency where is_base limit 1), true, 'active'
 where not exists (select 1 from acc_account where account_code = '1190');

insert into acc_account (account_code, name, account_type, currency_code, is_posting_account, status)
select '6900', 'Bad Debt Expense', 'expense',
       (select code from acc_currency where is_base limit 1), true, 'active'
 where not exists (select 1 from acc_account where account_code = '6900');

-- ----------------------------------------------------------------------------
-- The reserve rate for each aging bucket, in basis points.
--
-- Seeded with the rates the request named — 5%, 10%, 25%, 50% — placed on the
-- four delinquent buckets. Not-yet-due starts at zero because this aging is
-- measured from the DUE date: an invoice inside its terms is not late, and
-- reserving against it on a delinquency scale would be reserving twice. A
-- company applying CECL to the whole portfolio should raise it, which is why
-- this is a table and not a constant.
-- ----------------------------------------------------------------------------
create table if not exists acc_afda_rate (
  bucket_key text primary key,
  rate_bps   int not null check (rate_bps between 0 and 10000),
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now()
);

insert into acc_afda_rate (bucket_key, rate_bps) values
  ('current',   0),
  ('d1_30',   500),
  ('d31_60', 1000),
  ('d61_90', 2500),
  ('d90_plus', 5000)
on conflict (bucket_key) do nothing;

alter table acc_afda_rate enable row level security;
create policy acc_afda_rate_read  on acc_afda_rate for select using (acc_current_role() is not null);
create policy acc_afda_rate_write on acc_afda_rate for all using (acc_is_admin()) with check (acc_is_admin());

-- ----------------------------------------------------------------------------
-- What the allowance should be, bucket by bucket, on a given date.
--
-- Buckets are cut the same way the aging report cuts them, from the due date,
-- so the two can never disagree. Rounding is half-away-from-zero per bucket;
-- the total is the sum of the rounded parts rather than a rounded sum, so the
-- number on screen is the number that posts.
-- ----------------------------------------------------------------------------
create or replace function acc_afda_evaluation(p_as_of date)
returns table (
  bucket_key     text,
  balance_minor  bigint,
  rate_bps       int,
  required_minor bigint
)
language sql stable security definer set search_path = public as $$
  with open_invoices as (
    select i.balance_due_minor,
           case
             when p_as_of <= coalesce(i.due_date, i.issue_date) then 'current'
             when p_as_of - coalesce(i.due_date, i.issue_date) <= 30 then 'd1_30'
             when p_as_of - coalesce(i.due_date, i.issue_date) <= 60 then 'd31_60'
             when p_as_of - coalesce(i.due_date, i.issue_date) <= 90 then 'd61_90'
             else 'd90_plus'
           end as bucket_key
      from acc_invoice i
     where i.status in ('issued', 'partial')
       and i.balance_due_minor > 0
       and i.issue_date <= p_as_of
  ),
  totals as (
    select bucket_key, sum(balance_due_minor)::bigint as balance_minor
      from open_invoices group by bucket_key
  )
  select r.bucket_key,
         coalesce(t.balance_minor, 0)::bigint,
         r.rate_bps,
         round(coalesce(t.balance_minor, 0)::numeric * r.rate_bps / 10000)::bigint
    from acc_afda_rate r
    left join totals t on t.bucket_key = r.bucket_key
   order by array_position(array['current','d1_30','d31_60','d61_90','d90_plus'], r.bucket_key);
$$;

/** The allowance already carried, as a positive reserve. */
create or replace function acc_afda_balance(p_as_of date) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(l.credit_minor - l.debit_minor), 0)::bigint
    from acc_journal_line l
    join acc_journal_entry e on e.id = l.journal_entry_id
    join acc_account a on a.id = l.account_id
   where a.account_code = '1190'
     and e.status = 'posted'
     and e.entry_date <= p_as_of;
$$;

-- ----------------------------------------------------------------------------
-- Move the allowance to what the aging says it should be.
--
-- Only the difference posts, so running this monthly tops the reserve up or
-- releases it rather than stacking a fresh estimate on the old one. It refuses
-- when there is nothing to move, for the same reason posting depreciation
-- twice is refused: a second click must not look like it worked.
-- ----------------------------------------------------------------------------
create or replace function acc_post_afda_adjustment(
  p_as_of date,
  p_memo  text default null
) returns table (journal_entry_id uuid, required_minor bigint, previous_minor bigint, adjustment_minor bigint)
language plpgsql security definer set search_path = public as $$
declare
  v_required bigint;
  v_previous bigint;
  v_delta    bigint;
  v_allowance uuid;
  v_expense  uuid;
  v_currency text;
  v_entry    uuid;
  v_lines    jsonb;
begin
  if not acc_has_permission('journal.post') then
    raise exception 'You do not have permission to post the allowance adjustment';
  end if;

  select coalesce(sum(e.required_minor), 0) into v_required from acc_afda_evaluation(p_as_of) e;
  v_previous := acc_afda_balance(p_as_of);
  v_delta := v_required - v_previous;

  if v_delta = 0 then
    raise exception 'The allowance already stands at % on %; there is nothing to adjust', v_required, p_as_of;
  end if;

  select id into v_allowance from acc_account where account_code = '1190' and status = 'active';
  select id into v_expense   from acc_account where account_code = '6900' and status = 'active';
  if v_allowance is null or v_expense is null then
    raise exception 'The allowance (1190) or bad debt expense (6900) account is missing or inactive';
  end if;
  select code into v_currency from acc_currency where is_base limit 1;

  if v_delta > 0 then
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', v_expense,   'debit_minor', v_delta, 'credit_minor', 0,
                         'amount_base_minor', v_delta, 'memo', 'Allowance for doubtful accounts'),
      jsonb_build_object('account_id', v_allowance, 'debit_minor', 0, 'credit_minor', v_delta,
                         'amount_base_minor', v_delta, 'memo', 'Allowance for doubtful accounts'));
  else
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', v_allowance, 'debit_minor', -v_delta, 'credit_minor', 0,
                         'amount_base_minor', -v_delta, 'memo', 'Allowance released'),
      jsonb_build_object('account_id', v_expense,   'debit_minor', 0, 'credit_minor', -v_delta,
                         'amount_base_minor', -v_delta, 'memo', 'Allowance released'));
  end if;

  v_entry := acc_post_entry(
    p_as_of,
    coalesce(nullif(btrim(p_memo), ''), 'Allowance for doubtful accounts as of ' || p_as_of),
    'manual', null, v_currency, v_lines);

  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
  values ('acc_afda_rate', v_entry, 'insert', auth.uid(),
          jsonb_build_object('as_of', p_as_of, 'required_minor', v_required,
                             'previous_minor', v_previous, 'adjustment_minor', v_delta));

  return query select v_entry, v_required, v_previous, v_delta;
end;
$$;

revoke all on function acc_afda_evaluation(date) from public, anon;
revoke all on function acc_afda_balance(date) from public, anon;
revoke all on function acc_post_afda_adjustment(date, text) from public, anon;
grant execute on function acc_afda_evaluation(date) to authenticated;
grant execute on function acc_afda_balance(date) to authenticated;
grant execute on function acc_post_afda_adjustment(date, text) to authenticated;
