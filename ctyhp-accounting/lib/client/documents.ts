"use client";

import {
  fileExtensionForMime,
  type DocumentEntityType,
} from "@/lib/domain/documents";

export async function calculateFileSha256(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createDocumentStoragePath(
  entityType: DocumentEntityType,
  entityId: string,
  mimeType: string,
): string {
  const extension = fileExtensionForMime(mimeType);
  return `${entityType}/${entityId}/${crypto.randomUUID()}.${extension}`;
}
