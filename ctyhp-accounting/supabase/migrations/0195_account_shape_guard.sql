-- ============================================================================
-- 0195  An account with postings keeps its type and its code (3.0.26)
--
-- Item B of the defect report of 11 Nov 2026: an account's name should be
-- editable at any time, and its type and code should not change once it
-- carries postings, because those move balances between statement lines.
--
-- The name and the description could already be changed on any account
-- (acc_save_account, 0170), and the audit trigger on the table (0058) keeps the
-- row before and after, with who changed it. What was missing:
--
--   - the type of an account with postings could be changed, moving its whole
--     balance from one line of the statements to another without a word;
--   - the code was kept only because the save function does not take it; a
--     guard on the table makes that true of every way in.
--
-- acc_account_shape_guard refuses either change on an account any journal
-- line names, posted or void: a void entry still says which account it was.
-- An account nothing has been posted to keeps both open, as before.
--
-- Triggers of one kind fire in the order of their names: this one is named to
-- fire before acc_account_parent_type_trg (0125), so a change refused for both
-- reasons is refused for the one that explains it.
--
-- Additive: one trigger function and one trigger. No row changes.
-- ============================================================================
set search_path = public;

create or replace function acc_account_shape_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if (new.account_type is distinct from old.account_type or new.account_code is distinct from old.account_code)
     and exists (select 1 from acc_journal_line where account_id = old.id) then
    if new.account_code is distinct from old.account_code then
      raise exception '% has postings, so its code stays %. Its name can be changed instead.', old.name, old.account_code;
    end if;
    raise exception '% has postings, so its type stays %: changing it would move its balance to another line of the statements. Create a new account and move the balance with a journal entry instead.',
      old.name, replace(old.account_type::text, '_', ' ');
  end if;
  return new;
end;
$$;

revoke all on function acc_account_shape_guard() from public, anon, authenticated;

drop trigger if exists acc_account_has_postings_guard_trg on acc_account;
create trigger acc_account_has_postings_guard_trg
  before update of account_type, account_code on acc_account
  for each row execute function acc_account_shape_guard();
