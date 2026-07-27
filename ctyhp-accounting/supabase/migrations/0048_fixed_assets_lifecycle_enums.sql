-- PostgreSQL requires new enum values to commit before later migrations use
-- them in constraints or functions.
alter type acc_depreciation_schedule_status add value if not exists 'opening';
alter type acc_depreciation_schedule_status add value if not exists 'cancelled';
