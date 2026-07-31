-- ============================================================================
-- Recover authorship for documents written before migration 0064.
--
-- Rows created through a path that never set `created_by` show as "system" on
-- screen, which is only honest where nothing knows better. For rows created
-- after the audit triggers of migration 0058, something does: the audit log
-- recorded the actor of the creating statement. This copies that evidence onto
-- the document, and leaves every row the log cannot speak for untouched.
--
-- The stamp trigger is suspended for the copy — it exists to force the stored
-- creation facts back, which is exactly wrong while restoring them. The audit
-- trigger keeps running, so the backfill itself appears in the log as a system
-- update.
-- ============================================================================

do $$
declare
  v_table text;
  v_tables text[] := array[
    'acc_invoice',
    'acc_payment',
    'acc_bill',
    'acc_bill_payment',
    'acc_expense',
    'acc_tax_payment',
    'acc_credit_memo',
    'acc_vendor_credit',
    'acc_customer_refund',
    'acc_write_off',
    'acc_journal_entry',
    'acc_purchase_order',
    'acc_goods_receipt'
  ];
  v_has_updated_at boolean;
begin
  foreach v_table in array v_tables loop
    execute format('alter table %I disable trigger %I', v_table, v_table || '_actor_stamp');

    -- Creation: the earliest logged entry for the record. Documents that post
    -- as they are created are logged as 'post' rather than 'insert'.
    execute format($sql$
      update %I t
         set created_by = a.actor_id
        from (select distinct on (record_id) record_id, actor_id
                from acc_audit_log
               where table_name = %L
                 and action in ('insert', 'post')
                 and actor_id is not null
                 and record_id is not null
               order by record_id, created_at) a
       where a.record_id = t.id
         and t.created_by is null
    $sql$, v_table, v_table);

    -- Last change: only where a logged entry lands on the modification stamp
    -- the row itself carries, so nothing is attributed by proximity alone.
    select exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = v_table and column_name = 'updated_at'
    ) into v_has_updated_at;

    if v_has_updated_at then
      execute format($sql$
        update %I t
           set updated_by = a.actor_id
          from (select distinct on (record_id) record_id, actor_id, created_at
                  from acc_audit_log
                 where table_name = %L
                   and actor_id is not null
                   and record_id is not null
                 order by record_id, created_at desc) a
         where a.record_id = t.id
           and t.updated_by is null
           and abs(extract(epoch from (a.created_at - t.updated_at))) < 2
      $sql$, v_table, v_table);
    end if;

    execute format('alter table %I enable trigger %I', v_table, v_table || '_actor_stamp');
  end loop;
end;
$$;
