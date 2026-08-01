-- ============================================================================
-- 0081 — Indirect Statement of Cash Flows and month-close reconciliation.
--
-- The posted ledger is the source of every amount. Account cash-flow roles are
-- explicit policy: ambiguous current assets/liabilities remain unclassified
-- instead of being silently forced into Operating. The detailed RPC is the
-- single classification implementation; summary and close controls consume it.
-- ============================================================================

alter table acc_account
  add column if not exists cash_flow_role text;

update acc_account
   set cash_flow_role = case
     when account_type = 'bank' then 'cash'
     when account_type = 'accounts_receivable' then 'operating_receivable'
     when account_type = 'accounts_payable' then 'operating_payable'
     when account_type = 'fixed_asset' then 'investing'
     when account_type in ('equity', 'credit_card') then 'financing'
     when account_type in (
       'income', 'cost_of_goods_sold', 'expense', 'other_income', 'other_expense'
     ) then 'operating'
     else 'unclassified'
   end
 where cash_flow_role is null;

-- Known system control accounts have an unambiguous operating role. Inventory
-- accounts selected by items override the conservative current-asset default.
update acc_account
   set cash_flow_role = 'operating_inventory'
 where account_code = '1200'
    or id in (
      select distinct inventory_account_id
        from acc_item
       where inventory_account_id is not null
    );

update acc_account
   set cash_flow_role = 'operating_asset'
 where account_code in ('1210', '2110');

update acc_account
   set cash_flow_role = 'operating_liability'
 where account_code in ('2100', '2150');

alter table acc_account
  alter column cash_flow_role set default 'unclassified',
  alter column cash_flow_role set not null;

alter table acc_account
  add constraint acc_account_cash_flow_role_check check (
    cash_flow_role in (
      'cash', 'cash_equivalent', 'restricted_cash',
      'operating', 'operating_receivable', 'operating_inventory',
      'operating_payable', 'operating_asset', 'operating_liability',
      'investing', 'financing', 'exclude', 'unclassified'
    )
  );

create index acc_account_cash_flow_role_idx on acc_account (cash_flow_role);

-- One immutable-period snapshot is regenerated when a reopened period closes
-- again. Direct application writes are deliberately not granted.
create table acc_cash_flow_close_snapshot (
  period_id                  uuid primary key references acc_accounting_period (id) on delete cascade,
  classification_version    int not null default 1,
  opening_cash_minor         bigint not null,
  operating_minor            bigint not null,
  investing_minor            bigint not null,
  financing_minor            bigint not null,
  ending_cash_statement_minor bigint not null,
  balance_sheet_cash_minor   bigint not null,
  difference_minor           bigint not null,
  unclassified_minor         bigint not null,
  unclassified_count         bigint not null,
  ties_out                   boolean not null,
  generated_by               uuid references auth.users (id),
  generated_at               timestamptz not null default now()
);

alter table acc_cash_flow_close_snapshot enable row level security;
create policy acc_cash_flow_close_snapshot_read on acc_cash_flow_close_snapshot
  for select using (acc_current_role() is not null);
revoke all on table acc_cash_flow_close_snapshot from public, anon, authenticated;
grant select on table acc_cash_flow_close_snapshot to authenticated, service_role;

