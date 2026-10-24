-- A journal source for the entry a sales receipt posts (2.53).
--
-- The value lands alone in this migration on purpose. Postgres refuses to use a
-- value added by ALTER TYPE ... ADD VALUE later in the same transaction, and
-- scripts/migrate.mjs wraps every migration in begin/commit. Everything that
-- posts with 'sales_receipt' waits for 0164.
--
-- Nothing else changes here.
alter type acc_journal_source add value if not exists 'sales_receipt';
