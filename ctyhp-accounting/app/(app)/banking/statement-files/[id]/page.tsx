import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getSavedReport, SavedReportNotFoundError, type SavedReportRow } from "@/lib/services/saved-reports";
import PageHeader from "@/components/PageHeader";
import StatementFileClient from "./StatementFileClient";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A kept statement file (1.83), shown inside OneBook: read through the
 * session, so a file this company does not hold — or this person may not read
 * — is not found.
 */
export default async function StatementFilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const sb = await createSupabaseServerClient();
  let file: SavedReportRow;
  try {
    file = await getSavedReport(sb, id);
  } catch (error) {
    if (error instanceof SavedReportNotFoundError) notFound();
    throw error;
  }
  return (
    <div>
      <PageHeader
        title={file.title}
        description="The statement file as the bank gave it, kept when OneBook read it. Shown here, never opened; Download has the original."
      />
      <StatementFileClient file={file} />
    </div>
  );
}