-- Every row is one auditable contribution to an indirect-statement line.
create or replace function acc_cash_flow_indirect_detail(p_from date, p_to date)
returns table (
  section text,
  line_code text,
  label text,
  journal_entry_id uuid,
  entry_number text,
  entry_date date,
  description text,
  source_type text,
  source_id uuid,
  account_id uuid,
  account_code text,
  account_name text,
  amount_minor bigint,
  classification_basis text
)
language sql stable security invoker set search_path = public as $$
  with period_lines as (
    select
      e.id as journal_entry_id,
      e.entry_number,
      e.entry_date,
      e.description,
      e.source_type,
      e.source_id,
      l.account_id,
      a.account_code,
      a.name as account_name,
      a.account_type,
      a.cash_flow_role,
      l.debit_minor,
      l.credit_minor,
      l.amount_base_minor
    from acc_journal_entry e
    join acc_journal_line l on l.journal_entry_id = e.id
    join acc_account a on a.id = l.account_id
    where e.status = 'posted'
      and e.entry_date between p_from and p_to
  ),
  cash_entries as (
    select distinct journal_entry_id
      from period_lines
     where cash_flow_role in ('cash', 'cash_equivalent', 'restricted_cash')
  ),
  bill_activity as (
    select
      b.id as bill_id,
      case
        when count(distinct x.activity) = 1 then max(x.activity)
        else 'unclassified'
      end as activity
    from acc_bill b
    join (
      select
        bl.bill_id,
        case
          when a.cash_flow_role = 'investing' then 'investing'
          when a.cash_flow_role = 'financing' then 'financing'
          when a.cash_flow_role = 'unclassified' then 'unclassified'
          else 'operating'
        end as activity
      from acc_bill_line bl
      join acc_account a on a.id = bl.expense_account_id
    ) x on x.bill_id = b.id
    group by b.id
  ),
  payment_activity as (
    select
      bp.id as payment_id,
      bp.journal_entry_id,
      case
        when bp.unapplied_minor = 0
         and count(distinct ba.activity) = 1
          then max(ba.activity)
        else 'unclassified'
      end as activity
    from acc_bill_payment bp
    left join acc_bill_payment_allocation bpa on bpa.bill_payment_id = bp.id
    left join bill_activity ba on ba.bill_id = bpa.bill_id
    where bp.status <> 'void'
    group by bp.id, bp.journal_entry_id, bp.unapplied_minor
  ),
  contributions as (
    -- Net income: income credits are positive; expense debits are negative.
    select
      'operating'::text as section,
      'net_income'::text as line_code,
      'Net income'::text as label,
      p.*,
      case when p.credit_minor > 0 then p.amount_base_minor
           else -p.amount_base_minor end as contribution_minor,
      'profit_and_loss'::text as classification_basis
    from period_lines p
    where p.account_type in (
      'income', 'cost_of_goods_sold', 'expense', 'other_income', 'other_expense'
    )

    union all

    -- Depreciation is included in net income but uses no cash.
    select
      'operating', 'depreciation', 'Depreciation and amortization', p.*,
      case when p.debit_minor > 0 then p.amount_base_minor
           else -p.amount_base_minor end,
      'journal_source:depreciation'
    from period_lines p
    where p.source_type = 'depreciation'
      and p.account_type in ('expense', 'other_expense')

    union all

    -- Reverse disposal gains/losses from CFO; full cash proceeds appear below.
    select
      'operating', 'asset_disposal_gain_loss',
      'Gain/loss on asset disposal', p.*,
      case when p.debit_minor > 0 then p.amount_base_minor
           else -p.amount_base_minor end,
      'journal_source:asset_disposal'
    from period_lines p
    where p.source_type = 'asset_disposal'
      and p.account_type in ('income', 'other_income', 'expense', 'other_expense')

    union all

    -- For both debit-normal operating assets and credit-normal operating
    -- liabilities, credit minus debit is the cash-flow adjustment.
    select
      'operating',
      case p.cash_flow_role
        when 'operating_receivable' then 'change_accounts_receivable'
        when 'operating_inventory' then 'change_inventory'
        when 'operating_payable' then 'change_accounts_payable'
        when 'operating_asset' then 'change_other_operating_assets'
        when 'operating_liability' then 'change_other_operating_liabilities'
      end,
      case p.cash_flow_role
        when 'operating_receivable' then 'Change in accounts receivable'
        when 'operating_inventory' then 'Change in inventory'
        when 'operating_payable' then 'Change in accounts payable'
        when 'operating_asset' then 'Change in other operating assets'
        when 'operating_liability' then 'Change in other operating liabilities'
      end,
      p.*,
      case when p.credit_minor > 0 then p.amount_base_minor
           else -p.amount_base_minor end,
      'account_role:' || p.cash_flow_role
    from period_lines p
    where p.cash_flow_role in (
      'operating_receivable', 'operating_inventory', 'operating_payable',
      'operating_asset', 'operating_liability'
    )

    union all

    -- A/P movements tied wholly to investing/financing bills are not operating
    -- working capital. Reverse those A/P contributions at bill recognition.
    select
      'operating', 'change_accounts_payable', 'Change in accounts payable', p.*,
      case when p.credit_minor > 0 then -p.amount_base_minor
           else p.amount_base_minor end,
      'document_context:nonoperating_bill'
    from period_lines p
    join bill_activity ba
      on p.source_type = 'bill' and p.source_id = ba.bill_id
    where p.cash_flow_role = 'operating_payable'
      and ba.activity in ('investing', 'financing')

    union all

    -- Reverse the corresponding A/P decrease when that bill is paid.
    select
      'operating', 'change_accounts_payable', 'Change in accounts payable', p.*,
      case when p.credit_minor > 0 then -p.amount_base_minor
           else p.amount_base_minor end,
      'document_context:nonoperating_bill_payment'
    from period_lines p
    join payment_activity pa on pa.journal_entry_id = p.journal_entry_id
    where p.source_type = 'bill_payment'
      and p.cash_flow_role = 'operating_payable'
      and pa.activity in ('investing', 'financing')

    union all

    -- The scoped-cash leg of a bill payment inherits the purpose of the bills
    -- it settles. Mixed or unapplied payments remain visibly unclassified.
    select
      case when pa.activity = 'investing' then 'investing'
           when pa.activity = 'financing' then 'financing'
           else 'unclassified' end,
      case when pa.activity = 'investing' then 'capital_purchases'
           when pa.activity = 'financing' then 'loan_repayments'
           else 'unclassified' end,
      case when pa.activity = 'investing' then 'Capital purchases'
           when pa.activity = 'financing' then 'Loan repayments'
           else 'Unclassified cash flow' end,
      p.*,
      case when p.debit_minor > 0 then p.amount_base_minor
           else -p.amount_base_minor end,
      'document_context:bill_payment'
    from period_lines p
    join payment_activity pa on pa.journal_entry_id = p.journal_entry_id
    where p.source_type = 'bill_payment'
      and p.cash_flow_role in ('cash', 'cash_equivalent', 'restricted_cash')
      and pa.activity in ('investing', 'financing', 'unclassified')

    union all

    -- A disposal's full scoped-cash proceeds are investing. Its fixed-asset,
    -- accumulated-depreciation and gain/loss lines are noncash components.
    select
      'investing', 'asset_sale_proceeds',
      'Asset sales and other investing proceeds', p.*,
      case when p.debit_minor > 0 then p.amount_base_minor
           else -p.amount_base_minor end,
      'journal_source:asset_disposal'
    from period_lines p
    where p.source_type = 'asset_disposal'
      and p.cash_flow_role in ('cash', 'cash_equivalent', 'restricted_cash')

    union all

    -- Other bank-touching entries use the explicitly stored noncash-account
    -- role. Asset disposals are excluded because the preceding branch owns the
    -- complete proceeds classification.
    select
      case when p.cash_flow_role = 'investing' then 'investing'
           when p.cash_flow_role = 'financing' then 'financing'
           else 'unclassified' end,
      case
        when p.cash_flow_role = 'investing' and p.credit_minor > 0
          then 'other_investing_proceeds'
        when p.cash_flow_role = 'investing'
          then 'capital_purchases'
        when p.cash_flow_role = 'financing'
             and p.account_type = 'equity' and p.credit_minor > 0
          then 'owner_contributions'
        when p.cash_flow_role = 'financing'
             and p.account_type = 'equity'
          then 'owner_distributions'
        when p.cash_flow_role = 'financing' and p.credit_minor > 0
          then 'loan_proceeds'
        when p.cash_flow_role = 'financing'
          then 'loan_repayments'
        else 'unclassified'
      end,
      case
        when p.cash_flow_role = 'investing' and p.credit_minor > 0
          then 'Other investing proceeds'
        when p.cash_flow_role = 'investing'
          then 'Capital purchases'
        when p.cash_flow_role = 'financing'
             and p.account_type = 'equity' and p.credit_minor > 0
          then 'Owner contributions'
        when p.cash_flow_role = 'financing'
             and p.account_type = 'equity'
          then 'Owner distributions'
        when p.cash_flow_role = 'financing' and p.credit_minor > 0
          then 'Loan proceeds'
        when p.cash_flow_role = 'financing'
          then 'Loan repayments'
        else 'Unclassified cash flow'
      end,
      p.*,
      case when p.credit_minor > 0 then p.amount_base_minor
           else -p.amount_base_minor end,
      'account_role:' || p.cash_flow_role
    from period_lines p
    join cash_entries c on c.journal_entry_id = p.journal_entry_id
    where p.source_type <> 'asset_disposal'
      and p.cash_flow_role in ('investing', 'financing', 'unclassified')
  )
  select
    c.section,
    c.line_code,
    c.label,
    c.journal_entry_id,
    c.entry_number,
    c.entry_date,
    c.description,
    c.source_type::text,
    c.source_id,
    c.account_id,
    c.account_code,
    c.account_name,
    c.contribution_minor::bigint as amount_minor,
    c.classification_basis
  from contributions c
  where c.contribution_minor <> 0;
