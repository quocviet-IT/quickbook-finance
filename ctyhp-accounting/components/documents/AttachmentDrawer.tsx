"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  App,
  Button,
  Drawer,
  Empty,
  Input,
  List,
  Modal,
  Select,
  Space,
  Tag,
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
  PaperClipOutlined,
} from "@ant-design/icons";
import { createSupabaseBrowserClient } from "@/lib/db/client";
import type { DocumentAttachmentRow } from "@/lib/db/types";
import {
  DOCUMENT_ACCEPT,
  DOCUMENT_BUCKET,
  DOCUMENT_KIND_OPTIONS,
  defaultDocumentKind,
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
} from "@/app/(app)/documents/actions";

export interface AttachmentTarget {
  entityType: DocumentEntityType;
  entityId: string;
  label: string;
}

export default function AttachmentDrawer({
  target,
  canManage,
  onClose,
}: {
  target: AttachmentTarget | null;
  canManage: boolean;
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

      message.success("Attachment uploaded.");
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

  function closeDrawer() {
    setAttachmentState(null);
    setFileList([]);
    setDescription("");
    setDocumentKind(null);
    setArchiveTarget(null);
    setArchiveReason("");
    onClose();
  }

  return (
    <>
      <Drawer
        open={Boolean(target)}
        onClose={closeDrawer}
        width={600}
        destroyOnHidden
        title={
          <Space>
            <PaperClipOutlined />
            <span>Documents & Attachments</span>
          </Space>
        }
        extra={target ? <Typography.Text type="secondary">{target.label}</Typography.Text> : null}
        className="document-attachment-drawer"
      >
        <Alert
          type="info"
          showIcon
          message="Private accounting evidence"
          description="Files are permission-controlled and access is logged. Malware scanning is not configured yet, so only upload files from trusted sources."
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
              disabled={uploading}
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
              disabled={!selectedFile}
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
                      onClick={() => accessAttachment(attachment, "download")}
                    >
                      Download
                    </Button>,
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
