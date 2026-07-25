-- ============================================================================
-- Reporting upgrade: fiscal-year budgets, Budget vs Actual support, and the
-- permission boundary for maintaining budget assumptions.
-- ============================================================================

create table acc_budget (
  id          uuid primary key default gen_random_uuid(),
  fiscal_year int not null check (fiscal_year between 2000 and 2100),
  name        text not null,
  created_by  uuid references auth.users (id),
  updated_by  uuid references auth.users (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (fiscal_year)
);

create table acc_budget_line (
  id           uuid primary key default gen_random_uuid(),
  budget_id    uuid not null references acc_budget (id) on delete cascade,
  account_id   uuid not null references acc_account (id),
  period_start date not null,
  amount_minor bigint not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (budget_id, account_id, period_start),
  check (period_start = date_trunc('month', period_start)::date)
);

create index acc_budget_line_period_idx
  on acc_budget_line (budget_id, period_start, account_id);

insert into acc_permission (key, label, category, description, is_enforced)
values (
  'budget.manage',
  'Manage budgets',
  'Reporting',
  'Create and update monthly account budgets used by Budget vs Actual reports',
  true
)
on conflict (key) do nothing;

insert into acc_role_permission (role, permission_key, allowed)
select role, 'budget.manage', role in ('admin', 'accountant')
  from unnest(enum_range(null::acc_app_role)) as r(role)
on conflict (role, permission_key)
do update set allowed = excluded.allowed;

alter table acc_budget enable row level security;
alter table acc_budget_line enable row level security;

create policy acc_budget_read on acc_budget
  for select using (acc_current_role() is not null);
create policy acc_budget_line_read on acc_budget_line
  for select using (acc_current_role() is not null);

-- Replace one fiscal month atomically. Zero values are omitted from storage;
-- report functions still surface every P&L account with a zero budget.
create or replace function acc_save_budget_month(
  p_fiscal_year int,
  p_period_start date,
  p_lines jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_budget_id uuid;
  v_start_month int;
  v_fy_start date;
  v_fy_end date;
begin
  if not acc_has_permission('budget.manage') then
    raise exception 'You do not have permission to manage budgets';
  end if;
  if p_fiscal_year not between 2000 and 2100 then
    raise exception 'Fiscal year must be between 2000 and 2100';
  end if;
  if p_period_start is null or p_period_start <> date_trunc('month', p_period_start)::date then
    raise exception 'Budget period must be the first day of a month';
  end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' then
    raise exception 'Budget lines must be an array';
  end if;

  select fiscal_year_start_month into v_start_month
    from acc_company_setting_version
   order by effective_from desc, version desc
   limit 1;
  v_start_month := coalesce(v_start_month, 1);
  v_fy_start := make_date(p_fiscal_year, v_start_month, 1);
  v_fy_end := (v_fy_start + interval '1 year' - interval '1 day')::date;
  if p_period_start < v_fy_start or p_period_start > v_fy_end then
    raise exception 'Budget period is outside fiscal year %', p_fiscal_year;
  end if;

  if exists (
    select 1
      from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) line
     group by (line ->> 'account_id')
    having count(*) > 1
  ) then
    raise exception 'A budget month cannot contain duplicate accounts';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) line
      left join acc_account a on a.id = (line ->> 'account_id')::uuid
     where a.id is null
        or not a.is_posting_account
        or a.account_type not in (
          'income', 'cost_of_goods_sold', 'expense', 'other_income', 'other_expense'
        )
  ) then
    raise exception 'Budgets may only use posting Profit and Loss accounts';
  end if;

  insert into acc_budget (fiscal_year, name, created_by, updated_by)
  values (
    p_fiscal_year,
    'FY ' || p_fiscal_year::text || ' Operating Budget',
    auth.uid(),
    auth.uid()
  )
  on conflict (fiscal_year)
  do update set updated_by = auth.uid(), updated_at = now()
  returning id into v_budget_id;

  delete from acc_budget_line
   where budget_id = v_budget_id and period_start = p_period_start;

  insert into acc_budget_line (budget_id, account_id, period_start, amount_minor)
  select
    v_budget_id,
    (line ->> 'account_id')::uuid,
    p_period_start,
    (line ->> 'amount_minor')::bigint
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) line
  where coalesce((line ->> 'amount_minor')::bigint, 0) <> 0;

  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
  values (
    'acc_budget',
    v_budget_id,
    'update',
    auth.uid(),
    jsonb_build_object(
      'fiscal_year', p_fiscal_year,
      'period_start', p_period_start,
      'line_count', jsonb_array_length(coalesce(p_lines, '[]'::jsonb))
    )
  );
  return v_budget_id;
end;
$$;

-- Return all posting P&L accounts so editors and reports retain zero-value rows.
create or replace function acc_budget_lines(
  p_fiscal_year int,
  p_from date,
  p_to date
)
returns table (
  account_id uuid,
  account_code text,
  name text,
  account_type acc_account_type,
  amount_minor bigint
)
language sql stable as $$
  select
    a.id,
    a.account_code,
    a.name,
    a.account_type,
    coalesce(sum(bl.amount_minor) filter (
      where bl.period_start between p_from and p_to
    ), 0)::bigint
  from acc_account a
  left join acc_budget b on b.fiscal_year = p_fiscal_year
  left join acc_budget_line bl
    on bl.budget_id = b.id and bl.account_id = a.id
  where a.is_posting_account
    and a.account_type in (
      'income', 'cost_of_goods_sold', 'expense', 'other_income', 'other_expense'
    )
  group by a.id, a.account_code, a.name, a.account_type
  order by a.account_code;
$$;

notify pgrst, 'reload schema';