$$;

create or replace function acc_cash_flow_indirect(p_from date, p_to date)
returns table (
  section text,
  line_code text,
  label text,
  amount_minor bigint,
  detail_count bigint,
  sort_order int
)
language sql stable security invoker set search_path = public as $$
  with template(section, line_code, label, sort_order) as (
    values
      ('operating', 'net_income', 'Net income', 10),
      ('operating', 'depreciation', 'Depreciation and amortization', 20),
      ('operating', 'asset_disposal_gain_loss', 'Gain/loss on asset disposal', 30),
      ('operating', 'change_accounts_receivable', 'Change in accounts receivable', 40),
      ('operating', 'change_inventory', 'Change in inventory', 50),
      ('operating', 'change_accounts_payable', 'Change in accounts payable', 60),
      ('operating', 'change_other_operating_assets', 'Change in other operating assets', 70),
      ('operating', 'change_other_operating_liabilities', 'Change in other operating liabilities', 80),
      ('investing', 'capital_purchases', 'Capital purchases', 110),
      ('investing', 'asset_sale_proceeds', 'Asset sales and other investing proceeds', 120),
      ('investing', 'other_investing_proceeds', 'Other investing proceeds', 130),
      ('financing', 'loan_proceeds', 'Loan proceeds', 210),
      ('financing', 'loan_repayments', 'Loan repayments', 220),
      ('financing', 'owner_contributions', 'Owner contributions', 230),
      ('financing', 'owner_distributions', 'Owner distributions', 240),
      ('unclassified', 'unclassified', 'Unclassified cash flow', 900)
  ),
  grouped as (
    select
      d.section,
      d.line_code,
      sum(d.amount_minor)::bigint as amount_minor,
      count(distinct d.journal_entry_id)::bigint as detail_count
    from acc_cash_flow_indirect_detail(p_from, p_to) d
    group by d.section, d.line_code
  ),
  cash_totals as (
    select
      coalesce(sum(case
        when e.entry_date < p_from
          then case when l.debit_minor > 0 then l.amount_base_minor
                    else -l.amount_base_minor end
        else 0 end), 0)::bigint as opening_cash_minor,
      coalesce(sum(case
        when e.entry_date <= p_to
          then case when l.debit_minor > 0 then l.amount_base_minor
                    else -l.amount_base_minor end
        else 0 end), 0)::bigint as closing_cash_minor
    from acc_journal_line l
    join acc_journal_entry e on e.id = l.journal_entry_id
    join acc_account a on a.id = l.account_id
    where e.status = 'posted'
      and e.entry_date <= p_to
      and a.cash_flow_role in ('cash', 'cash_equivalent', 'restricted_cash')
  ),
  rows as (
    select
      t.section,
      t.line_code,
      t.label,
      coalesce(g.amount_minor, 0)::bigint as amount_minor,
      coalesce(g.detail_count, 0)::bigint as detail_count,
      t.sort_order
    from template t
    left join grouped g
      on g.section = t.section and g.line_code = t.line_code

    union all

    select 'meta', 'opening_cash', 'Beginning cash',
           c.opening_cash_minor, 0::bigint, 0
      from cash_totals c

    union all

    select 'meta', 'closing_cash', 'Balance Sheet cash',
           c.closing_cash_minor, 0::bigint, 1000
      from cash_totals c
  )
  select * from rows order by sort_order;
