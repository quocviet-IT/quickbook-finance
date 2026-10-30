-- A depreciation method for declining balance (2.85).
--
-- The value lands alone in this migration on purpose. Postgres refuses to use a
-- value added by ALTER TYPE ... ADD VALUE later in the same transaction, and
-- scripts/migrate.mjs wraps every migration in begin/commit. The check that
-- names it and the schedule that uses it wait for 0182.
--
-- Nothing else changes here.
alter type acc_fixed_asset_method add value if not exists 'declining_balance';
