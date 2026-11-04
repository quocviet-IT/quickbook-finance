-- ============================================================================
-- 0189  A photo of a statement is kept like any other statement file (3.0.5)
--
-- Import statement reads a scanned PDF with the company's OCR server (0188). A
-- phone photo of a statement (JPG or PNG) can be read the same way, but
-- acc_keep_statement_file (0135) refused it: it kept only a PDF, a CSV or a
-- bank download. The file has to be kept first, because the OCR server
-- downloads it from the store.
--
-- The bucket and acc_saved_report already allow image/png and image/jpeg
-- (0101, 0135), so only this function changes. It is the 0135 definition with
-- two differences: the types it keeps also include image/png and image/jpeg,
-- and the refusal names a photo. The signature, the permission check, the
-- folder check, reuse of a file with the same SHA-256, the audit entry and the
-- grants are as they were. Nothing else changes.
-- ============================================================================
set search_path = public;

create or replace function acc_keep_statement_file(
  p_title        text,
  p_period_start date,
  p_period_end   date,
  p_file_name    text,
  p_storage_path text,
  p_mime_type    text,
  p_size_bytes   int,
  p_sha256       text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not acc_has_permission('documents.manage') then
    raise exception 'Not authorized to keep a statement file';
  end if;
  if p_mime_type not in ('application/pdf', 'image/png', 'image/jpeg', 'text/csv', 'text/plain') then
    raise exception 'A statement file is a PDF, a photo (JPG or PNG), a CSV or a bank download';
  end if;

  select id into v_id from acc_saved_report where sha256 = p_sha256 and status = 'active';
  if v_id is not null then
    return jsonb_build_object('id', v_id, 'reused', true);
  end if;
  if not acc_saved_report_path_is_ours(p_storage_path) then
    raise exception 'A statement file must be kept in this company''s own folder';
  end if;

  begin
    insert into acc_saved_report (
      title, source, period_start, period_end, notes,
      file_name, storage_path, mime_type, size_bytes, sha256, uploaded_by
    ) values (
      left(btrim(p_title), 200), 'bank', p_period_start, p_period_end,
      'Kept as the statement OneBook read it from.',
      btrim(p_file_name), p_storage_path, p_mime_type, p_size_bytes, p_sha256, auth.uid()
    )
    returning id into v_id;
  exception when unique_violation then
    -- Another session kept the same file a moment ago.
    select id into v_id from acc_saved_report where sha256 = p_sha256 and status = 'active';
    if v_id is null then raise; end if;
    return jsonb_build_object('id', v_id, 'reused', true);
  end;

  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
  values ('acc_saved_report', v_id, 'keep_statement_file', auth.uid(),
          jsonb_build_object('file_name', btrim(p_file_name), 'sha256', p_sha256));
  return jsonb_build_object('id', v_id, 'reused', false);
end;
$$;

revoke all on function acc_keep_statement_file(text, date, date, text, text, text, int, text) from public, anon;
grant execute on function acc_keep_statement_file(text, date, date, text, text, text, int, text) to authenticated, service_role;