$$;

create or replace function acc_cash_flow_reconciliation(p_from date, p_to date)
returns table (
  opening_cash_minor bigint,
  operating_minor bigint,
  investing_minor bigint,
  financing_minor bigint,
  ending_cash_statement_minor bigint,
  balance_sheet_cash_minor bigint,
  difference_minor bigint,
  unclassified_minor bigint,
  unclassified_count bigint
)
language sql stable security invoker set search_path = public as $$
  with rows as (
    select * from acc_cash_flow_indirect(p_from, p_to)
  ), totals as (
    select
      coalesce(max(amount_minor) filter (where line_code = 'opening_cash'), 0)::bigint as opening_cash,
      coalesce(sum(amount_minor) filter (where section = 'operating'), 0)::bigint as operating,
      coalesce(sum(amount_minor) filter (where section = 'investing'), 0)::bigint as investing,
      coalesce(sum(amount_minor) filter (where section = 'financing'), 0)::bigint as financing,
      coalesce(max(amount_minor) filter (where line_code = 'closing_cash'), 0)::bigint as closing_cash,
      coalesce(max(amount_minor) filter (where line_code = 'unclassified'), 0)::bigint as unclassified,
      coalesce(max(detail_count) filter (where line_code = 'unclassified'), 0)::bigint as unclassified_items
    from rows
  )
  select
    opening_cash,
    operating,
    investing,
    financing,
    opening_cash + operating + investing + financing,
    closing_cash,
    closing_cash - (opening_cash + operating + investing + financing),
    unclassified,
    unclassified_items
  from totals;
