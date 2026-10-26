-- ============================================================================
-- 0166  Report and lookup functions answer only members of the company (2.56)
--
-- The permission review of 24-26 October 2026 found 33 functions that run with
-- their owner's rights (SECURITY DEFINER, so row-level security does not apply
-- inside them), that any signed-in user may call, and that never asked who was
-- calling. Every signed-in user has USAGE on every company schema and every
-- company schema is exposed through the API, so a person with no place in a
-- company - or one suspended from it - could read that company's general
-- ledger, transaction list and open items, customer names included, by
-- calling these functions directly. Proven in a throwaway company on 26 Oct.
--
-- This adds one line to the top of 26 of them and changes nothing else in
-- their bodies (tests/unit/report-functions-membership-migration.test.ts holds
-- each to its previous definition):
--
--   acc_assert_member()   refuses (42501) unless the caller holds a role in
--                         this company (acc_current_role() is not null), or
--                         acts for no one: the service role (background jobs
--                         through the API) or a direct database session that
--                         has not taken on a request role (migrations, restore).
--
-- A member of the company sees no difference. acc_apply_vendor_terms is only
-- ever called by other functions, so the API may no longer call it at all.
--
-- Left as they are, each for its reason (the live test lists them):
--   acc_bank_feed_sync_cut_off, acc_document_storage_path_allowed,
--   acc_feedback_screenshot_path_allowed  - compute from their arguments only;
--   acc_document_entity_exists            - answers yes or no for an id the
--                                           caller already holds;
--   acc_delete_bank_transaction_with_void, acc_set_cleared_many
--                                         - every write goes through a function
--                                           that checks acc_is_staff() first.
-- ============================================================================
set search_path = public;

create or replace function acc_assert_member()
returns void
language plpgsql stable set search_path = public as $$
begin
  if acc_current_role() is not null then
    return;
  end if;
  -- Callers that act for no one: the service role, through the API, and a
  -- direct database session that never took on a request role. Inside a
  -- SECURITY DEFINER function current_user is the owner, but the role a
  -- request set (authenticated, anon, service_role) is still the setting.
  if coalesce(nullif(current_setting('role', true), ''), 'none') in ('none', 'service_role') then
    return;
  end if;
  raise exception 'Not authorized: you are not a member of this company'
    using errcode = '42501';
end;
$$;

revoke all on function acc_assert_member() from public, anon, authenticated;

