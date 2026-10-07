"use client";
import { useEffect, useState } from "react";
import { Alert, Spin, Typography } from "antd";
import { savedReportPreview, savedReportView, type SavedReportPreview } from "@/lib/domain/saved-reports";
import { PDF_MESSAGES } from "@/lib/domain/pdf-statement-view";
import { savedReportDownloadUrlAction, savedReportPreviewAction } from "@/app/(app)/reports/saved/actions";
import DataTable from "@/components/ui/DataTable";

/** The width a page is drawn at; the image scales down with the screen. */
const PAGE_WIDTH = 860;

export interface StatementFileViewerProps {
  /** The saved file's id in Reports › Saved. */
  id: string;
  mimeType: string;
}

/** One row of the preview grid, carried with its position so it needs no key of its own. */
interface PreviewRow {
  index: number;
  row: string[];
}

type Loaded =
  | { id: string; kind: "pdf"; images: string[]; pageCount: number }
  | { id: string; kind: "table"; preview: SavedReportPreview }
  | { id: string; kind: "text"; text: string }
  | { id: string; problem: string };

async function load(id: string, mimeType: string): Promise<Loaded> {
  const view = savedReportView(mimeType);
  if (view === "pdf") {
    // The bytes come through a link that lives a minute, and are drawn here —
    // the browser is never handed the file to open.
    const link = await savedReportDownloadUrlAction(id);
    if (!link.ok || !link.data) return { id, problem: link.error ?? "Could not read the file" };
    const response = await fetch(link.data.url);
    if (!response.ok) return { id, problem: "Could not read the file" };
    const { pdfPageImages } = await import("@/lib/client/pdf-pages");
    const drawn = await pdfPageImages(await response.arrayBuffer(), PAGE_WIDTH);
    if ("failure" in drawn) return { id, problem: PDF_MESSAGES[drawn.failure] };
    return { id, kind: "pdf", ...drawn };
  }
  const read = await savedReportPreviewAction(id);
  if (!read.ok || !read.data) return { id, problem: read.error ?? "Could not read the file" };
  return view === "table"
    ? { id, kind: "table", preview: savedReportPreview(read.data.text) }
    : { id, kind: "text", text: read.data.text };
}

/**
 * A saved file shown inside OneBook. Nothing in the store is virus-scanned, so
 * nothing is opened by the browser: a PDF is drawn page by page as pictures, a
 * CSV is a table, a bank download (OFX, QFX, QBO, QIF) is plain text. Any
 * other format says so; Download beside it always has the original.
 */
export default function StatementFileViewer({ id, mimeType }: StatementFileViewerProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const view = savedReportView(mimeType);

  useEffect(() => {
    if (view === "download") return;
    let cancelled = false;
    load(id, mimeType)
      .catch((error: unknown) => ({ id, problem: error instanceof Error ? error.message : "Could not read the file" }))
      .then((result) => {
        if (!cancelled) setLoaded(result);
      });
    return () => {
      cancelled = true;
    };
  }, [id, mimeType, view]);

  if (view === "download") {
    return (
      <Alert
        type="info"
        showIcon
        message="This format is not shown in OneBook"
        description="OneBook shows PDF, CSV and bank download files on screen. Download the original to open this one."
      />
    );
  }

  // Keeping the id beside the result is what lets opening a second file show a
  // spinner rather than the first one's pages.
  const current = loaded?.id === id ? loaded : null;
  if (!current) return <Spin />;
  if ("problem" in current) return <Alert type="error" showIcon message={current.problem} />;

  if (current.kind === "pdf") {
    return (
      <div className="statement-file-pages">
        {current.pageCount > current.images.length ? (
          <Alert
            type="info"
            showIcon
            message={`Showing the first ${current.images.length} of ${current.pageCount} pages. Download the original for the rest.`}
          />
        ) : null}
        {current.images.map((src, index) => (
          // eslint-disable-next-line @next/next/no-img-element -- a page drawn in the browser, not a file Next can optimise
          <img key={index} src={src} alt={`Page ${index + 1}`} />
        ))}
      </div>
    );
  }

  if (current.kind === "text") {
    return (
      <Typography.Paragraph>
        <pre className="statement-file-text">{current.text}</pre>
      </Typography.Paragraph>
    );
  }

  return (
    <>
      {current.preview.truncated ? (
        <Alert type="info" showIcon message="Showing the first 500 rows. Download the original for the whole file." />
      ) : null}
      {/* A matrix: its columns are the file's own, as many as the file has. */}
      <DataTable<PreviewRow>
        fit={false}
        rowKey={(item) => String(item.index)}
        rows={current.preview.rows.map((row, index) => ({ index, row }))}
        columns={current.preview.headers.map((header, column) => ({
          title: header || `Column ${column + 1}`,
          key: String(column),
          render: (_: unknown, item: PreviewRow) => item.row[column] ?? "",
        }))}
      />
    </>
  );
}
