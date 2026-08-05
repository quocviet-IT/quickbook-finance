-- ============================================================================
-- 0096  Edit a receipt's description, or correct the receipt itself
--
-- Voiding (0095) answers "this payment should not exist". It does not answer
-- the two smaller questions people actually ask more often: the check number
-- was typed wrong, or the whole receipt was right except the amount.
--
-- The first is not an accounting event at all, so it gets a function that can
-- only reach three columns. The second is two accounting events that must
-- never come apart, so it gets one function that does both.
-- ============================================================================

set search_path = public;

-- --- Description only --------------------------------------------------------
create or replace function acc_update_payment_details(
  p_payment_id uuid,
  p_method text,
  p_reference text,
  p_memo text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_payment acc_payment;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to edit customer payments';
  end if;

  select * into v_payment from acc_payment where id = p_payment_id for update;
  if not found then raise exception 'Payment not found'; end if;
  -- A void receipt is a record of what happened, not a live document.
  if v_payment.status = 'void' then
    raise exception 'A void payment cannot be edited; record a replacement instead';
  end if;

  if length(btrim(coalesce(p_method, ''))) > 60 then
    raise exception 'Method cannot exceed 60 characters';
  end if;
  if length(btrim(coalesce(p_reference, ''))) > 80 then
    raise exception 'Reference cannot exceed 80 characters';
  end if;
  if length(btrim(coalesce(p_memo, ''))) > 500 then
    raise exception 'Memo cannot exceed 500 characters';
  end if;

  -- Three columns, named one by one: this function is the whitelist, so no
  -- caller reaches an amount or a date through it. acc_stamp_actor owns
  -- updated_at/updated_by, and acc_payment_atomic_audit records the change.
  update acc_payment
     set method = nullif(btrim(coalesce(p_method, '')), ''),
         reference = nullif(btrim(coalesce(p_reference, '')), ''),
         memo = nullif(btrim(coalesce(p_memo, '')), '')
   where id = p_payment_id;
end;
$$;

revoke all on function acc_update_payment_details(uuid, text, text, text) from public;
grant execute on function acc_update_payment_details(uuid, text, text, text)
  to authenticated, service_role;

-- --- Correction: one transaction, both halves --------------------------------
create or replace function acc_correct_payment(
  p_payment_id         uuid,
  p_reason             text,
  p_customer_id        uuid,
  p_payment_date       date,
  p_currency           text,
  p_amount_minor       bigint,
  p_deposit_account_id uuid,
  p_method             text,
  p_reference          text,
  p_memo               text,
  p_allocations        jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_new uuid;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to correct customer payments';
  end if;

  -- Every guard the void already owns applies here: an outstanding refund, a
  -- live bank match, a cleared statement line or a closed period refuses, and
  -- the new receipt below is rolled back with it. There is no state in which
  -- the customer's receipt is void and nothing has replaced it.
  perform acc_void_payment(p_payment_id, p_reason);

  v_new := acc_record_payment(
    p_customer_id,
    p_payment_date,
    p_currency,
    p_amount_minor,
    p_deposit_account_id,
    p_method,
    p_memo,
    p_allocations,
    p_reference
  );
  return v_new;
end;
$$;

revoke all on function acc_correct_payment(uuid, text, uuid, date, text, bigint, uuid, text, text, text, jsonb) from public;
grant execute on function acc_correct_payment(uuid, text, uuid, date, text, bigint, uuid, text, text, text, jsonb)
  to authenticated, service_role;
