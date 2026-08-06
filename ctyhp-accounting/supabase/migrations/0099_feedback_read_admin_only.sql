-- ============================================================================
-- 0099  The feedback test period ends
--
-- 0061 granted feedback.read to every role and said why:
--   "test period: everyone reads" -- so testers could see each other's reports.
--
-- That period is over, and the grant is now an exposure: an accountant or a
-- viewer could read every bug report anyone had filed, the screenshots attached
-- to it, and -- through acc_feedback_queue -- the reporter's email address.
--
-- No policy changes. Every read path already reads "holds feedback.read OR the
-- report is your own": acc_feedback_report, acc_feedback_attachment, and the
-- storage policies over both feedback buckets. Revoking the permission collapses
-- all four to "your own" in one statement, which is the evidence that 0061 built
-- them right and only the grant was provisional.
--
-- acc_feedback_queue is the one that behaves differently, on purpose: it is
-- security definer and filters on the permission alone, so it now returns no
-- rows to a non-administrator rather than their own. The screen stops calling
-- it for them; the function is left as it is.
--
-- Per-company: acc_role_permission lives in each company's schema, so this runs
-- once per set of books through scripts/migrate.mjs. Deliberately no
-- `set search_path` and no `public.` prefix.
-- ============================================================================

update acc_role_permission
   set allowed = false
 where permission_key = 'feedback.read'
   and role <> 'admin';

-- feedback.triage was already admin-only in 0061 and is left alone.
