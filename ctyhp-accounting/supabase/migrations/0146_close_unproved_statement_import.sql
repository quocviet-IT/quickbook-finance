-- 0146: close the way round the statement proof.
--
-- Since 2.04 every statement is imported through acc_import_bank_statement_proved
-- (0143), which proves the statement adds up and only then calls the older
-- acc_import_bank_statement (0058) to write the lines. The older function is
-- still granted to every signed-in user, so a request sent straight to it puts
-- a statement in with no proof at all. Nothing in the app calls it directly.
--
-- Revoking it from the roles a person signs in with closes that. The proved
-- function is SECURITY DEFINER and runs as the owner, so it keeps calling the
-- older one; the owner's own grant is untouched. Additive and idempotent.

set search_path = public;

revoke all on function acc_import_bank_statement(uuid, text, jsonb) from public, anon, authenticated;
