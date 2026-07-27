import { z } from "zod";

export const DOCUMENT_BUCKET = "accounting-documents";
export const DOCUMENT_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

export const DOCUMENT_ENTITY_TYPES = [
  "invoice",
  "bill",
  "expense",
  "purchase_order",
  "payment",
  "bill_payment",
  "credit_memo",
  "vendor_credit",
  "journal_entry",
  "fixed_asset",
  "bank_transaction",
  "goods_receipt",
] as const;

export const DOCUMENT_KINDS = [
  "receipt",
  "vendor_bill",
  "customer_document",
  "purchase_order",
  "bank_statement",
  "contract",
  "tax_document",
  "other",
] as const;

export const DOCUMENT_ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export type DocumentEntityType = (typeof DOCUMENT_ENTITY_TYPES)[number];
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_KIND_OPTIONS: Array<{ value: DocumentKind; label: string }> = [
  { value: "receipt", label: "Receipt" },
  { value: "vendor_bill", label: "Vendor bill" },
  { value: "customer_document", label: "Customer document" },
  { value: "purchase_order", label: "Purchase order" },
  { value: "bank_statement", label: "Bank statement" },
  { value: "contract", label: "Contract" },
  { value: "tax_document", label: "Tax document" },
  { value: "other", label: "Other" },
];

export const DOCUMENT_ACCEPT =
  ".pdf,.jpg,.jpeg,.png,.webp,.csv,.xlsx,.docx";

const mimeSchema = z.enum(DOCUMENT_ALLOWED_MIME_TYPES);
const entitySchema = z.enum(DOCUMENT_ENTITY_TYPES);
const kindSchema = z.enum(DOCUMENT_KINDS);

export const documentAttachmentQuerySchema = z.object({
  entity_type: entitySchema,
  entity_id: z.string().uuid(),
});

export const documentAttachmentCreateSchema = documentAttachmentQuerySchema.extend({
  document_kind: kindSchema,
  file_name: z.string().trim().min(1).max(255),
  storage_path: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .refine((value) => !value.includes(".."), "Invalid storage path"),
  mime_type: mimeSchema,
  size_bytes: z.number().int().positive().max(DOCUMENT_MAX_FILE_SIZE_BYTES),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  description: z.string().trim().max(500).nullable().optional(),
});

export const documentArchiveSchema = z.object({
  attachment_id: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
});

export const documentAccessSchema = z.object({
  attachment_id: z.string().uuid(),
  action: z.enum(["preview", "download"]),
});

export type DocumentAttachmentCreateInput = z.infer<typeof documentAttachmentCreateSchema>;

export function defaultDocumentKind(entityType: DocumentEntityType): DocumentKind {
  switch (entityType) {
    case "invoice":
    case "payment":
    case "credit_memo":
      return "customer_document";
    case "bill":
    case "bill_payment":
    case "vendor_credit":
      return "vendor_bill";
    case "expense":
      return "receipt";
    case "purchase_order":
    case "goods_receipt":
      return "purchase_order";
    case "bank_transaction":
      return "bank_statement";
    default:
      return "other";
  }
}

export function validateDocumentFile(file: {
  name: string;
  type: string;
  size: number;
}): string | null {
  if (!file.name.trim()) return "Choose a file with a valid name.";
  if (file.name.length > 255) return "The file name must be 255 characters or fewer.";
  if (file.size <= 0) return "The selected file is empty.";
  if (file.size > DOCUMENT_MAX_FILE_SIZE_BYTES) return "The file must be 10 MB or smaller.";
  if (!DOCUMENT_ALLOWED_MIME_TYPES.includes(file.type as (typeof DOCUMENT_ALLOWED_MIME_TYPES)[number])) {
    return "Use PDF, JPG, PNG, WebP, CSV, XLSX, or DOCX.";
  }
  return null;
}

export function fileExtensionForMime(mimeType: string): string {
  const extensions: Record<string, string> = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "text/csv": "csv",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  };
  const extension = extensions[mimeType];
  if (!extension) throw new Error("Unsupported file type");
  return extension;
}

export function formatDocumentFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
