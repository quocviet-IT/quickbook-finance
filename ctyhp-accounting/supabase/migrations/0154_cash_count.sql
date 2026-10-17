-- ============================================================================
-- 0154 — Cash count: cash on hand is counted, and the count is dated.
--
-- A till float is proved by counting it, not by a bank statement, so
-- reconciliation never covers it. Recording a count compares the counted amount
-- with the books on that date and posts the difference (against 7510 Cash Over
-- and Short unless another account is chosen). The balance is never overwritten.
-- A count with no difference posts nothing but is still recorded, because it
-- still dates the count.
--
-- A cash account is an account with account_type = 'bank' and
-- detail_type = 'cash_on_hand' (0072: such an account cannot have a bank
-- account record, so Reconcile never shows it).
--
-- Needs 0152 (the 'cash_count' journal source; a new enum value cannot be used
-- in the transaction that adds it, so every function below names it only inside
-- a plpgsql body, which Postgres resolves when the function runs). The 7510
-- account is 0153's and is not needed here: the offset is chosen at count time.
--
-- Writes go only through the functions below: the table has a read policy and
-- no write policy, as acc_stock_count does (0139).
-- ============================================================================

set search_path = public;

-- ----------------------------------------------------------------------------
-- The table
-- ----------------------------------------------------------------------------
create table if not exists acc_cash_count (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references acc_account (id),
  counted_on          date not null,
  counted_minor       bigint not null check (counted_minor >= 0),
  -- the balance on counted_on, worked out by the server
  book_minor          bigint not null,
  -- counted - book
  difference_minor    bigint not null,
  offset_account_id   uuid not null references acc_account (id),
  memo                text check (memo is null or length(memo) <= 500),
  status              text not null
                        check (status in ('posted', 'pending_approval', 'rejected')),
  -- null when the difference is zero, or until a pending count is approved
  journal_entry_id    uuid references acc_journal_entry (id),
  approval_request_id uuid references acc_approval_request (id),
  created_by          uuid references auth.users (id),
  created_at          timestamptz not null default now(),
  constraint acc_cash_count_difference_ck
    check (difference_minor = counted_minor - book_minor),
  constraint acc_cash_count_offset_ck
    check (offset_account_id <> account_id),
  constraint acc_cash_count_posted_ck
    check (status <> 'posted' or ((difference_minor = 0) = (journal_entry_id is null)))
);

create index if not exists acc_cash_count_account_idx
  on acc_cash_count (account_id, counted_on desc, created_at desc, id desc);

drop trigger if exists acc_cash_count_actor_stamp on acc_cash_count;
create trigger acc_cash_count_actor_stamp
  before insert or update on acc_cash_count
  for each row execute function acc_stamp_actor();

drop trigger if exists acc_cash_count_atomic_audit on acc_cash_count;
create trigger acc_cash_count_atomic_audit
  after insert or update or delete on acc_cash_count
  for each row execute function acc_audit_row_change();

alter table acc_cash_count enable row level security;

-- Staff and viewers read; nobody else does.
drop policy if exists acc_cash_count_read on acc_cash_count;
create policy acc_cash_count_read on acc_cash_count
  for select using (acc_is_staff() or coalesce(acc_current_role() = 'viewer', false));

-- No insert, update or delete policy: an application session writes this table
-- only through the functions below.
revoke all on acc_cash_count from public, anon;
-- Schema public hands authenticated write rights on every new table through
-- Supabase's default privileges. This table is written only by the security
-- definer functions below, so take those rights back.
revoke insert, update, delete, truncate on acc_cash_count from authenticated;
grant select on acc_cash_count to authenticated;
grant all on acc_cash_count to service_role;

-- ----------------------------------------------------------------------------
-- The approval policy for the action. Off by default, with the default
-- threshold every policy row starts with (0), so nothing changes until an
-- administrator turns it on.
-- ----------------------------------------------------------------------------
insert into acc_approval_policy (action_key, label, description)
values ('cash_count', 'Cash count', 'Posting the difference when cash on hand is counted')
on conflict (action_key) do nothing;

