"use client";
import { useState } from "react";
import { App, DatePicker, Form, Input, Modal, Select, Upload } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import type { Dayjs } from "dayjs";
import { calculateFileSha256 } from "@/lib/client/documents";
import { createSupabaseBrowserClient } from "@/lib/db/client";
import {
  SAVED_REPORT_ACCEPT,
  SAVED_REPORT_BUCKET,
  SAVED_REPORT_SOURCE_LABEL,
  SAVED_REPORT_SOURCES,
  validateSavedReportFile,
  type SavedReportRegisterInput,
  type SavedReportSource,
} from "@/lib/domain/saved-reports";
import { createSavedReportUploadTicketAction, registerSavedReportAction } from "./actions";

export interface SaveReportModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

interface FormValues {
  title: string;
  source: SavedReportSource;
  period?: [Dayjs, Dayjs];
  notes?: string;
}

/**
 * Upload, then register.
 *
 * The browser never holds a storage credential: it asks the server for a
 * one-time ticket, uploads to that, and asks the server to record the result.
 * If recording fails the object is removed again — an uploaded file with no row
 * is invisible on this screen and cannot be deleted from it.
 */
export default function SaveReportModal({ open, onClose, onSaved }: SaveReportModalProps) {
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    form.resetFields();
    setFile(null);
  };

  const submit = async () => {
    if (!file) {
      message.error("Choose the report file first");
      return;
    }
    const values = await form.validateFields();
    setBusy(true);
    let uploadedPath: string | null = null;
    try {
      const ticket = await createSavedReportUploadTicketAction(file.type);
      if (!ticket.ok || !ticket.data) {
        throw new Error(ticket.error ?? "Could not prepare the upload");
      }

      const sb = createSupabaseBrowserClient();
      const upload = await sb.storage
        .from(ticket.data.bucket)
        .uploadToSignedUrl(ticket.data.path, ticket.data.token, file);
      if (upload.error) throw new Error(upload.error.message);
      uploadedPath = ticket.data.path;

      const registered = await registerSavedReportAction({
        title: values.title,
        source: values.source,
        period_start: values.period?.[0]?.format("YYYY-MM-DD") ?? null,
        period_end: values.period?.[1]?.format("YYYY-MM-DD") ?? null,
        notes: values.notes?.trim() ? values.notes.trim() : null,
        file_name: file.name,
        storage_path: ticket.data.path,
        mime_type: file.type as SavedReportRegisterInput["mime_type"],
        size_bytes: file.size,
        sha256: await calculateFileSha256(file),
      });
      if (!registered.ok) throw new Error(registered.error ?? "Could not save that report");

      uploadedPath = null;
      message.success("Report saved");
      reset();
      onSaved();
    } catch (error) {
      if (uploadedPath) {
        const sb = createSupabaseBrowserClient();
        const cleanup = await sb.storage.from(SAVED_REPORT_BUCKET).remove([uploadedPath]);
        if (cleanup.error) {
          message.warning(
            "The upload could not be cleaned up. Tell an administrator so the stray file is removed.",
          );
        }
      }
      message.error(error instanceof Error ? error.message : "Could not save that report");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Save a report from another system"
      okText="Save report"
      confirmLoading={busy}
      onOk={submit}
      onCancel={() => {
        reset();
        onClose();
      }}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" initialValues={{ source: "wave" }}>
        <Form.Item label="Report file" required>
          <Upload.Dragger
            accept={SAVED_REPORT_ACCEPT}
            maxCount={1}
            beforeUpload={(candidate) => {
              const problem = validateSavedReportFile({
                name: candidate.name,
                type: candidate.type,
                size: candidate.size,
              });
              if (problem) {
                message.error(problem);
                return Upload.LIST_IGNORE;
              }
              setFile(candidate as unknown as File);
              return false;
            }}
            onRemove={() => setFile(null)}
          >
            <p>
              <UploadOutlined /> CSV, PDF, XLSX, PNG or JPG, up to 10 MB
            </p>
            <p style={{ color: "#8c8c8c" }}>
              The file is kept exactly as it is. Nothing in it is posted to the ledger.
            </p>
          </Upload.Dragger>
        </Form.Item>
        <Form.Item
          name="title"
          label="Title"
          rules={[{ required: true, message: "Give the report a title" }]}
        >
          <Input placeholder="Profit and Loss 2025 (Wave)" maxLength={200} />
        </Form.Item>
        <Form.Item name="source" label="Where it came from" rules={[{ required: true }]}>
          <Select
            options={SAVED_REPORT_SOURCES.map((source) => ({
              value: source,
              label: SAVED_REPORT_SOURCE_LABEL[source],
            }))}
          />
        </Form.Item>
        <Form.Item name="period" label="Period it covers">
          <DatePicker.RangePicker style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item name="notes" label="Notes">
          <Input.TextArea
            rows={2}
            maxLength={2000}
            placeholder="Prepared by the outgoing bookkeeper"
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
