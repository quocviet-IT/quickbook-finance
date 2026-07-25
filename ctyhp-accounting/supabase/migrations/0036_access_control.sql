-- ============================================================================
-- Module C — Users, permissions, maker-checker approval, audit history (schema).
--
-- Two deliberate choices about defaults:
--   * the role -> permission matrix is seeded to reproduce today's behaviour
--     exactly, and
--   * every approval policy is seeded DISABLED,
-- so deploying this module changes nobody's access until an admin decides to
-- change it.
--
-- Enums are created here and first used by the functions in 0037.
-- ============================================================================

create type acc_user_status     as enum ('invited', 'active', 'suspended', 'offboarded');
create type acc_approval_status as enum ('pending', 'approved', 'rejected', 'cancelled');

-- ----------------------------------------------------------------------------
-- User lifecycle. acc_current_role() (redefined in 0037) returns a role only
-- for 'invited' or 'active', so suspending a user revokes read and write
-- everywhere at once — every RLS policy already derives from that function.
-- ----------------------------------------------------------------------------
alter table acc_app_user add column status            acc_user_status not null default 'active';
alter table acc_app_user add column invited_at        timestamptz;
alter table acc_app_user add column status_changed_at timestamptz;
alter table acc_app_user add column status_reason     text;

-- ----------------------------------------------------------------------------
-- Permission catalog and the role matrix.
-- ----------------------------------------------------------------------------
create table acc_permission (
  key         text primary key,
  label       text not null,
  category    text not null,
  description text not null default '',
  /** False while the underlying RPC still gates on the coarse role check. */
  is_enforced boolean not null default false
);

create table acc_role_permission (
  role           acc_app_role not null,
  permission_key text not null references acc_permission (key) on delete cascade,
  allowed        boolean not null default false,
  updated_by     uuid references auth.users (id),
  updated_at     timestamptz not null default now(),
  primary key (role, permission_key)
);

insert into acc_permission (key, label, category, description, is_enforced) values
  ('journal.post',              'Post manual journals',        'Accounting', 'Create and post manual journal entries', true),
  ('journal.void',              'Void journal entries',        'Accounting', 'Void or reverse a posted entry', false),
  ('bill.post',                 'Post bills',                 'Purchases',  'Post a vendor bill to Accounts Payable', false),
  ('bill.void',                 'Void bills',                 'Purchases',  'Void a posted vendor bill', false),
  ('invoice.issue',             'Issue invoices',             'Sales',      'Issue a draft invoice to a customer', false),
  ('invoice.void',              'Void invoices',              'Sales',      'Void an issued invoice', false),
  ('period.close',              'Close accounting periods',   'Close',      'Close a monthly accounting period', false),
  ('period.reopen',             'Reopen accounting periods',  'Close',      'Reopen a closed accounting period', true),
  ('reconciliation.complete',   'Complete reconciliations',   'Banking',    'Complete a bank reconciliation', false),
  ('reconciliation.reopen',     'Reopen reconciliations',     'Banking',    'Reopen a completed reconciliation', true),
  ('writeoff.create',           'Write off balances',         'Receivables','Write off an invoice or bill balance', true),
  ('inventory.adjust',          'Adjust inventory',           'Inventory',  'Post an inventory quantity or value adjustment', true),
  ('po.approve',                'Approve purchase orders',    'Purchases',  'Move a purchase order from draft to open', false),
  ('po.variance_approve',       'Approve match variances',    'Purchases',  'Approve a three-way matching variance', false),
  ('approval.decide',           'Approve or reject requests', 'Governance', 'Decide on a maker-checker approval request', true),
  ('users.manage',              'Manage users',               'Governance', 'Invite users, change roles, suspend, offboard', true),
  ('permissions.manage',        'Manage permissions',         'Governance', 'Change the role to permission matrix', true),
  ('settings.manage',           'Manage settings',            'Governance', 'Company settings, tolerances, approval policies', true),
  ('audit.read',                'Read the audit log',         'Governance', 'Search audit history', true);

-- Seeded to reproduce current behaviour: admin everything; accountant every
-- operational action but no governance and no reopen; viewer read-only.
insert into acc_role_permission (role, permission_key, allowed)
select 'admin'::acc_app_role, key, true from acc_permission;

insert into acc_role_permission (role, permission_key, allowed)
select 'accountant'::acc_app_role, key,
       key not in ('users.manage', 'permissions.manage', 'settings.manage',
                   'period.reopen', 'reconciliation.reopen')
  from acc_permission;

insert into acc_role_permission (role, permission_key, allowed)
select 'viewer'::acc_app_role, key, key = 'audit.read' from acc_permission;

-- ----------------------------------------------------------------------------
-- Maker-checker policies, seeded disabled, and the request queue.
-- ----------------------------------------------------------------------------
create table acc_approval_policy (
  action_key          text primary key,
  label               text not null,
  description         text not null default '',
  enabled             boolean not null default false,
  threshold_minor     bigint not null default 0 check (threshold_minor >= 0),
  require_segregation boolean not null default true,
  updated_by          uuid references auth.users (id),
  updated_at          timestamptz not null default now()
);

insert into acc_approval_policy (action_key, label, description) values
  ('manual_journal',        'Manual journal entry',   'Posting a manual journal entry'),
  ('write_off',             'Balance write-off',      'Writing off an invoice or bill balance'),
  ('inventory_adjustment',  'Inventory adjustment',   'Adjusting inventory quantity or value'),
  ('period_reopen',         'Accounting period reopen', 'Reopening a closed accounting period'),
  ('reconciliation_reopen', 'Reconciliation reopen',  'Reopening a completed bank reconciliation');

create table acc_approval_request (
  id             uuid primary key default gen_random_uuid(),
  action_key     text not null references acc_approval_policy (action_key),
  title          text not null,
  amount_minor   bigint not null default 0,
  /** The intended call: acc_approve_request dispatches this payload. */
  payload        jsonb not null,
  reason         text not null,
  status         acc_approval_status not null default 'pending',
  requested_by   uuid references auth.users (id),
  requested_at   timestamptz not null default now(),
  decided_by     uuid references auth.users (id),
  decided_at     timestamptz,
  decision_note  text,
  result_id      uuid,
  error_message  text
);
create index acc_approval_request_status_idx on acc_approval_request (status, requested_at desc);
create index acc_approval_request_actor_idx  on acc_approval_request (requested_by);

-- ----------------------------------------------------------------------------
-- RLS. The catalog and policies are readable by any role so the UI can explain
-- itself; only an admin writes them. The request queue is readable by any role
-- (an auditor must see it) and has NO client write policy — every mutation goes
-- through the SECURITY DEFINER functions in 0037.
-- ----------------------------------------------------------------------------
alter table acc_permission        enable row level security;
alter table acc_role_permission   enable row level security;
alter table acc_approval_policy   enable row level security;
alter table acc_approval_request  enable row level security;

create policy acc_permission_read  on acc_permission for select using (acc_current_role() is not null);
create policy acc_permission_write on acc_permission for all using (acc_is_admin()) with check (acc_is_admin());

create policy acc_role_permission_read  on acc_role_permission for select using (acc_current_role() is not null);
create policy acc_role_permission_write on acc_role_permission for all using (acc_is_admin()) with check (acc_is_admin());

create policy acc_approval_policy_read  on acc_approval_policy for select using (acc_current_role() is not null);
create policy acc_approval_policy_write on acc_approval_policy for all using (acc_is_admin()) with check (acc_is_admin());

create policy acc_approval_request_read on acc_approval_request for select using (acc_current_role() is not null);
