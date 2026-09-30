-- ============================================================================
-- 0126 — Bank rules, and the history coding learns from.
--
-- A rule is what a person tells OneBook about a bank line: words or a
-- pattern, a direction, an amount window, an account. The first matching rule
-- suggests the account; nothing is posted until a person uses the suggestion,
-- through acc_categorise_bank_transaction as before.
--
-- acc_coding_history() hands the application every finished entry — one bank
-- leg and one other — with the texts it is known by. Which of them may teach
-- (active, posting, not a control or holding account) is decided in
-- lib/domain/coding.ts, where it is tested.
--
-- Nothing existing changes.
-- ============================================================================

set search_path = public;

create table if not exists acc_bank_rule (
  id         uuid primary key default gen_random_uuid(),
  position   int not null,
  match_kind text not null default 'words' check (match_kind in ('words', 'regex')),
  match_text text not null check (length(btrim(match_text)) between 1 and 200),
  direction  text not null default 'any' check (direction in ('in', 'out', 'any')),
  min_minor  bigint check (min_minor >= 0),
  max_minor  bigint check (max_minor >= 0),
  account_id uuid not null references acc_account (id),
  is_active  boolean not null default true,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now(),
  constraint acc_bank_rule_amount_window_ck
    check (min_minor is null or max_minor is null or min_minor <= max_minor)
);
create index if not exists acc_bank_rule_position_idx on acc_bank_rule (position);

drop trigger if exists acc_bank_rule_actor_stamp on acc_bank_rule;
create trigger acc_bank_rule_actor_stamp
  before insert or update on acc_bank_rule
  for each row execute function acc_stamp_actor();

drop trigger if exists acc_bank_rule_atomic_audit on acc_bank_rule;
create trigger acc_bank_rule_atomic_audit
  after insert or update or delete on acc_bank_rule
  for each row execute function acc_audit_row_change();

alter table acc_bank_rule enable row level security;

drop policy if exists acc_bank_rule_sel on acc_bank_rule;
create policy acc_bank_rule_sel on acc_bank_rule
  for select using (acc_is_staff() or acc_current_role() = 'viewer');
drop policy if exists acc_bank_rule_ins on acc_bank_rule;
create policy acc_bank_rule_ins on acc_bank_rule
  for insert with check (acc_is_staff());
drop policy if exists acc_bank_rule_upd on acc_bank_rule;
create policy acc_bank_rule_upd on acc_bank_rule
  for update using (acc_is_staff()) with check (acc_is_staff());
drop policy if exists acc_bank_rule_del on acc_bank_rule;
create policy acc_bank_rule_del on acc_bank_rule
  for delete using (acc_is_staff());

revoke all on acc_bank_rule from public, anon;
grant select, insert, update, delete on acc_bank_rule to authenticated;
grant all on acc_bank_rule to service_role;

-- --- Putting rules in order, in one statement --------------------------------
create or replace function acc_reorder_bank_rules(p_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to change bank rules';
  end if;
  if (select count(*) from acc_bank_rule) <> coalesce(array_length(p_ids, 1), 0)
     or exists (select 1 from acc_bank_rule r where not (r.id = any (p_ids))) then
    raise exception 'The new order must list every rule once';
  end if;
  update acc_bank_rule r
     set position = o.ordinality::int
    from unnest(p_ids) with ordinality as o(id, ordinality)
   where r.id = o.id
     and r.position is distinct from o.ordinality::int;
end;
$$;

revoke all on function acc_reorder_bank_rules(uuid[]) from public, anon;
grant execute on function acc_reorder_bank_rules(uuid[]) to authenticated, service_role;

-- --- The entries coding learns from --------------------------------------------
-- As the invoker, so row-level security decides what a reader may learn from.
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
           a.account_type = 'bank' as is_bank
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
         o.account_id,
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
   order by e.id;
$$;

revoke all on function acc_coding_history() from public, anon;
grant execute on function acc_coding_history() to authenticated, service_role;