$$;

-- Add the cash-flow bridge to the same close gate that already verifies the
-- control accounts. A written override remains possible and is preserved.
create or replace function acc_period_close_blockers(p_period_id uuid)
returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v_p         acc_accounting_period;
  v_row       record;
  v_cf        record;
  v_parts     text[] := array[]::text[];
  v_variance  bigint;
begin
  select * into v_p from acc_accounting_period where id = p_period_id;
  if not found then raise exception 'Period not found'; end if;

  for v_row in select * from acc_control_reconciliation(v_p.period_end) loop
    v_variance := case
      when v_row.has_subledger then v_row.subledger_minor - v_row.control_minor
      else v_row.control_minor
    end;
    if v_variance <> 0 then
      v_parts := v_parts || format(
        '%s is out by %s',
        v_row.label,
        to_char(abs(v_variance) / 100.0, 'FM999,999,999,990.00')
      );
    end if;
  end loop;

  select * into v_cf
    from acc_cash_flow_reconciliation(v_p.period_start, v_p.period_end);
  if v_cf.difference_minor <> 0 or v_cf.unclassified_count <> 0 then
    v_parts := v_parts || format(
      'cash flow is out by %s with %s unclassified entr%s',
      to_char(abs(v_cf.difference_minor) / 100.0, 'FM999,999,999,990.00'),
      v_cf.unclassified_count,
      case when v_cf.unclassified_count = 1 then 'y' else 'ies' end
    );
  end if;

  if array_length(v_parts, 1) is null then return null; end if;
  return format(
    '%s close blocker(s) at %s: %s',
    array_length(v_parts, 1), v_p.period_end, array_to_string(v_parts, '; ')
  );
