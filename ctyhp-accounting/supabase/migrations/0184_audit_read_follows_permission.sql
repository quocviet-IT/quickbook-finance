-- ============================================================================
-- 0184  The audit log is read by whoever holds Read the audit log (2.95)
--
-- Every screen that shows audit history already asks for audit.read: the
-- change log, voided entries, the dashboard's recent changes and the history
-- on invoices and payments all read through acc_audit_search, which checks
-- it. The table's own read policy, from 0001, did
-- not: it let any member of the company select acc_audit_log straight through
-- the API. Switching audit.read off for a role therefore hid the screens and
-- left the rows readable, and the Sales role, which never holds audit.read,
-- could read every before-and-after snapshot in the company.
--
-- Checked before this was written:
--   * the screens read through acc_audit_search, which runs as its owner and
--     checks audit.read itself; the nightly backup and the restore run as the
--     service role;
--   * the one session read is the company export (Settings > Company), which
--     copies every table as the person exporting. An administrator holds
--     audit.read; anyone else granted company.export without it now gets the
--     archive with the audit history left out, as the matrix says;
--   * every function that writes the table runs as its owner (0167), so
--     writing an audit row does not depend on this policy.
-- ============================================================================
set search_path = public;

drop policy if exists acc_audit_read on acc_audit_log;
create policy acc_audit_read on acc_audit_log
  for select using ((select acc_has_permission('audit.read')));

notify pgrst, 'reload schema';
