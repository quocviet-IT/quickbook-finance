"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  App,
  Button,
  DatePicker,
  Drawer,
  Empty,
  Input,
  List,
  Modal,
  Select,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
  Upload,
  type UploadFile,
  type UploadProps,
} from "antd";
import {
  CloudUploadOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EyeOutlined,
  FileExcelOutlined,
  FileImageOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  LockOutlined,
  PaperClipOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { createSupabaseBrowserClient } from "@/lib/db/client";
import type { DocumentAttachmentRow } from "@/lib/db/types";
import {
  DOCUMENT_ACCEPT,
  DOCUMENT_BUCKET,
  DOCUMENT_KIND_OPTIONS,
  defaultDocumentKind,
  documentCanBeAccessed,
  formatDocumentFileSize,
  validateDocumentFile,
  type DocumentEntityType,
  type DocumentKind,
} from "@/lib/domain/documents";
import {
  calculateFileSha256,
  createDocumentStoragePath,
} from "@/lib/client/documents";
import {
  archiveDocumentAttachmentAction,
  createDocumentAccessUrlAction,
  listDocumentAttachmentsAction,
  registerDocumentAttachmentAction,
  rescanDocumentAttachmentAction,
  updateDocumentGovernanceAction,
} from "@/app/(app)/documents/actions";

export interface AttachmentTarget {
  entityType: DocumentEntityType;
  entityId: string;
  label: string;
}

export default function AttachmentDrawer({
  target,
  canManage,
  canGovern,
  scannerConfigured,
  onClose,
}: {
  target: AttachmentTarget | null;
  canManage: boolean;
  canGovern: boolean;
  scannerConfigured: boolean;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const [attachmentState, setAttachmentState] = useState<{
    targetKey: string;
    data: DocumentAttachmentRow[];
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [documentKind, setDocumentKind] = useState<DocumentKind | null>(null);
  const [description, setDescription] = useState("");
  const [archiveTarget, setArchiveTarget] = useState<DocumentAttachmentRow | null>(null);
  const [archiveReason, setArchiveReason] = useState("");
  const [archiving, setArchiving] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [scanningId, setScanningId] = useState<string | null>(null);
  const [governanceTarget, setGovernanceTarget] =
    useState<DocumentAttachmentRow | null>(null);
  const [retentionUntil, setRetentionUntil] = useState<Dayjs | null>(null);
  const [legalHold, setLegalHold] = useState(false);
  const [governanceReason, setGovernanceReason] = useState("");
  const [savingGovernance, setSavingGovernance] = useState(false);
  const targetEntityType = target?.entityType;
  const targetEntityId = target?.entityId;

  const refresh = useCallback(async () => {
    if (!target) return;
    const targetKey = `${target.entityType}:${target.entityId}`;
    const result = await listDocumentAttachmentsAction({
      entity_type: target.entityType,
      entity_id: target.entityId,
    });
    if (result.ok) setAttachmentState({ targetKey, data: result.data ?? [] });
    else message.error(result.error ?? "Could not load attachments.");
  }, [message, target]);

  useEffect(() => {
    if (!targetEntityType || !targetEntityId) return;
    let cancelled = false;
    const loadedTargetKey = `${targetEntityType}:${targetEntityId}`;
    void listDocumentAttachmentsAction({
      entity_type: targetEntityType,
      entity_id: targetEntityId,
    }).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setAttachmentState({ targetKey: loadedTargetKey, data: result.data ?? [] });
      } else {
        message.error(result.error ?? "Could not load attachments.");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [message, targetEntityId, targetEntityType]);

  const targetKey = target ? `${target.entityType}:${target.entityId}` : null;
  const attachments =
    attachmentState?.targetKey === targetKey ? attachmentState.data : [];
  const activeDocumentKind =
    documentKind ?? (target ? defaultDocumentKind(target.entityType) : "other");
  const selectedFile = fileList[0]?.originFileObj;
  const uploadHint = useMemo(
    () => "PDF, JPG, PNG, WebP, CSV, XLSX, or DOCX · maximum 10 MB",
    [],
  );

  const beforeUpload: UploadProps["beforeUpload"] = (file) => {
    const validationError = validateDocumentFile(file);
    if (validationError) {
      message.error(validationError);
      return Upload.LIST_IGNORE;
    }
    setFileList([
      {
        uid: file.uid,
        name: file.name,
        size: file.size,
        type: file.type,
        status: "done",
        originFileObj: file,
      },
    ]);
    return false;
  };

  async function uploadAttachment() {
    if (!target || !selectedFile) {
      message.warning("Choose a file before uploading.");
      return;
    }
    const validationError = validateDocumentFile(selectedFile);
    if (validationError) {
      message.error(validationError);
      return;
    }

    setUploading(true);
    const sb = createSupabaseBrowserClient();
    const storagePath = createDocumentStoragePath(
      target.entityType,
      target.entityId,
      selectedFile.type,
    );
    try {
      const sha256 = await calculateFileSha256(selectedFile);
      const { error: uploadError } = await sb.storage
        .from(DOCUMENT_BUCKET)
        .upload(storagePath, selectedFile, {
          cacheControl: "3600",
          contentType: selectedFile.type,
          upsert: false,
        });
      if (uploadError) throw new Error(uploadError.message);

      const result = await registerDocumentAttachmentAction({
        entity_type: target.entityType,
        entity_id: target.entityId,
        document_kind: activeDocumentKind,
        file_name: selectedFile.name,
        storage_path: storagePath,
        mime_type: selectedFile.type,
        size_bytes: selectedFile.size,
        sha256,
        description: description.trim() || null,
      });
      if (!result.ok) {
        await sb.storage.from(DOCUMENT_BUCKET).remove([storagePath]);
        throw new Error(result.error ?? "Could not register the uploaded file.");
      }

      const scanStatus = result.data?.scan_status;
      message.success(
        scanStatus === "clean"
          ? "Attachment uploaded and passed security scanning."
          : scanStatus === "blocked"
            ? "Attachment uploaded but quarantined by security scanning."
            : "Attachment uploaded.",
      );
      setFileList([]);
      setDescription("");
      await refresh();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Attachment upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function accessAttachment(
    attachment: DocumentAttachmentRow,
    action: "preview" | "download",
  ) {
    const previewWindow = action === "preview" ? window.open("about:blank", "_blank") : null;
    if (previewWindow) previewWindow.opener = null;
    setOpeningId(attachment.id);
    const result = await createDocumentAccessUrlAction({
      attachment_id: attachment.id,
      action,
    });
    setOpeningId(null);
    if (!result.ok || !result.data) {
      previewWindow?.close();
      message.error(result.error ?? "Could not open the attachment.");
      return;
    }

    if (action === "preview") {
      if (previewWindow) previewWindow.location.replace(result.data.url);
      else message.warning("Allow pop-ups to preview this attachment.");
      return;
    }
    const anchor = document.createElement("a");
    anchor.href = result.data.url;
    anchor.download = attachment.file_name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  async function archiveAttachment() {
    if (!archiveTarget || archiveReason.trim().length < 3) {
      message.warning("Enter a short reason for archiving this attachment.");
      return;
    }
    setArchiving(true);
    const result = await archiveDocumentAttachmentAction({
      attachment_id: archiveTarget.id,
      reason: archiveReason,
    });
    setArchiving(false);
    if (!result.ok) {
      message.error(result.error ?? "Could not archive the attachment.");
      return;
    }
    message.success("Attachment archived. The stored evidence was retained.");
    setArchiveTarget(null);
    setArchiveReason("");
    await refresh();
  }

  async function rescanAttachment(attachment: DocumentAttachmentRow) {
    setScanningId(attachment.id);
    const result = await rescanDocumentAttachmentAction({
      attachment_id: attachment.id,
    });
    setScanningId(null);
    if (!result.ok) {
      message.error(result.error ?? "Could not scan the attachment.");
      return;
    }
    if (result.data?.scan_status === "clean") {
      message.success("Attachment passed security scanning.");
    } else if (result.data?.scan_status === "blocked") {
      message.error("Attachment was quarantined by security scanning.");
    } else {
      message.warning("The scanner could not verify this attachment.");
    }
    await refresh();
  }

  function openGovernance(attachment: DocumentAttachmentRow) {
    setGovernanceTarget(attachment);
    setRetentionUntil(
      attachment.retention_until ? dayjs(attachment.retention_until) : null,
    );
    setLegalHold(attachment.legal_hold);
    setGovernanceReason("");
  }

  async function saveGovernance() {
    if (!governanceTarget || governanceReason.trim().length < 3) {
      message.warning("Enter a short reason for this governance change.");
      return;
    }
    setSavingGovernance(true);
    const result = await updateDocumentGovernanceAction({
      attachment_id: governanceTarget.id,
      retention_until: retentionUntil?.format("YYYY-MM-DD") ?? null,
      legal_hold: legalHold,
      reason: governanceReason,
    });
    setSavingGovernance(false);
    if (!result.ok) {
      message.error(result.error ?? "Could not update document governance.");
      return;
    }
    message.success("Retention and legal-hold controls updated.");
    setGovernanceTarget(null);
    setGovernanceReason("");
    await refresh();
  }

  function closeDrawer() {
    setAttachmentState(null);
    setFileList([]);
    setDescription("");
    setDocumentKind(null);
    setArchiveTarget(null);
    setArchiveReason("");
    setGovernanceTarget(null);
    setGovernanceReason("");
    onClose();
  }

  return (
    <>
      <Drawer
        open={Boolean(target)}
        onClose={closeDrawer}
        width={600}
        destroyOnHidden
        /*
         * The record's label belongs under the heading, not opposite it.
         *
         * It used to be this drawer's `extra`, and a bank line whose
         * description is a 240-character wire message broke the header
         * outright — reported with a screenshot reading "Documents", then the
         * wire text, then "&", then "Attachments", the heading in pieces with
         * the label printed across it. Ant Design styles `.ant-drawer-extra`
         * as `flex: none` and `.ant-drawer-header-title` as `flex: 1;
         * min-width: 0`, so inside a 600px drawer the label took all 1,729px
         * it asked for and the heading was left with none.
         *
         * Under the heading it has the drawer's full width: one line, cut
         * with an ellipsis, whole text on hover.
         *
         * `styles.title` is load-bearing and has to be on that element, not
         * on anything inside it. `.ant-drawer-title` is a flex item that
         * Ant Design gives `flex: 1` and no `min-width`, so it inherits
         * `min-width: auto` — the min-content width of its contents. A
         * `white-space: nowrap` label makes that the label's full length, so
         * the element refuses to shrink and the ellipsis inside it never has
         * anything to clip against. Measured with the override one level too
         * deep: the heading recovered to 552px but `.ant-drawer-title` still
         * measured 1,605px and the header still overflowed by 1,061px.
         */
        styles={{ title: { minWidth: 0 } }}
        title={
          <div>
            <Space>
              <PaperClipOutlined />
              <span>Documents & Attachments</span>
            </Space>
            {target ? (
              <Tooltip title={target.label} placement="bottomLeft" styles={{ root: { maxWidth: 640 } }}>
                <Typography.Text
                  type="secondary"
                  ellipsis
                  style={{ display: "block", fontSize: 13, fontWeight: 400, lineHeight: 1.5 }}
                >
                  {target.label}
                </Typography.Text>
              </Tooltip>
            ) : null}
          </div>
        }
        className="document-attachment-drawer"
      >
        <Alert
          type={scannerConfigured ? "success" : "warning"}
          showIcon
          message="Private accounting evidence"
          description={
            scannerConfigured
              ? "New files are scanned before access. Pending, failed, and unsafe files remain quarantined; every preview and download is logged."
              : "Files are private and access is logged. Configure the malware scanner to quarantine unsafe uploads automatically."
          }
        />

        {canManage ? (
          <section className="document-upload-panel" aria-labelledby="document-upload-title">
            <Typography.Title level={5} id="document-upload-title">
              Add supporting evidence
            </Typography.Title>
            <Upload.Dragger
              accept={DOCUMENT_ACCEPT}
              beforeUpload={beforeUpload}
              fileList={fileList}
              maxCount={1}
              multiple={false}
              onRemove={() => {
                setFileList([]);
                return true;
              }}
              disabled={uploading || !scannerConfigured}
            >
              <p className="ant-upload-drag-icon">
                <CloudUploadOutlined />
              </p>
              <p className="ant-upload-text">Choose or drag a file here</p>
              <p className="ant-upload-hint">{uploadHint}</p>
            </Upload.Dragger>
            <div className="document-upload-fields">
              <label>
                <span>Document type</span>
                <Select
                  value={activeDocumentKind}
                  onChange={setDocumentKind}
                  options={DOCUMENT_KIND_OPTIONS}
                  aria-label="Document type"
                />
              </label>
              <label>
                <span>Description (optional)</span>
                <Input
                  value={description}
                  maxLength={500}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="What this file supports"
                />
              </label>
            </div>
            <Button
              type="primary"
              icon={<CloudUploadOutlined />}
              loading={uploading}
              disabled={!selectedFile || !scannerConfigured}
              onClick={uploadAttachment}
            >
              Upload attachment
            </Button>
          </section>
        ) : null}

        <section className="document-list-section" aria-labelledby="document-list-title">
          <div className="document-list-heading">
            <Typography.Title level={5} id="document-list-title">
              Attached files
            </Typography.Title>
            <Typography.Text type="secondary">{attachments.length} files</Typography.Text>
          </div>
          <List
            loading={Boolean(targetKey) && attachmentState?.targetKey !== targetKey}
            dataSource={attachments}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="No supporting documents attached yet"
                />
              ),
            }}
            renderItem={(attachment) => {
              const previewable =
                attachment.mime_type === "application/pdf" ||
                attachment.mime_type.startsWith("image/");
              const accessible = documentCanBeAccessed(attachment.scan_status);
              const retained =
                Boolean(attachment.retention_until) &&
                attachment.retention_until! > new Date().toISOString().slice(0, 10);
              return (
                <List.Item
                  className="document-list-item"
                  actions={[
                    previewable ? (
                      <Button
                        key="preview"
                        type="text"
                        icon={<EyeOutlined />}
                        aria-label={`Preview ${attachment.file_name}`}
                        loading={openingId === attachment.id}
                        disabled={!accessible}
                        onClick={() => accessAttachment(attachment, "preview")}
                      >
                        Preview
                      </Button>
                    ) : null,
                    <Button
                      key="download"
                      type="text"
                      icon={<DownloadOutlined />}
                      aria-label={`Download ${attachment.file_name}`}
                      loading={openingId === attachment.id}
                      disabled={!accessible}
                      onClick={() => accessAttachment(attachment, "download")}
                    >
                      Download
                    </Button>,
                    canManage &&
                    scannerConfigured &&
                    attachment.scan_status !== "clean" &&
                    attachment.scan_status !== "pending" ? (
                      <Tooltip title="Run the private malware scanner again" key="rescan">
                        <Button
                          type="text"
                          icon={<ReloadOutlined />}
                          loading={scanningId === attachment.id}
                          onClick={() => rescanAttachment(attachment)}
                        >
                          Scan
                        </Button>
                      </Tooltip>
                    ) : null,
                    canGovern ? (
                      <Button
                        key="governance"
                        type="text"
                        icon={<LockOutlined />}
                        onClick={() => openGovernance(attachment)}
                      >
                        Controls
                      </Button>
                    ) : null,
                    canManage ? (
                      <Button
                        key="archive"
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        disabled={attachment.legal_hold || retained}
                        aria-label={`Archive ${attachment.file_name}`}
                        onClick={() => {
                          setArchiveTarget(attachment);
                          setArchiveReason("");
                        }}
                      >
                        Archive
                      </Button>
                    ) : null,
                  ].filter(Boolean)}
                >
                  <List.Item.Meta
                    avatar={<FileTypeIcon mimeType={attachment.mime_type} />}
                    title={<Typography.Text strong>{attachment.file_name}</Typography.Text>}
                    description={
                      <Space direction="vertical" size={2}>
                        <Typography.Text type="secondary">
                          {formatDocumentFileSize(attachment.size_bytes)} · Uploaded{" "}
                          {new Date(attachment.uploaded_at).toLocaleString("en-US")}
                        </Typography.Text>
                        {attachment.description ? (
                          <Typography.Text>{attachment.description}</Typography.Text>
                        ) : null}
                        <Space wrap>
                          <Tag>{kindLabel(attachment.document_kind)}</Tag>
                          <ScanStatusTag status={attachment.scan_status} />
                          {attachment.legal_hold ? <Tag color="purple">Legal hold</Tag> : null}
                          {attachment.retention_until ? (
                            <Tag color="blue">Retain until {attachment.retention_until}</Tag>
                          ) : null}
                        </Space>
                        {attachment.threat_name ? (
                          <Typography.Text type="danger">
                            Threat: {attachment.threat_name}
                          </Typography.Text>
                        ) : null}
                        {attachment.scan_error ? (
                          <Typography.Text type="danger">
                            Scan error: {attachment.scan_error}
                          </Typography.Text>
                        ) : null}
                      </Space>
                    }
                  />
                </List.Item>
              );
            }}
          />
        </section>
      </Drawer>

      <Modal
        title="Archive attachment"
        open={Boolean(archiveTarget)}
        onCancel={() => {
          setArchiveTarget(null);
          setArchiveReason("");
        }}
        onOk={archiveAttachment}
        okText="Archive"
        okButtonProps={{ danger: true, disabled: archiveReason.trim().length < 3 }}
        confirmLoading={archiving}
        destroyOnHidden
      >
        <Typography.Paragraph>
          The file will disappear from the document but remain retained in private storage and
          audit history.
        </Typography.Paragraph>
        <label className="document-archive-reason">
          <span>Reason</span>
          <Input.TextArea
            value={archiveReason}
            rows={3}
            maxLength={500}
            onChange={(event) => setArchiveReason(event.target.value)}
            placeholder="Why this attachment should be archived"
          />
        </label>
      </Modal>

      <Modal
        title="Document controls"
        open={Boolean(governanceTarget)}
        onCancel={() => {
          setGovernanceTarget(null);
          setGovernanceReason("");
        }}
        onOk={saveGovernance}
        okText="Save controls"
        okButtonProps={{ disabled: governanceReason.trim().length < 3 }}
        confirmLoading={savingGovernance}
        destroyOnHidden
      >
        <Typography.Paragraph>
          Retention prevents archiving until the selected date. Legal hold prevents
          archiving until an administrator removes the hold.
        </Typography.Paragraph>
        <div className="document-governance-fields">
          <label>
            <span>Retain until (optional)</span>
            <DatePicker
              value={retentionUntil}
              onChange={setRetentionUntil}
              minDate={dayjs().startOf("day")}
              format="MM/DD/YYYY"
              placeholder="Select retention date"
            />
          </label>
          <label className="document-legal-hold-control">
            <span>Legal hold</span>
            <Switch checked={legalHold} onChange={setLegalHold} />
          </label>
          <label>
            <span>Change reason</span>
            <Input.TextArea
              value={governanceReason}
              rows={3}
              maxLength={500}
              onChange={(event) => setGovernanceReason(event.target.value)}
              placeholder="Why these controls are being changed"
            />
          </label>
        </div>
      </Modal>
    </>
  );
}

function kindLabel(kind: DocumentKind): string {
  return DOCUMENT_KIND_OPTIONS.find((option) => option.value === kind)?.label ?? "Other";
}

function FileTypeIcon({ mimeType }: { mimeType: string }) {
  if (mimeType === "application/pdf") return <FilePdfOutlined className="document-file-icon document-file-icon--pdf" />;
  if (mimeType.startsWith("image/")) return <FileImageOutlined className="document-file-icon document-file-icon--image" />;
  if (mimeType.includes("spreadsheet") || mimeType === "text/csv") {
    return <FileExcelOutlined className="document-file-icon document-file-icon--sheet" />;
  }
  return <FileTextOutlined className="document-file-icon" />;
}

function ScanStatusTag({ status }: { status: DocumentAttachmentRow["scan_status"] }) {
  const config: Record<
    DocumentAttachmentRow["scan_status"],
    { color?: string; label: string }
  > = {
    not_configured: { color: "gold", label: "Not scanned" },
    pending: { color: "processing", label: "Scan pending" },
    clean: { color: "green", label: "Scan clean" },
    blocked: { color: "red", label: "Blocked" },
    error: { color: "red", label: "Scan error" },
  };
  return <Tag color={config[status].color}>{config[status].label}</Tag>;
}
