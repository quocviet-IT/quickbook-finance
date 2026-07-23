-- supabase/migrations/0017_manual_journal.sql
-- ============================================================================
-- Module B — Manual Journal + Opening Balances + GL.
-- Schema only: reversal-link table, source_ref column, opening-balance sequence.
-- No changes to existing ledger tables/triggers; 'manual' and 'opening_balance'
-- already exist in acc_journal_source.
-- ============================================================================

-- Free-text external reference on a manual journal (attachments/approval are
-- owned by later modules; this leaves room without altering the posting path).
alter table acc_journal_entry add column if not exists source_ref text;

-- Links an original posted entry to the entry that reverses it. The original is
-- never mutated or voided; the reversal nets it out from its own entry_date.
create table if not exists acc_journal_reversal_link (
  id                uuid primary key default gen_random_uuid(),
  original_entry_id uuid not null unique references acc_journal_entry (id),
  reversal_entry_id uuid not null unique references acc_journal_entry (id),
  reason            text not null,
  created_by        uuid references auth.users (id),
  created_at        timestamptz not null default now()
);

alter table acc_journal_reversal_link enable row level security;

-- Staff (admin/accountant) may insert; staff + viewer may read. Mirrors the
-- read/write split used by other acc_* tables.
create policy acc_reversal_link_select on acc_journal_reversal_link
  for select using (acc_is_staff() or acc_current_role() = 'viewer');
create policy acc_reversal_link_insert on acc_journal_reversal_link
  for insert with check (acc_is_staff());

-- Sequence for opening-balance entries (manual + reversal reuse 'journal_entry').
insert into acc_sequence (key, prefix, next_value)
  values ('opening_balance', 'OB-', 1)
  on conflict (key) do nothing;
