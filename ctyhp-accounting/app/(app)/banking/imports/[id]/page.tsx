import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/db/server";
import { canWrite, getUserRole } from "@/lib/auth";
import { loadImportReview } from "@/lib/services/statement-review";
import PageHeader from "@/components/PageHeader";
import ReviewImportClient from "./ReviewImportClient";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ReviewImportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const sb = await createSupabaseServerClient();
  const [role, review] = await Promise.all([getUserRole(), loadImportReview(sb, id)]);
  if (!review) notFound();
  return (
    <div>
      <PageHeader
        title="Review import"
        description="Every line this statement brought in, with what OneBook proposes for it. Nothing is posted until you click Post; lines you leave stay waiting on Bank Transactions."
      />
      <ReviewImportClient review={review} canWrite={canWrite(role)} />
    </div>
  );
}
