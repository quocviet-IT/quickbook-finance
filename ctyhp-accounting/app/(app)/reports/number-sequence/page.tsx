import { createSupabaseServerClient } from "@/lib/db/server";
import { hasPermission } from "@/lib/services/access";
import { listSequenceCatalog } from "@/lib/services/sequence";
import PageHeader from "@/components/PageHeader";
import NumberSequenceClient from "./NumberSequenceClient";

export const dynamic = "force-dynamic";

export default async function NumberSequencePage() {
  const sb = await createSupabaseServerClient();
  const [catalog, canDocumentGaps] = await Promise.all([
    listSequenceCatalog(sb),
    hasPermission(sb, "settings.manage"),
  ]);

  return (
    <div>
      <PageHeader
        title="Document Number Sequence"
        description="Every number the system has issued, in order, with any that no document holds flagged as a break."
      />
      <NumberSequenceClient catalog={catalog} canDocumentGaps={canDocumentGaps} />
    </div>
  );
}
