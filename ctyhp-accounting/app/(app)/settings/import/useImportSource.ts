"use client";
import { useState } from "react";
import { App } from "antd";
import { fieldsFor, proposeMapping, type ImportTarget } from "@/lib/domain/import-mapping";
import { readImportFile } from "@/lib/domain/import-file";
import { suggestMappingAction } from "./actions";

/**
 * The file, and what its columns are taken to mean.
 *
 * Held apart from the rest of the import screen because it is a separate
 * question with a separate lifetime: which file, and which column is which.
 * What that file would then *do* — the pre-flight, the preview, the import
 * itself — all begin from the answer and none of them change it.
 *
 * The model is asked in the background and never blocks. Matching by name is
 * shown first, so the screen is usable before the model answers and stays
 * usable if it never does; only the headers are sent, and the rows do not leave
 * the browser until the import runs.
 */
export function useImportSource(target: ImportTarget) {
  const { message } = App.useApp();
  const [fileName, setFileName] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, number | null>>({});
  const [unmapped, setUnmapped] = useState<string[]>([]);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [aiFields, setAiFields] = useState<string[]>([]);

  function clear() {
    setFileName(null);
    setHeaders([]);
    setRows([]);
    setMapping({});
    setUnmapped([]);
  }

  /** Returns false so antd's Upload does not try to send the file anywhere. */
  function read(file: File): boolean {
    const reader = new FileReader();
    reader.onload = () => {
      const found = readImportFile(String(reader.result), target);
      if (!found) {
        message.warning("That file has no rows under its header.");
        return;
      }
      const { columns, rows: dataRows, proposed } = found;
      setHeaders(columns);
      setRows(dataRows);
      setMapping(proposed.columns);
      setUnmapped(proposed.unmapped);
      setAiNote(null);
      setAiFields([]);
      setFileName(file.name);
      message.info(
        proposed.missingRequired.length === 0
          ? `Read ${dataRows.length} row(s). Check the columns below.`
          : `Read ${dataRows.length} row(s), but some required columns need choosing.`,
      );

      setAiBusy(true);
      void suggestMappingAction(columns, target)
        .then((result) => {
          if (!result.ok || !result.data) return;
          if (result.data.aiFields.length === 0 && !result.data.note) return;
          setMapping(result.data.columns);
          setUnmapped(result.data.unmapped);
          setAiFields(result.data.aiFields);
          setAiNote(result.data.note);
        })
        .finally(() => setAiBusy(false));
    };
    reader.readAsText(file);
    return false;
  }

  /**
   * Re-propose against the file already read, for a different tab.
   *
   * The file was never the problem when somebody lands on the wrong tab; the
   * tab was. Making them upload it again to say so is a punishment.
   */
  function reproposeFor(next: ImportTarget) {
    if (headers.length === 0) return;
    const proposed = proposeMapping(headers, next);
    setMapping(proposed.columns);
    setUnmapped(proposed.unmapped);
  }

  const missingRequired = fieldsFor(target)
    .filter((field) => field.required && (mapping[field.key] ?? null) === null)
    .map((field) => field.label);

  return {
    fileName,
    headers,
    rows,
    mapping,
    setMapping,
    unmapped,
    aiBusy,
    aiNote,
    aiFields,
    missingRequired,
    read,
    clear,
    reproposeFor,
  };
}
