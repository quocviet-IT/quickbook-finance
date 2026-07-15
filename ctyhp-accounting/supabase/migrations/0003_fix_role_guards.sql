-- ============================================================================
-- Fix: role guard functions returned NULL for a caller with no role, which made
-- `if not acc_is_staff()` skip its branch (NOT NULL = NULL, not TRUE) and let an
-- unauthorized caller through acc_post_entry. Coalesce to FALSE so the guard is
-- fail-closed.
-- ============================================================================

create or replace function acc_is_staff() returns boolean
language sql stable as $$
  select coalesce(acc_current_role() in ('admin', 'accountant'), false);
$$;

create or replace function acc_is_admin() returns boolean
language sql stable as $$
  select coalesce(acc_current_role() = 'admin', false);
$$;