end;
$$;

create or replace function acc_close_period(
  p_period_id uuid,
  p_reason text,
  p_variance_note text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_p        acc_accounting_period;
  v_blockers text;
  v_cf       record;
begin
  if not acc_is_admin() then raise exception 'Only an admin can close a period'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A close reason is required'; end if;
  select * into v_p from acc_accounting_period where id = p_period_id for update;
  if not found then raise exception 'Period not found'; end if;
  if v_p.status = 'closed' then raise exception 'Period is already closed'; end if;

  v_blockers := acc_period_close_blockers(p_period_id);
  if v_blockers is not null and coalesce(btrim(p_variance_note), '') = '' then
    raise exception '% Close it anyway only with a written explanation of the difference.', v_blockers;
  end if;

  select * into v_cf
    from acc_cash_flow_reconciliation(v_p.period_start, v_p.period_end);

  update acc_accounting_period
     set status = 'closed', closed_by = auth.uid(), closed_at = now(),
         close_reason = p_reason,
         close_variance_note = case when v_blockers is null then null
                                    else btrim(p_variance_note) end
   where id = p_period_id;

  insert into acc_cash_flow_close_snapshot (
    period_id, classification_version, opening_cash_minor,
    operating_minor, investing_minor, financing_minor,
    ending_cash_statement_minor, balance_sheet_cash_minor, difference_minor,
    unclassified_minor, unclassified_count, ties_out,
    generated_by, generated_at
  ) values (
    p_period_id, 1, v_cf.opening_cash_minor,
    v_cf.operating_minor, v_cf.investing_minor, v_cf.financing_minor,
    v_cf.ending_cash_statement_minor, v_cf.balance_sheet_cash_minor,
    v_cf.difference_minor, v_cf.unclassified_minor, v_cf.unclassified_count,
    v_cf.difference_minor = 0 and v_cf.unclassified_count = 0,
    auth.uid(), now()
  )
  on conflict (period_id) do update set
    classification_version = excluded.classification_version,
    opening_cash_minor = excluded.opening_cash_minor,
    operating_minor = excluded.operating_minor,
    investing_minor = excluded.investing_minor,
    financing_minor = excluded.financing_minor,
    ending_cash_statement_minor = excluded.ending_cash_statement_minor,
    balance_sheet_cash_minor = excluded.balance_sheet_cash_minor,
    difference_minor = excluded.difference_minor,
    unclassified_minor = excluded.unclassified_minor,
    unclassified_count = excluded.unclassified_count,
    ties_out = excluded.ties_out,
    generated_by = excluded.generated_by,
    generated_at = excluded.generated_at;

  insert into acc_period_event (period_id, event, reason, actor_id)
    values (
      p_period_id, 'close',
      case when v_blockers is null then p_reason
           else p_reason || ' — closed over a variance: ' || v_blockers
                || ' Explanation: ' || btrim(p_variance_note) end,
      auth.uid()
    );
  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_accounting_period', p_period_id, 'close', auth.uid());
end;
$$;

revoke all on function acc_cash_flow_indirect_detail(date, date) from public, anon;
revoke all on function acc_cash_flow_indirect(date, date) from public, anon;
revoke all on function acc_cash_flow_reconciliation(date, date) from public, anon;
revoke all on function acc_period_close_blockers(uuid) from public;
revoke all on function acc_close_period(uuid, text, text) from public;

grant execute on function acc_cash_flow_indirect_detail(date, date) to authenticated, service_role;
grant execute on function acc_cash_flow_indirect(date, date) to authenticated, service_role;
grant execute on function acc_cash_flow_reconciliation(date, date) to authenticated, service_role;
grant execute on function acc_period_close_blockers(uuid) to authenticated, service_role;
grant execute on function acc_close_period(uuid, text, text) to authenticated, service_role;

notify pgrst, 'reload schema';