-- ----------------------------------------------------------------------------
-- The books' balance of one account on a date: base currency, posted entries,
-- signed by side exactly as acc_ledger_balances (0009) reads a line. The dialog
-- shows it as the person types.
-- ----------------------------------------------------------------------------
create or replace function acc_cash_book_minor(p_account_id uuid, p_on date) returns bigint
language plpgsql stable security definer set search_path = public as $$
begin
  if not (acc_is_staff() or coalesce(acc_current_role() = 'viewer', false)) then
    raise exception 'Not authorized to read cash balances';
  end if;
  return (
    select coalesce(sum(case when jl.debit_minor > 0 then jl.amount_base_minor else 0 end), 0)::bigint
         - coalesce(sum(case when jl.credit_minor > 0 then jl.amount_base_minor else 0 end), 0)::bigint
      from acc_journal_line jl
      join acc_journal_entry e on e.id = jl.journal_entry_id
     where jl.account_id = p_account_id
       and e.status = 'posted'
       and e.entry_date <= p_on);
end;
$$;

-- ----------------------------------------------------------------------------
-- The entry a count posts: a shortage debits the offset and credits the cash
-- account, an overage the reverse. Internal; called by the two functions below.
-- ----------------------------------------------------------------------------
create or replace function acc_cash_count_post_entry(
  p_count_id          uuid,
  p_account_id        uuid,
  p_counted_on        date,
  p_offset_account_id uuid,
  p_difference_minor  bigint
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_name     text;
  v_amount   bigint := abs(p_difference_minor);
  v_currency text;
  v_lines    jsonb;
begin
  select name into v_name from acc_account where id = p_account_id;
  select code into v_currency from acc_currency where is_base limit 1;

  if p_difference_minor > 0 then
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', p_account_id, 'debit_minor', v_amount, 'credit_minor', 0,
                         'amount_base_minor', v_amount, 'memo', 'Cash count'),
      jsonb_build_object('account_id', p_offset_account_id, 'debit_minor', 0, 'credit_minor', v_amount,
                         'amount_base_minor', v_amount, 'memo', 'Cash count'));
  else
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', p_offset_account_id, 'debit_minor', v_amount, 'credit_minor', 0,
                         'amount_base_minor', v_amount, 'memo', 'Cash count'),
      jsonb_build_object('account_id', p_account_id, 'debit_minor', 0, 'credit_minor', v_amount,
                         'amount_base_minor', v_amount, 'memo', 'Cash count'));
  end if;

  perform acc_assert_postable(v_lines);
  return acc_post_entry(p_counted_on, 'Cash count: ' || v_name || ' on ' || p_counted_on,
                        'cash_count', p_count_id, v_currency, v_lines);
end;
$$;

