-- One row per night a backup was considered, whether or not it produced a file.
--
-- Lives in the company's own schema like acc_import_batch, so row-level
-- security applies without a cross-company function.
create table if not exists acc_backup (
  id uuid primary key default gen_random_uuid(),
  taken_at date not null,
  -- Built from the export manifest's per-file hashes. A ZIP embeds timestamps
  -- and would differ every night whatever the books did.
  content_hash text not null,
  -- Null on a night that was skipped because nothing had changed.
  storage_path text,
  size_bytes bigint,
  schema_version text not null,
  control_totals jsonb not null,
  status text not null check (status in ('stored', 'skipped', 'failed')),
  skip_reason text,
  created_at timestamptz not null default now(),
  -- The same content on the same day is the same snapshot. Two runs in one
  -- night must not leave two rows claiming to be it.
  unique (taken_at, content_hash)
);

alter table acc_backup enable row level security;

-- Re-applying this migration by hand (the SQL Editor path this repository
-- falls back to when the Postgres port is blocked) must not fail on a policy
-- that is already there.
drop policy if exists acc_backup_read on acc_backup;
create policy acc_backup_read on acc_backup
  for select using (acc_has_permission('company.export'));

-- 0080 made every future table unreachable until its own migration says
-- otherwise, and a bare `create table` grants nothing on its own — so without
-- this, every company that already exists gets a register nothing can read.
-- The nightly job and retention both write as service_role (lib/services/
-- backup.ts opens a service-role connection); nothing in the application ever
-- inserts, updates or deletes this table as the signed-in user, only reads
-- it, and the RLS policy above already narrows that read to company.export.
-- So authenticated gets select and nothing more.
revoke all on table acc_backup from public, anon;
grant select on table acc_backup to authenticated;
grant all    on table acc_backup to service_role;

comment on table acc_backup is
  'Nightly snapshots of this company''s books: what was taken, what it hashed to, and where it was put.';

-- Reading a snapshot is the same data by the same means as company.export, so
-- it reuses that. Restoring creates a company and copies an entire book, which
-- is strictly larger, so it gets its own.
insert into acc_permission (key, label, category, description, is_enforced)
values (
  'company.restore',
  'Restore a backup',
  'Governance',
  'Restore a backup into a new company, beside the running books',
  true
)
on conflict (key) do nothing;

-- Every permission migration before this one seeds acc_role_permission for
-- every role — acc_has_permission() reads a missing row as an ordinary
-- "false", so skipping this step would not error, it would ship a permission
-- nobody, not even an administrator, can exercise until somebody finds the
-- matrix and turns it on by hand. Restoring is strictly larger than
-- exporting (it stands up a whole company, not just reads one), so only an
-- administrator starts with it, the same way company.export did.
insert into acc_role_permission (role, permission_key, allowed)
select r.role, 'company.restore', r.role = 'admin'
  from (select unnest(enum_range(null::acc_app_role)) as role) r
 where not exists (
   select 1 from acc_role_permission rp
    where rp.role = r.role and rp.permission_key = 'company.restore'
 );
