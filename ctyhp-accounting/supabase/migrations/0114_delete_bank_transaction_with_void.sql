-- ============================================================================
-- 0114  Deleting a bank line, void and all, in one transaction
--
-- RQ-06 of the 2026-08-17 change request asks for a Delete a bookkeeper can
-- use on a duplicate they imported twice, and states the condition plainly:
-- "If deletion fails, the data must remain unchanged."
--
-- The first version shipped could not promise that. Categorising a bank line
-- posts a journal entry (0111), so deleting a categorised line means voiding
-- that entry first — and the server action did it as two separate RPC calls.
-- Two calls are two transactions. When the void succeeded and the delete then
-- refused, the entry stayed voided and the line survived as `unmatched`: data
-- changed by a delete that failed. It was disclosed in the error message
-- rather than hidden, but disclosure is not the acceptance criterion.
--
-- This is the shape `acc_delete_payment` (0106) already uses for the same
-- problem on a customer receipt: one plpgsql function that performs the void
-- and then its own delete, so a refusal anywhere unwinds everything before it.
--
-- What this function deliberately does NOT contain:
--
--   * any authorization check — both functions it calls demand acc_is_staff(),
--     and the delete always runs, so the gate is always crossed exactly once;
--   * any check on the reason — acc_delete_bank_transaction requires ten
--     characters and says so in its own words;
--   * any copy of the void or the delete themselves — both write their own
--     audit row, and a hand-rolled copy here would be a second place the rules
--     live and a second place they can drift.
--
-- It contains exactly one rule of its own, and only because neither function
-- below can state it: see the settlement refusal.
-- ============================================================================

set search_path = public;

create or replace function acc_delete_bank_transaction_with_void(
  p_id     uuid,
  p_reason text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_row acc_bank_transaction;
begin
  -- Held for the rest of the transaction. Inside one transaction the two steps
  -- below can no longer be interleaved with anything, but the lock is what
  -- makes a concurrent categorise or settle wait rather than race the read
  -- that decides which of the two paths this call takes.
  select * into v_row from acc_bank_transaction where id = p_id for update;
  if v_row.id is null then
    raise exception 'Bank transaction not found';
  end if;

  if v_row.status = 'matched' then
    -- The one rule this function owns. A line settled against an invoice or a
    -- bill carries an approved reconciliation pointing at a payment, with no
    -- journal_line_id at all. acc_uncategorise_bank_transaction only knows the
    -- entries it made itself, so it would answer "This line is not
    -- categorised" — which reads as though nothing had ever happened to this
    -- line. Something has, and taking it back is a larger reversal than a
    -- delete: the change request says so, and says not to fold it in here.
    if exists (
      select 1 from acc_reconciliation
       where bank_transaction_id = p_id
         and status = 'approved'
         and journal_line_id is null
    ) then
      raise exception
        'This line was settled against an invoice or bill. Remove that payment first, then delete the line.';
    end if;

    -- Every other refusal is already this function's own message, in its own
    -- words: a transactions-import batch that owns the entry, an entry posted
    -- by something other than categorising, a closed period the void cannot
    -- reach. None of it is repeated or reworded here.
    perform acc_uncategorise_bank_transaction(p_id, p_reason);
  end if;

  -- An `ignored` line, and an `unmatched` one still carrying a suggested
  -- match, are both refused here by name — that is this function's job, not
  -- this one's to anticipate.
  perform acc_delete_bank_transaction(p_id, p_reason);
end;
$$;

revoke all on function acc_delete_bank_transaction_with_void(uuid, text) from public, anon;
grant execute on function acc_delete_bank_transaction_with_void(uuid, text)
  to authenticated, service_role;

comment on function acc_delete_bank_transaction_with_void(uuid, text) is
  'Void the entry a categorised bank line posted, then delete the line, in one '
  'transaction. RQ-06: a delete that fails must leave the books untouched.';