-- ----------------------------------------------------------------------------
-- acc_post_cash_count — record a count. Returns a JSON object:
--   cash_count_id, status ('posted' or 'pending_approval'), journal_entry_id
--   (null for a zero difference or a count waiting for approval),
--   approval_request_id (null unless pending), book_minor, difference_minor.
-- When the company's cash_count approval policy applies to the size of the
-- difference, the count is saved as pending_approval with an approval request
-- and nothing posts until it is approved (acc_approve_request, below).
-- ----------------------------------------------------------------------------
create or replace function acc_post_cash_count(
  p_account_id        uuid,
  p_counted_on        date,
  p_counted_minor     bigint,
  p_offset_account_id uuid,
  p_memo              text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cash    acc_account;
  v_offset  acc_account;
  v_base    text;
  v_today   date;
  v_memo    text := nullif(btrim(coalesce(p_memo, '')), '');
  v_book    bigint;
  v_diff    bigint;
  v_id      uuid := gen_random_uuid();
  v_entry   uuid;
  v_request uuid;
begin
  if not acc_is_staff() then raise exception 'Not authorized to record a cash count'; end if;
  if p_account_id is null then raise exception 'Choose the cash account to count'; end if;
  if p_counted_on is null then raise exception 'Enter the date of the count'; end if;
  if p_counted_minor is null then raise exception 'Enter the amount counted'; end if;
  if p_counted_minor < 0 then raise exception 'The amount counted cannot be negative'; end if;
  if v_memo is not null and length(v_memo) > 500 then
    raise exception 'The memo is too long (500 characters at most)';
  end if;

  -- Serialises counts of one account without blocking the entries posted to it.
  select code into v_base from acc_currency where is_base limit 1;
  select * into v_cash from acc_account where id = p_account_id for no key update;
  if not found
     or v_cash.account_type <> 'bank'
     or v_cash.detail_type is distinct from 'cash_on_hand'
     or v_cash.status <> 'active'
     or not v_cash.is_posting_account
     or (v_cash.currency_code is not null and v_cash.currency_code is distinct from v_base) then
    raise exception 'Choose an active cash on hand account in the base currency';
  end if;

  select * into v_offset from acc_account where id = p_offset_account_id;
  if p_offset_account_id is null or not found
     or not v_offset.is_posting_account or v_offset.status <> 'active' then
    raise exception 'The offset account must be an active account you can post to';
  end if;
  if p_offset_account_id = p_account_id then
    raise exception 'The offset account must differ from the cash account';
  end if;

  -- Today in the company's own time zone, as the screens count it.
  v_today := coalesce(
    (select (now() at time zone s.time_zone)::date
       from acc_company_setting_version s order by s.version desc limit 1),
    current_date);
  if p_counted_on > v_today then
    raise exception 'A cash count cannot be dated after today';
  end if;
  if acc_is_period_closed(p_counted_on) then
    raise exception 'Accounting period for % is closed', p_counted_on;
  end if;

  v_book := acc_cash_book_minor(p_account_id, p_counted_on);
  v_diff := p_counted_minor - v_book;

  if v_diff <> 0 and acc_approval_required('cash_count', abs(v_diff)) and not acc_in_approval_dispatch() then
    insert into acc_cash_count
      (id, account_id, counted_on, counted_minor, book_minor, difference_minor,
       offset_account_id, memo, status)
    values (v_id, p_account_id, p_counted_on, p_counted_minor, v_book, v_diff,
            p_offset_account_id, v_memo, 'pending_approval');
    v_request := acc_submit_for_approval(
      'cash_count',
      'Cash count: ' || v_cash.name || ' on ' || p_counted_on,
      abs(v_diff),
      jsonb_build_object('cash_count_id', v_id),
      coalesce(v_memo, 'Cash count'));
    update acc_cash_count set approval_request_id = v_request where id = v_id;
    return jsonb_build_object('cash_count_id', v_id, 'status', 'pending_approval',
                              'journal_entry_id', null, 'approval_request_id', v_request,
                              'book_minor', v_book, 'difference_minor', v_diff);
  end if;

  if v_diff <> 0 then
    v_entry := acc_cash_count_post_entry(v_id, p_account_id, p_counted_on, p_offset_account_id, v_diff);
  end if;

  insert into acc_cash_count
    (id, account_id, counted_on, counted_minor, book_minor, difference_minor,
     offset_account_id, memo, status, journal_entry_id)
  values (v_id, p_account_id, p_counted_on, p_counted_minor, v_book, v_diff,
          p_offset_account_id, v_memo, 'posted', v_entry);

  if v_entry is not null then
    insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
    values ('acc_journal_entry', v_entry, 'post', auth.uid(),
            jsonb_build_object('cash_count_id', v_id, 'counted_on', p_counted_on,
                               'counted_minor', p_counted_minor, 'book_minor', v_book,
                               'difference_minor', v_diff));
  end if;

  return jsonb_build_object('cash_count_id', v_id, 'status', 'posted',
                            'journal_entry_id', v_entry, 'approval_request_id', null,
                            'book_minor', v_book, 'difference_minor', v_diff);
end;
$$;

-- ----------------------------------------------------------------------------
-- acc_post_pending_cash_count — the approval dispatch's call. Posts a count that
-- was waiting for approval. The difference is worked out again at approval,
-- against the books as they stand, as a stock count's is. Returns the entry id
-- (null if the books now agree with the count).
-- ----------------------------------------------------------------------------
create or replace function acc_post_pending_cash_count(p_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_count acc_cash_count;
  v_book  bigint;
  v_diff  bigint;
  v_entry uuid;
begin
  if not acc_in_approval_dispatch() then
    raise exception 'A cash count waiting for approval is posted only by approving its request';
  end if;
  if not acc_is_staff() then raise exception 'Not authorized to post a cash count'; end if;

  select * into v_count from acc_cash_count where id = p_id for update;
  if not found then raise exception 'Cash count not found'; end if;
  if v_count.status <> 'pending_approval' then
    raise exception 'Cash count is %, not waiting for approval', v_count.status;
  end if;

  if not exists (
       select 1 from acc_account a
        where a.id = v_count.offset_account_id and a.is_posting_account and a.status = 'active') then
    raise exception 'The offset account is no longer an active account you can post to';
  end if;

  v_book := acc_cash_book_minor(v_count.account_id, v_count.counted_on);
  v_diff := v_count.counted_minor - v_book;
  if v_diff <> 0 then
    v_entry := acc_cash_count_post_entry(p_id, v_count.account_id, v_count.counted_on,
                                         v_count.offset_account_id, v_diff);
  end if;

  update acc_cash_count
     set status = 'posted', book_minor = v_book, difference_minor = v_diff, journal_entry_id = v_entry
   where id = p_id;

  if v_entry is not null then
    insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
    values ('acc_journal_entry', v_entry, 'post', auth.uid(),
            jsonb_build_object('cash_count_id', p_id, 'counted_on', v_count.counted_on,
                               'counted_minor', v_count.counted_minor, 'book_minor', v_book,
                               'difference_minor', v_diff));
  end if;
  return v_entry;
end;
$$;

-- ----------------------------------------------------------------------------
-- A request that is rejected (or cancelled) leaves its count unposted, marked
-- 'rejected'. An AFTER UPDATE trigger on the request leaves acc_reject_request,
-- acc_cancel_request and every other approval function untouched.
-- ----------------------------------------------------------------------------
create or replace function acc_cash_count_request_closed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.action_key = 'cash_count'
     and old.status = 'pending'
     and new.status in ('rejected', 'cancelled')
     and new.payload ->> 'cash_count_id' is not null then
    update acc_cash_count
       set status = 'rejected'
     where id = (new.payload ->> 'cash_count_id')::uuid
       and status = 'pending_approval'
       and approval_request_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists acc_approval_request_cash_count on acc_approval_request;
create trigger acc_approval_request_cash_count
  after update on acc_approval_request
  for each row execute function acc_cash_count_request_closed();

-- ----------------------------------------------------------------------------
-- acc_cash_accounts_standing — one row per active cash on hand account: the
-- balance at p_as_of, the latest posted count on or before it (counted amount
-- and difference), and the days from that count to p_as_of. The last-count
-- columns are null for an account never counted.
-- ----------------------------------------------------------------------------
create or replace function acc_cash_accounts_standing(p_as_of date)
returns table (
  account_id       uuid,
  account_code     text,
  account_name     text,
  balance_minor    bigint,
  last_counted_on  date,
  counted_minor    bigint,
  difference_minor bigint,
  days_since       integer
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not (acc_is_staff() or coalesce(acc_current_role() = 'viewer', false)) then
    raise exception 'Not authorized to read cash accounts';
  end if;
  if p_as_of is null then raise exception 'Choose the date to read the cash accounts at'; end if;

  return query
  select a.id,
         a.account_code,
         a.name,
         coalesce(b.v, 0)::bigint,
         c.counted_on,
         c.counted_minor,
         c.difference_minor,
         case when c.counted_on is null then null else (p_as_of - c.counted_on)::integer end
    from acc_account a
    left join lateral (
      select sum(case when jl.debit_minor > 0 then jl.amount_base_minor else 0 end)
           - sum(case when jl.credit_minor > 0 then jl.amount_base_minor else 0 end) as v
        from acc_journal_line jl
        join acc_journal_entry e on e.id = jl.journal_entry_id
       where jl.account_id = a.id and e.status = 'posted' and e.entry_date <= p_as_of
    ) b on true
    left join lateral (
      select k.counted_on, k.counted_minor, k.difference_minor
        from acc_cash_count k
       where k.account_id = a.id and k.status = 'posted' and k.counted_on <= p_as_of
       order by k.counted_on desc, k.created_at desc, k.id desc
       limit 1
    ) c on true
   where a.account_type = 'bank' and a.detail_type = 'cash_on_hand' and a.status = 'active'
   order by a.account_code, a.id;
end;
$$;

-- ----------------------------------------------------------------------------
-- acc_approve_request — body from 0139_stock_count.sql with one extra branch: a
-- cash_count request posts that count. Copied mechanically so none of the
-- existing dispatcher can be lost in a retype.
-- ----------------------------------------------------------------------------
create or replace function acc_approve_request(p_request_id uuid, p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_req    acc_approval_request;
  v_policy acc_approval_policy;
  v_p      jsonb;
  v_result uuid;
begin
  if not acc_has_permission('approval.decide') then
    raise exception 'You do not have permission to decide approval requests';
  end if;

  select * into v_req from acc_approval_request where id = p_request_id for update;
  if not found then raise exception 'Approval request not found'; end if;
  if v_req.status <> 'pending' then raise exception 'Request is already %', v_req.status; end if;

  select * into v_policy from acc_approval_policy where action_key = v_req.action_key;
  if v_policy.require_segregation and v_req.requested_by = auth.uid() then
    raise exception 'You cannot approve your own request while segregation of duties is enabled';
  end if;

  v_p := v_req.payload;
  perform set_config('acc.approval_dispatch', 'on', true);

  if v_req.action_key = 'manual_journal' then
    v_result := acc_post_manual_journal(
      (v_p ->> 'entry_date')::date, v_p ->> 'description', v_p ->> 'source_ref',
      v_p ->> 'currency', v_p -> 'lines');
  elsif v_req.action_key = 'write_off' then
    v_result := acc_write_off(
      v_p ->> 'side', (v_p ->> 'target_id')::uuid, (v_p ->> 'offset_account_id')::uuid,
      (v_p ->> 'amount_minor')::bigint, (v_p ->> 'date')::date, v_req.reason);
  elsif v_req.action_key = 'inventory_adjustment' and v_p ->> 'stock_count_id' is not null then
    v_result := acc_post_stock_count(
      (v_p ->> 'stock_count_id')::uuid, (v_p ->> 'inventory_account_id')::uuid,
      (v_p ->> 'offset_account_id')::uuid);
  elsif v_req.action_key = 'inventory_adjustment' then
    v_result := acc_adjust_inventory(
      (v_p ->> 'item_id')::uuid, (v_p ->> 'date')::date, (v_p ->> 'qty_delta')::numeric,
      (v_p ->> 'unit_cost_minor')::bigint, (v_p ->> 'value_delta_minor')::bigint,
      (v_p ->> 'offset_account_id')::uuid, v_req.reason);
  elsif v_req.action_key = 'period_reopen' then
    perform acc_reopen_period((v_p ->> 'period_id')::uuid, v_req.reason);
    v_result := (v_p ->> 'period_id')::uuid;
  elsif v_req.action_key = 'reconciliation_reopen' then
    perform acc_reopen_reconciliation((v_p ->> 'reconciliation_id')::uuid, v_req.reason);
    v_result := (v_p ->> 'reconciliation_id')::uuid;
  elsif v_req.action_key = 'vendor_tax_profile' then
    v_result := acc_save_vendor_tax_profile(
      (v_p ->> 'vendor_id')::uuid,
      (v_p ->> 'w9_status')::acc_w9_status,
      nullif(v_p ->> 'w9_received_date', '')::date,
      nullif(v_p ->> 'w9_expires_date', '')::date,
      nullif(v_p ->> 'classification', '')::acc_tax_classification,
      v_p ->> 'reporting_name',
      v_p ->> 'tin_ref',
      nullif(v_p ->> 'tin_type', '')::acc_tin_type,
      v_p ->> 'address_line1', v_p ->> 'address_line2', v_p ->> 'city',
      v_p ->> 'region', v_p ->> 'postal_code', v_p ->> 'country',
      (v_p ->> 'is_1099_eligible')::boolean,
      v_p ->> 'box_code',
      (v_p ->> 'eligibility_override')::boolean,
      v_p ->> 'override_reason',
      v_req.reason);
  elsif v_req.action_key = 'cash_count' then
    v_result := acc_post_pending_cash_count((v_p ->> 'cash_count_id')::uuid);
  else
    raise exception 'No dispatch defined for %', v_req.action_key;
  end if;

  perform set_config('acc.approval_dispatch', 'off', true);

  update acc_approval_request
     set status = 'approved', decided_by = auth.uid(), decided_at = now(),
         decision_note = p_note, result_id = v_result
   where id = p_request_id;

  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
    values ('acc_approval_request', p_request_id, 'post', auth.uid(),
            jsonb_build_object('status', 'approved', 'result_id', v_result, 'note', p_note));
  return v_result;
end;
$$;

-- ----------------------------------------------------------------------------
-- Who may call what. The two internal functions are called only by the
-- functions above, which run as their owner, so signed-in users get no
-- execute on them.
-- ----------------------------------------------------------------------------
revoke all on function acc_cash_book_minor(uuid, date) from public, anon;
revoke all on function acc_post_cash_count(uuid, date, bigint, uuid, text) from public, anon;
revoke all on function acc_cash_accounts_standing(date) from public, anon;
revoke all on function acc_cash_count_post_entry(uuid, uuid, date, uuid, bigint) from public, anon, authenticated;
revoke all on function acc_post_pending_cash_count(uuid) from public, anon, authenticated;
revoke all on function acc_cash_count_request_closed() from public, anon, authenticated;
grant execute on function acc_cash_book_minor(uuid, date) to authenticated, service_role;
grant execute on function acc_post_cash_count(uuid, date, bigint, uuid, text) to authenticated, service_role;
grant execute on function acc_cash_accounts_standing(date) to authenticated, service_role;
