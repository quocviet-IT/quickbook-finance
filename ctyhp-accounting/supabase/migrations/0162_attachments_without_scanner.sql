-- ============================================================================
-- 0162  Attachments without a malware scanner (2.52)
--
-- Supporting documents waited on a malware scanner (ClamAV, 0056/0057) that was
-- never deployed: a new upload had to enter as `pending`, nothing ever moved it
-- on, and the app refused every upload while the scanner was not configured.
-- No attachment was ever stored. The scanner is now dropped from the design:
--
--   * a new upload enters as `not_configured` ("not scanned"), the status the
--     storage policy (0122), acc_log_document_access (0056) and the app have
--     always let through, alongside `clean`;
--   * the three scan functions go, with nothing left to call them.
--
-- What protects the files is unchanged: the type allowlist and the 10 MB limit
-- (in the table's checks and the bucket), the private bucket, sixty-second
-- signed links, downloads served as attachments, the documents.read and
-- documents.manage permissions, and the access log. The scan columns and the
-- enum stay: `blocked` still refuses access, should a row ever carry it.
-- ============================================================================
set search_path = public;

drop policy if exists acc_document_attachment_insert on acc_document_attachment;
create policy acc_document_attachment_insert on acc_document_attachment
  for insert with check (
    acc_has_permission('documents.manage')
    and uploaded_by = auth.uid()
    and status = 'active'
    and scan_status = 'not_configured'
    and storage_path like entity_type::text || '/' || entity_id::text || '/%'
    and acc_document_storage_path_allowed(storage_path)
  );

drop function if exists acc_queue_document_scan(uuid);
drop function if exists acc_begin_document_scan(uuid);
drop function if exists acc_complete_document_scan(uuid, acc_document_scan_status, text, text, text);