revoke execute on function acc_apply_vendor_terms(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- acc_account_ref_matches (as 0110_inactive_breaks_the_tie, plus the membership check)
-- ----------------------------------------------------------------------------
create or replace function acc_account_ref_matches(p_refs text[])
returns table (ref text, account_id uuid, matched_by text, candidate_codes text[])
language plpgsql stable security definer set search_path = public as $$
declare
  v_raw   text;
  v_key   text;
  v_id    uuid;
  v_codes text[];
  v_live  text[];
begin
  perform acc_assert_member();
  for v_raw in
    select distinct btrim(x)
      from unnest(coalesce(p_refs, array[]::text[])) as x
     where btrim(coalesce(x, '')) <> ''
  loop
    v_key          := acc_normalize_ref(v_raw);
    ref            := v_raw;
    account_id     := null;
    matched_by     := null;
    candidate_codes := array[]::text[];

    -- The account code. Unique by construction, so this can only ever name one
    -- account, which is why it is offered as the way out of every ambiguity.
    select a.id into v_id
      from acc_account a
     where acc_normalize_ref(a.account_code) = v_key
       and a.status <> 'archived'
     limit 1;
    if v_id is not null then
      account_id := v_id;
      matched_by := 'code';
      return next;
      continue;
    end if;

    -- The code and the name together, which inherits the code's uniqueness.
    select a.id into v_id
      from acc_account a
     where acc_normalize_ref(a.account_code || ' - ' || a.name) = v_key
       and a.status <> 'archived'
     limit 1;
    if v_id is not null then
      account_id := v_id;
      matched_by := 'code_and_name';
      return next;
      continue;
    end if;

    -- The bare name. Collect every account that answers to it before deciding,
    -- because the count is the whole answer: one is a match, two is a question.
    select array_agg(a.account_code order by a.account_code)
      into v_codes
      from acc_account a
     where acc_normalize_ref(a.name) = v_key
       and a.status <> 'archived';
    v_codes := coalesce(v_codes, array[]::text[]);

    -- Unless the chart has already answered it. One live account and one
    -- switched off is a decision somebody made on purpose, and honouring it is
    -- the only remedy open to a reader importing a file they cannot edit.
    if coalesce(array_length(v_codes, 1), 0) > 1 then
      select array_agg(a.account_code order by a.account_code)
        into v_live
        from acc_account a
       where acc_normalize_ref(a.name) = v_key
         and a.status = 'active';
      if coalesce(array_length(v_live, 1), 0) = 1 then
        v_codes := v_live;
      end if;
    end if;
    candidate_codes := v_codes;

    if coalesce(array_length(v_codes, 1), 0) = 1 then
      select a.id into account_id
        from acc_account a
       where acc_normalize_ref(a.name) = v_key
         and a.status <> 'archived'
         and a.account_code = v_codes[1]
       limit 1;
      matched_by := 'name';
    elsif coalesce(array_length(v_codes, 1), 0) > 1 then
      matched_by := 'ambiguous';
    end if;

    return next;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- acc_active_admin_count (as 0037_access_control_functions, plus the membership check)
-- ----------------------------------------------------------------------------
create or replace function acc_active_admin_count() returns int
language sql stable security definer set search_path = public as $$
  select acc_assert_member();
  select count(*)::int from acc_app_user
   where role = 'admin' and status in ('invited', 'active');
$$;

-- ----------------------------------------------------------------------------
-- acc_afda_balance (as 0093_allowance_for_doubtful_accounts, plus the membership check)
-- ----------------------------------------------------------------------------
create or replace function acc_afda_balance(p_as_of date) returns bigint
language sql stable security definer set search_path = public as $$
  select acc_assert_member();
  select coalesce(sum(l.credit_minor - l.debit_minor), 0)::bigint
    from acc_journal_line l
    join acc_journal_entry e on e.id = l.journal_entry_id
    join acc_account a on a.id = l.account_id
   where a.account_code = '1190'
     and e.status = 'posted'
     and e.entry_date <= p_as_of;
$$;

-- ----------------------------------------------------------------------------
-- acc_afda_evaluation (as 0093_allowance_for_doubtful_accounts, plus the membership check)
-- ----------------------------------------------------------------------------
create or replace function acc_afda_evaluation(p_as_of date)
returns table (
  bucket_key     text,
  balance_minor  bigint,
  rate_bps       int,
  required_minor bigint
)
language sql stable security definer set search_path = public as $$
  select acc_assert_member();
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

-- ----------------------------------------------------------------------------
-- acc_approval_required (as 0037_access_control_functions, plus the membership check)
-- ----------------------------------------------------------------------------
create or replace function acc_approval_required(p_action_key text, p_amount_minor bigint)
returns boolean
language sql stable security definer set search_path = public as $$
  select acc_assert_member();
  select coalesce(
    (select p.enabled and abs(coalesce(p_amount_minor, 0)) >= p.threshold_minor
       from acc_approval_policy p where p.action_key = p_action_key),
    false);
$$;

-- ----------------------------------------------------------------------------
-- acc_bank_import_batch_locked_lines (as 0109_undo_bank_statement_import, plus the membership check)
-- ----------------------------------------------------------------------------
create or replace function acc_bank_import_batch_locked_lines(p_batch_id uuid)
returns int
language sql stable security definer set search_path = public as $$
  select acc_assert_member();
  select count(*)::int
    from acc_bank_transaction t
   where t.import_batch_id = p_batch_id
     and (t.status <> 'unmatched'
          or exists (select 1 from acc_reconciliation r where r.bank_transaction_id = t.id));
$$;

-- ----------------------------------------------------------------------------
-- acc_bank_statement_imports (as 0135_keep_statement_files, plus the membership check)
-- ----------------------------------------------------------------------------
create or replace function acc_bank_statement_imports(p_bank_account_id uuid default null)
returns table (
  id uuid, bank_account_id uuid, account_code text, account_name text,
  filename text, row_count int, lines_here int, locked_lines int,
  imported_at timestamptz, status text, voided_at timestamptz, void_reason text,
  statement_file_id uuid
)
language sql stable security definer set search_path = public as $$
  select acc_assert_member();
  select b.id, b.bank_account_id, a.account_code, a.name,
         b.filename, b.row_count,
         (select count(*)::int from acc_bank_transaction t where t.import_batch_id = b.id),
         acc_bank_import_batch_locked_lines(b.id),
         b.imported_at, b.status, b.voided_at, b.void_reason,
         b.statement_file_id
    from acc_bank_import_batch b
    join acc_bank_account ba on ba.id = b.bank_account_id
    join acc_account a on a.id = ba.account_id
   where p_bank_account_id is null or b.bank_account_id = p_bank_account_id
   order by b.imported_at desc
   limit 20;
$$;

-- ----------------------------------------------------------------------------
-- acc_bank_transaction_postings (as 0111_categorise_bank_transaction, plus the membership check)
-- ----------------------------------------------------------------------------
create or replace function acc_bank_transaction_postings(p_bank_account_id uuid default null)
returns table (
  bank_transaction_id uuid,
  journal_entry_id uuid,
  entry_number text,
  account_id uuid,
  account_code text,
  account_name text,
  source_type text,
  own_entry boolean
)
language sql stable security definer set search_path = public as $$
  select acc_assert_member();
  select r.bank_transaction_id,
         e.id,
         e.entry_number,
         a.id,
         a.account_code,
         a.name,
         e.source_type::text,
         -- Whether this screen may take it back: an entry nothing else owns,
         -- on a line no import batch claims.
         (e.source_type = 'bank' and e.source_id is null and t.transaction_batch_id is null)
    from acc_reconciliation r
    join acc_bank_transaction t on t.id = r.bank_transaction_id
    join acc_journal_line bank_line on bank_line.id = r.journal_line_id
    join acc_journal_entry e on e.id = bank_line.journal_entry_id
    join acc_journal_line other on other.journal_entry_id = e.id
                               and other.account_id <> bank_line.account_id
    join acc_account a on a.id = other.account_id
   where e.status = 'posted'
     -- Approved only. A *suggested* reconciliation is the matcher's opinion
     -- that this line might already be in the books; treating it as a posting
     -- hid the control on every line that had one, which is exactly the ten
     -- lines a reader could not categorise.
     and r.status = 'approved'
     and (p_bank_account_id is null or t.bank_account_id = p_bank_account_id);
$$;

-- ----------------------------------------------------------------------------
-- acc_bill_settlements (as 0077_settlement_entry_reference, plus the membership check)
-- ----------------------------------------------------------------------------
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
  select acc_assert_member();
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

-- ----------------------------------------------------------------------------
-- acc_control_reconciliation (as 0164_sales_receipts, plus the membership check)
-- ----------------------------------------------------------------------------
create or replace function acc_control_reconciliation(p_as_of date)
returns table (
  control_key       text,
  label             text,
  account_codes     text,
  has_subledger     boolean,
  subledger_minor   bigint,
  control_minor     bigint
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_grni uuid := acc_active_grni_account();
begin
  perform acc_assert_member();
  return query
  -- Accounts receivable: what customers still owe, less credit not yet applied.
  select 'ar'::text, 'Accounts Receivable'::text,
         (select string_agg(distinct a.account_code, ', ' order by a.account_code)
            from acc_account a where a.account_type = 'accounts_receivable'),
         true,
         (
           coalesce((select sum(i.balance_due_minor) from acc_invoice i
                      where i.status in ('issued', 'partial') and i.issue_date <= p_as_of), 0)
         - coalesce((select sum(cm.balance_remaining_minor) from acc_credit_memo cm
                      where cm.status in ('issued', 'partial') and cm.memo_date <= p_as_of), 0)
         )::bigint,
         coalesce((select sum(jl.debit_minor - jl.credit_minor)
                     from acc_journal_line jl
                     join acc_journal_entry je on je.id = jl.journal_entry_id
                     join acc_account a on a.id = jl.account_id
                    where a.account_type = 'accounts_receivable'
                      and je.status = 'posted' and je.entry_date <= p_as_of), 0)::bigint;

  -- Accounts payable: what is owed to vendors, less vendor credit not applied.
  return query
  select 'ap', 'Accounts Payable',
         (select string_agg(distinct a.account_code, ', ' order by a.account_code)
            from acc_account a where a.account_type = 'accounts_payable'),
         true,
         (
           coalesce((select sum(b.balance_due_minor) from acc_bill b
                      where b.status in ('open', 'partial') and b.bill_date <= p_as_of), 0)
         - coalesce((select sum(vc.balance_remaining_minor) from acc_vendor_credit vc
                      where vc.status in ('issued', 'partial') and vc.credit_date <= p_as_of), 0)
         )::bigint,
         -- Payables sit on the credit side; report the subledger's own sign.
         coalesce((select sum(jl.credit_minor - jl.debit_minor)
                     from acc_journal_line jl
                     join acc_journal_entry je on je.id = jl.journal_entry_id
                     join acc_account a on a.id = jl.account_id
                    where a.account_type = 'accounts_payable'
                      and je.status = 'posted' and je.entry_date <= p_as_of), 0)::bigint;

  -- Inventory: quantity on hand at weighted average cost.
  return query
  select 'inventory', 'Inventory',
         (select string_agg(distinct a.account_code, ', ' order by a.account_code)
            from acc_account a
            join acc_item it on it.inventory_account_id = a.id
           where it.is_inventory),
         true,
         coalesce((select sum(v.value_minor) from acc_inventory_valuation(p_as_of) v), 0)::bigint,
         coalesce((select sum(jl.debit_minor - jl.credit_minor)
                     from acc_journal_line jl
                     join acc_journal_entry je on je.id = jl.journal_entry_id
                    where jl.account_id in (select distinct it.inventory_account_id
                                              from acc_item it
                                             where it.is_inventory
                                               and it.inventory_account_id is not null)
                      and je.status = 'posted' and je.entry_date <= p_as_of), 0)::bigint;

  -- Goods received not invoiced: received on a purchase order, not yet billed.
  return query
  select 'grni', 'Goods Received Not Invoiced',
         (select a.account_code from acc_account a where a.id = v_grni),
         v_grni is not null,
         coalesce((select sum((pol.qty_received - pol.qty_billed) * pol.unit_cost_minor)
                     from acc_purchase_order_line pol
                     join acc_purchase_order po on po.id = pol.purchase_order_id
                    where pol.qty_received > pol.qty_billed
                      and po.order_date <= p_as_of), 0)::bigint,
         coalesce((select sum(jl.credit_minor - jl.debit_minor)
                     from acc_journal_line jl
                     join acc_journal_entry je on je.id = jl.journal_entry_id
                    where jl.account_id = v_grni
                      and je.status = 'posted' and je.entry_date <= p_as_of), 0)::bigint;

  -- Sales tax payable: tax charged on live invoices and sales receipts, less
  -- tax remitted.
  return query
  select 'sales_tax', 'Sales Tax Payable',
         (select string_agg(distinct a.account_code, ', ' order by a.account_code)
            from acc_account a
            join acc_tax_code tc on tc.tax_account_id = a.id),
         true,
         (
           coalesce((select sum(i.tax_total_minor) from acc_invoice i
                      where i.status in ('issued', 'partial', 'paid') and i.issue_date <= p_as_of), 0)
         + coalesce((select sum(sr.tax_minor) from acc_sales_receipt sr
                      where sr.status = 'posted' and sr.receipt_date <= p_as_of), 0)
         - coalesce((select sum(cm.tax_total_minor) from acc_credit_memo cm
                      where cm.status <> 'draft' and cm.status <> 'void' and cm.memo_date <= p_as_of), 0)
         - coalesce((select sum(tp.amount_minor) from acc_tax_payment tp
                      where tp.status = 'posted' and tp.payment_date <= p_as_of), 0)
         )::bigint,
         coalesce((select sum(jl.credit_minor - jl.debit_minor)
                     from acc_journal_line jl
                     join acc_journal_entry je on je.id = jl.journal_entry_id
                    where jl.account_id in (select distinct tc.tax_account_id
                                              from acc_tax_code tc
                                             where tc.tax_account_id is not null)
                      and je.status = 'posted' and je.entry_date <= p_as_of), 0)::bigint;

  -- Undeposited funds: no subledger feeds it, so the ledger balance is
  -- reported on its own. Anything sitting here came from a manual journal and
  -- deserves an explanation, which is exactly what the screen will ask for.
  return query
  select 'undeposited', 'Undeposited Funds',
         (select string_agg(a.account_code, ', ' order by a.account_code)
            from acc_account a where a.account_code = '1210'),
         false,
         0::bigint,
         coalesce((select sum(jl.debit_minor - jl.credit_minor)
                     from acc_journal_line jl
                     join acc_journal_entry je on je.id = jl.journal_entry_id
                     join acc_account a on a.id = jl.account_id
                    where a.account_code = '1210'
                      and je.status = 'posted' and je.entry_date <= p_as_of), 0)::bigint;
end;
$$;

-- ----------------------------------------------------------------------------
-- acc_current_work_policy (as 0120_close_window_policy, plus the membership check)
-- ----------------------------------------------------------------------------
create or replace function acc_current_work_policy()
returns table (
  materiality_minor       bigint,
  approval_sla_days       int,
  unmatched_bank_age_days int,
  close_window_days       int,
  note                    text,
  created_at              timestamptz,
  created_by              uuid
)
language sql stable security definer set search_path = public as $$
  select acc_assert_member();
  select p.materiality_minor, p.approval_sla_days, p.unmatched_bank_age_days,
         p.close_window_days, p.note, p.created_at, p.created_by
    from acc_work_policy p
   order by p.version desc
   limit 1;
$$;

-- ----------------------------------------------------------------------------
-- acc_fail_recurring_run (as 0053_recurring_transactions_functions, plus the membership check)
-- ----------------------------------------------------------------------------
create or replace function acc_fail_recurring_run(p_run_id uuid, p_error text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_template_id uuid;
begin
  perform acc_assert_member();
  if not acc_recurring_authorized() then
    raise exception 'You do not have permission to update recurring transactions';
  end if;
  update acc_recurring_run
     set status = 'failed',
         error_message = left(coalesce(p_error, 'Generation failed'), 1000),
         completed_at = now()
   where id = p_run_id
   returning template_id into v_template_id;
  if not found then raise exception 'Recurring run not found'; end if;

  update acc_recurring_template
     set last_run_at = now(),
         last_run_status = 'failed',
         last_error = left(coalesce(p_error, 'Generation failed'), 1000),
         updated_at = now()
   where id = v_template_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- acc_gl_posting_report (as 0164_sales_receipts, plus the membership check)
-- ----------------------------------------------------------------------------
create or replace function acc_gl_posting_report(p_from date, p_to date)
returns table (
  source_type      text,
  document_id      uuid,
  document_number  text,
  document_date    date,
  party_name       text,
  document_status  text,
  amount_minor     bigint,
  journal_entry_id uuid,
  entry_number     text,
  entry_date       date,
  entry_status     text,
  entry_total_minor bigint
)
language sql stable security definer set search_path = public as $$
  select acc_assert_member();
  with documents as (
    select 'invoice'::text, i.id, i.invoice_number, i.issue_date, c.name,
           i.status::text, i.total_minor, i.journal_entry_id
      from acc_invoice i join acc_customer c on c.id = i.customer_id
     where i.issue_date between p_from and p_to
    union all
    select 'sales_receipt', sr.id, sr.receipt_number, sr.receipt_date, c.name,
           sr.status, sr.total_minor, sr.journal_entry_id
      from acc_sales_receipt sr join acc_customer c on c.id = sr.customer_id
     where sr.receipt_date between p_from and p_to
    union all
    select 'bill', b.id, b.bill_number, b.bill_date, v.name,
           b.status::text, b.total_minor, b.journal_entry_id
      from acc_bill b join acc_vendor v on v.id = b.vendor_id
     where b.bill_date between p_from and p_to
    union all
    select 'customer_payment', p.id, p.payment_number, p.payment_date, c.name,
           p.status::text, p.amount_minor, p.journal_entry_id
      from acc_payment p join acc_customer c on c.id = p.customer_id
     where p.payment_date between p_from and p_to
    union all
    select 'vendor_payment', bp.id, bp.payment_number, bp.payment_date, v.name,
           bp.status::text, bp.amount_minor, bp.journal_entry_id
      from acc_bill_payment bp join acc_vendor v on v.id = bp.vendor_id
     where bp.payment_date between p_from and p_to
    union all
    select 'expense', e.id, e.expense_number, e.expense_date, coalesce(v.name, 'Expense'),
           e.status::text, e.total_minor, e.journal_entry_id
      from acc_expense e left join acc_vendor v on v.id = e.vendor_id
     where e.expense_date between p_from and p_to
    union all
    select 'credit_memo', cm.id, cm.credit_memo_number, cm.memo_date, c.name,
           cm.status::text, cm.total_minor, cm.journal_entry_id
      from acc_credit_memo cm join acc_customer c on c.id = cm.customer_id
     where cm.memo_date between p_from and p_to
    union all
    select 'vendor_credit', vc.id, vc.vendor_credit_number, vc.credit_date, v.name,
           vc.status::text, vc.total_minor, vc.journal_entry_id
      from acc_vendor_credit vc join acc_vendor v on v.id = vc.vendor_id
     where vc.credit_date between p_from and p_to
    union all
    select 'tax_payment', tp.id, tp.payment_number, tp.payment_date, 'Sales tax authority',
           tp.status::text, tp.amount_minor, tp.journal_entry_id
      from acc_tax_payment tp
     where tp.payment_date between p_from and p_to
  )
  select d.source_type, d.document_id, d.document_number, d.document_date,
         d.party_name, d.document_status, d.amount_minor, d.journal_entry_id,
         je.entry_number, je.entry_date, je.status::text,
         coalesce((select sum(jl.debit_minor) from acc_journal_line jl
                    where jl.journal_entry_id = je.id), 0)::bigint
    from documents d (source_type, document_id, document_number, document_date,
                      party_name, document_status, amount_minor, journal_entry_id)
    left join acc_journal_entry je on je.id = d.journal_entry_id
   order by d.document_date desc, d.source_type, d.document_number nulls last;
$$;

-- ----------------------------------------------------------------------------
-- acc_inventory_account_ids (as 0139_stock_count, plus the membership check)
-- ----------------------------------------------------------------------------
create or replace function acc_inventory_account_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select acc_assert_member();
  with by_item_or_role as (
    select i.inventory_account_id as id
      from acc_item i
     where i.is_inventory and i.inventory_account_id is not null
    union
    select a.id from acc_account a where a.cash_flow_role = 'operating_inventory'
  ),
  by_name as (
    select a.id from acc_account a
     where a.account_type = 'current_asset' and a.name ~* 'inventory|stock'
  )
  select id from by_item_or_role
  union
  select id from by_name where not exists (select 1 from by_item_or_role);
$$;

-- ----------------------------------------------------------------------------
-- acc_inventory_policy (as 0078_inventory_policy, plus the membership check)
-- ----------------------------------------------------------------------------
create or replace function acc_inventory_policy()
returns table (method text, memo text, effective_from date)
language sql stable security definer set search_path = public as $$
  select acc_assert_member();
  select v.inventory_valuation_method::text, v.inventory_policy_memo, v.effective_from
    from acc_company_setting_version v
   order by v.version desc
   limit 1;
$$;

-- ----------------------------------------------------------------------------
-- acc_inventory_review (as 0079_inventory_obsolescence, plus the membership check)
-- ----------------------------------------------------------------------------
create or replace function acc_inventory_review(p_as_of date, p_window_days int default 90)
returns table (
  item_id             uuid,
  item_code           text,
  name                text,
  qty_on_hand         numeric,
  value_minor         bigint,
  unit_cost_minor     bigint,
  sales_price_minor   bigint,
  last_movement_on    date,
  last_sale_on        date,
  qty_sold_in_window  numeric,
  written_down_minor  bigint
)
language sql stable security definer set search_path = public as $$
  select acc_assert_member();
  with valuation as (
    select * from acc_inventory_valuation(p_as_of)
  )
  select v.item_id, v.item_code, v.name, v.qty_on_hand, v.value_minor, v.unit_cost_minor,
         i.sales_price_minor,
         (select max(t.txn_date) from acc_inventory_txn t
           where t.item_id = v.item_id and t.txn_date <= p_as_of),
         (select max(t.txn_date) from acc_inventory_txn t
           where t.item_id = v.item_id and t.source = 'sale' and t.txn_date <= p_as_of),
         coalesce((select -sum(t.qty_delta) from acc_inventory_txn t
                    where t.item_id = v.item_id and t.source = 'sale'
                      and t.txn_date <= p_as_of
                      and t.txn_date > p_as_of - p_window_days), 0)::numeric,
         coalesce((select sum(w.amount_minor) from acc_inventory_writedown w
                    where w.item_id = v.item_id and w.written_down_on <= p_as_of), 0)::bigint
    from valuation v
    join acc_item i on i.id = v.item_id
   order by v.value_minor desc;
$$;

-- ----------------------------------------------------------------------------
-- acc_invoice_settlements (as 0077_settlement_entry_reference, plus the membership check)
-- ----------------------------------------------------------------------------
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
  select acc_assert_member();
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

-- ----------------------------------------------------------------------------
-- acc_open_items (as 0071_settlement_history_and_forecast, plus the membership check)
-- ----------------------------------------------------------------------------
create or replace function acc_open_items(p_as_of date default current_date)
returns table (
  side          text,
  document_id   uuid,
  document_number text,
  party_name    text,
  due_date      date,
  balance_minor bigint
)
language sql stable security definer set search_path = public as $$
  select acc_assert_member();
  select 'receivable', i.id, i.invoice_number, c.name,
         coalesce(i.due_date, i.issue_date),
         acc_to_base_minor(i.balance_due_minor, i.currency_code, current_date)::bigint
    from acc_invoice i
    join acc_customer c on c.id = i.customer_id
   where i.status in ('issued', 'partial') and i.balance_due_minor > 0
     and i.issue_date <= coalesce(p_as_of, current_date)
  union all
  select 'payable', b.id, b.bill_number, v.name,
         coalesce(b.due_date, b.bill_date),
         acc_to_base_minor(b.balance_due_minor, b.currency_code, current_date)::bigint
    from acc_bill b
    join acc_vendor v on v.id = b.vendor_id
   where b.status in ('open', 'partial') and b.balance_due_minor > 0
     and b.bill_date <= coalesce(p_as_of, current_date)
  order by 5, 3;
$$;

-- ----------------------------------------------------------------------------
-- acc_payables_priority (as 0075_vendor_payment_terms, plus the membership check)
-- ----------------------------------------------------------------------------
create or replace function acc_payables_priority(p_as_of date)
returns table (
  bill_id               uuid,
  bill_number           text,
  vendor_id             uuid,
  vendor_name           text,
  bill_date             date,
  due_date              date,
  terms_label           text,
  currency_code         text,
  total_minor           bigint,
  balance_due_minor     bigint,
  discount_due_date     date,
  discount_amount_minor bigint,
  discount_taken_minor  bigint,
  status                text
)
language sql stable security definer set search_path = public as $$
  select acc_assert_member();
  select b.id, b.bill_number, b.vendor_id, v.name, b.bill_date, b.due_date,
         b.terms_label, b.currency_code, b.total_minor, b.balance_due_minor,
         b.discount_due_date, b.discount_amount_minor, b.discount_taken_minor,
         b.status::text
    from acc_bill b
    join acc_vendor v on v.id = b.vendor_id
   where b.status in ('open', 'partial')
     and b.balance_due_minor > 0
     and b.bill_date <= p_as_of
   order by b.due_date nulls last, b.bill_number;
$$;

-- ----------------------------------------------------------------------------
-- acc_period_close_blockers (as 0081_cash_flow_indirect, plus the membership check)
-- ----------------------------------------------------------------------------
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
  perform acc_assert_member();
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

-- ----------------------------------------------------------------------------
-- acc_period_close_history (as 0120_close_window_policy, plus the membership check)
-- ----------------------------------------------------------------------------
create or replace function acc_period_close_history(p_limit int default 6)
returns table (
  period_id    uuid,
  period_label text,
  period_end   date,
  closed_at    timestamptz
)
language sql stable security definer set search_path = public as $$
  select acc_assert_member();
  select p.id, p.label, p.period_end, e.closed_at
    from acc_accounting_period p
    join lateral (
      select max(ev.created_at) as closed_at
        from acc_period_event ev
       where ev.period_id = p.id and ev.event = 'close'
    ) e on e.closed_at is not null
   where p.status = 'closed'
   order by p.period_end desc
   limit greatest(coalesce(p_limit, 6), 1);
$$;

-- ----------------------------------------------------------------------------
-- acc_resolve_account_ref (as 0110_inactive_breaks_the_tie, plus the membership check)
-- ----------------------------------------------------------------------------
create or replace function acc_resolve_account_ref(p_ref text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  m record;
begin
  perform acc_assert_member();
  select * into m from acc_account_ref_matches(array[p_ref]) limit 1;
  if not found then return null; end if;

  if m.matched_by = 'ambiguous' then
    raise exception
      'The name "%" belongs to % active accounts (%). Either write the account code in the '
      'file — "%" on its own, or "% - %" — or make the one you do not use inactive in the '
      'chart of accounts.',
      p_ref,
      array_length(m.candidate_codes, 1),
      array_to_string(m.candidate_codes, ', '),
      m.candidate_codes[1],
      m.candidate_codes[1],
      p_ref;
  end if;

  return m.account_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- acc_settlement_lag (as 0071_settlement_history_and_forecast, plus the membership check)
-- ----------------------------------------------------------------------------
create or replace function acc_settlement_lag(p_since date default null)
returns table (
  side         text,
  due_date     date,
  settled_on   date,
  amount_minor bigint
)
language sql stable security definer set search_path = public as $$
  select acc_assert_member();
  with paid_invoices as (
    select i.id, coalesce(i.due_date, i.issue_date) as due_date,
           max(p.payment_date) as settled_on,
           acc_to_base_minor(i.total_minor, i.currency_code, current_date)::bigint as amount_minor
      from acc_invoice i
      join acc_payment_allocation a on a.invoice_id = i.id
      join acc_payment p on p.id = a.payment_id and p.status <> 'void'
     where i.status = 'paid'
     group by i.id, i.due_date, i.issue_date, i.total_minor, i.currency_code
  ),
  paid_bills as (
    select b.id, coalesce(b.due_date, b.bill_date) as due_date,
           max(bp.payment_date) as settled_on,
           acc_to_base_minor(b.total_minor, b.currency_code, current_date)::bigint as amount_minor
      from acc_bill b
      join acc_bill_payment_allocation a on a.bill_id = b.id
      join acc_bill_payment bp on bp.id = a.bill_payment_id and bp.status <> 'void'
     where b.status = 'paid'
     group by b.id, b.due_date, b.bill_date, b.total_minor, b.currency_code
  )
  select 'receivable', due_date, settled_on, amount_minor from paid_invoices
   where p_since is null or settled_on >= p_since
  union all
  select 'payable', due_date, settled_on, amount_minor from paid_bills
   where p_since is null or settled_on >= p_since;
$$;

-- ----------------------------------------------------------------------------
-- acc_stock_count_default_accounts (as 0139_stock_count, plus the membership check)
-- ----------------------------------------------------------------------------
create or replace function acc_stock_count_default_accounts()
returns table (inventory_account_id uuid, offset_account_id uuid)
language plpgsql stable security definer set search_path = public as $$
declare
  v_inventory uuid;
  v_offset    uuid;
begin
  perform acc_assert_member();
  select a.id into v_inventory
    from acc_account a
   where a.id in (select acc_inventory_account_ids())
     and a.is_posting_account and a.status = 'active'
   order by a.account_code, a.id
   limit 1;

  select a.id into v_offset
    from acc_account a
   where a.account_type = 'cost_of_goods_sold' and a.is_posting_account and a.status = 'active'
     and a.name ~* 'inventory\s*adjust'
   order by a.account_code, a.id
   limit 1;
  if v_offset is null then
    v_offset := acc_active_inventory_writedown_account();
  end if;
  if v_offset is null then
    select a.id into v_offset
      from acc_account a
     where a.account_type = 'cost_of_goods_sold' and a.is_posting_account and a.status = 'active'
     order by a.account_code, a.id
     limit 1;
  end if;

  return query select v_inventory, v_offset;
end;
$$;

-- ----------------------------------------------------------------------------
-- acc_transaction_list (as 0164_sales_receipts, plus the membership check)
-- ----------------------------------------------------------------------------
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
  select acc_assert_member();
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
        union all
        select d.journal_entry_id, c.name, 9 from acc_sales_receipt d join acc_customer c on c.id = d.customer_id
         where d.journal_entry_id in (select id from entries)
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

-- ----------------------------------------------------------------------------
-- acc_unresolved_account_refs (as 0107_one_account_resolver, plus the membership check)
-- ----------------------------------------------------------------------------
create or replace function acc_unresolved_account_refs(p_refs text[])
returns text[]
language sql stable security definer set search_path = public as $$
  select acc_assert_member();
  select coalesce(
    array_agg(distinct ref order by ref) filter (where account_id is null),
    array[]::text[])
    from acc_account_ref_matches(p_refs);
$$;
