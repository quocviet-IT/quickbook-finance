-- New uploads must enter the malware-scan queue. Existing pre-scanner files
-- retain not_configured for backward-compatible access until an admin scans
-- them, but clients can no longer register new metadata with that status.

drop policy acc_document_attachment_insert on acc_document_attachment;
create policy acc_document_attachment_insert on acc_document_attachment
  for insert with check (
    acc_has_permission('documents.manage')
    and uploaded_by = auth.uid()
    and status = 'active'
    and scan_status = 'pending'
    and storage_path like entity_type::text || '/' || entity_id::text || '/%'
    and acc_document_storage_path_allowed(storage_path)
  );
