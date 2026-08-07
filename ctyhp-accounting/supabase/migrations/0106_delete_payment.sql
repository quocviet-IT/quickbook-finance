-- ============================================================================
-- 0106  Deleting a customer payment
--
-- Asked for on /payments, 2026-08-06: "please add option to delete, void is
-- different, payment details will be there if you void, but delete it is
-- different, like this do we still need demos?"
--
-- The reporter is right that void and delete are different things, and they
-- want the second: the record gone from the list, not merely marked void.
--
-- What this does NOT do is skip a single accounting rule. Deleting runs the
-- void first — the same acc_void_payment the button calls — so a refund taken
-- out of the receipt, a bank line matched to it, a statement reconciliation
-- holding it, or a closed period all refuse here exactly as they refuse there,
-- and the invoices get their balances back before anything is removed.
--
-- Two things survive the delete, and they are what make it safe rather than
-- merely convenient:
--
--   * the audit trigger on acc_payment keeps the whole row in before_json, so
--     what was deleted, by whom and when is still answerable;
--   * the receipt number it frees is written to acc_number_gap_note, so the
--     document-number integrity report still adds up instead of reporting an
--     unexplained gap.
--
-- Administrators only. Removing a record is not ordinary bookkeeping.
-- ============================================================================

set search_path = public;

create or replace function acc_delete_payment(
  p_payment_id uuid,
  p_reason     text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_payment  acc_payment;
  v_reason   text := btrim(coalesce(p_reason, ''));
  v_entry    uuid;
  v_number   bigint;
  v_blocked  int;
begin
  if not acc_is_admin() then
    raise exception 'Only an administrator can delete a payment';
  end if;
  -- The gap note demands at least ten characters, and it is the same reason.
  -- Refusing here says so plainly instead of failing on a check constraint.
  if length(v_reason) < 10 then
    raise exception 'Say why this payment is being deleted, in at least 10 characters';
  end if;
  if length(v_reason) > 500 then
    raise exception 'A delete reason cannot exceed 500 characters';
  end if;

  select * into v_payment from acc_payment where id = p_payment_id for update;
  if not found then raise exception 'Payment not found'; end if;

  -- Void first when it is still live. Every rule about whether this receipt may
  -- be undone lives in that function; none of them is repeated here.
  if v_payment.status <> 'void' then
    perform acc_void_payment(p_payment_id, v_reason);
    select * into v_payment from acc_payment where id = p_payment_id;
  end if;

  v_entry := v_payment.journal_entry_id;

  -- A reconciliation of any status still points at these lines by foreign key.
  -- The void refuses a live match; a rejected one would only surface here as a
  -- constraint error, which says nothing useful to the person who clicked.
  if v_entry is not null then
    select count(*) into v_blocked
      from acc_reconciliation r
      left join acc_journal_line jl on jl.id = r.journal_line_id
     where r.payment_id = p_payment_id or jl.journal_entry_id = v_entry;
    if v_blocked > 0 then
      raise exception
        'This payment is still referenced by % bank match(es). Remove them before deleting it.',
        v_blocked;
    end if;
  end if;

  -- Account for the number before the row that holds it goes.
  if v_payment.payment_number is not null then
    v_number := nullif(regexp_replace(v_payment.payment_number, '\D', '', 'g'), '')::bigint;
    if v_number is not null then
      insert into acc_number_gap_note (sequence_key, number_value, reason, noted_by)
      values ('payment', v_number,
              'Payment ' || v_payment.payment_number || ' deleted: ' || v_reason,
              auth.uid())
      on conflict (sequence_key, number_value) do nothing;
    end if;
  end if;

  delete from acc_payment_allocation where payment_id = p_payment_id;
  delete from acc_payment where id = p_payment_id;

  -- The void entry contributed nothing to any report; without its payment it
  -- would be an entry nobody can explain.
  if v_entry is not null then
    delete from acc_journal_line where journal_entry_id = v_entry;
    delete from acc_journal_entry where id = v_entry;
  end if;

  return jsonb_build_object(
    'payment_number', v_payment.payment_number,
    'amount_minor', v_payment.amount_minor,
    'number_noted', v_number is not null
  );
end;
$$;

revoke all on function acc_delete_payment(uuid, text) from public, anon;
grant execute on function acc_delete_payment(uuid, text) to authenticated, service_role;
