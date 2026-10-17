-- A journal source for the entry a cash count posts.
--
-- The value lands alone in this migration on purpose. Postgres refuses to use a
-- value added by ALTER TYPE ... ADD VALUE later in the same transaction, and
-- scripts/migrate.mjs wraps every migration in begin/commit. Everything that
-- posts with 'cash_count' waits for 0154.
--
-- Nothing else changes here.
alter type acc_journal_source add value if not exists 'cash_count';
