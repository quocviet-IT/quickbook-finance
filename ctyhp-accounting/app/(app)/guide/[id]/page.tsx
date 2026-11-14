import { notFound, redirect } from "next/navigation";
import { GUIDE_AREAS } from "@/lib/domain/system-guide";
import { guideFlowById, guideLanding, retiredGuideTarget } from "@/lib/domain/guide-help";
import { createSupabaseServerClient } from "@/lib/db/server";
import { guideVideoLinks } from "@/lib/services/guide-videos";
import GuideFlowView from "./GuideFlowView";
import { recordMetadata } from "@/lib/domain/page-title";
import type { Metadata } from "next";

/** The guide's own title in the tab (3.0.32). Read from the guide's data, no database. */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return recordMetadata(guideFlowById(id)?.title ?? null, "/guide");
}

/**
 * One workflow, on a page of its own (3.0.17). Only this workflow is handed to
 * the browser; the list of all of them stays on /guide. A guide with a video
 * (3.0.28) is handed short-lived links to it, asked for here as the reader.
 */
export default async function GuideFlowPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const flow = guideFlowById(id);
  if (!flow) {
    // A guide that was split (Banking, 3.0.18) sends its old address on.
    const moved = retiredGuideTarget(id);
    if (moved) redirect(moved);
    notFound();
  }
  const from = typeof query.from === "string" ? guideLanding(query.from) : null;
  const area = GUIDE_AREAS.find((candidate) => candidate.id === flow.area);
  const links = flow.video ? await guideVideoLinks(await createSupabaseServerClient(), flow.video) : null;
  return (
    <GuideFlowView
      flow={flow}
      areaTitle={area?.title ?? "Guide"}
      from={from?.route ? { route: from.route, screen: from.screen ?? "" } : null}
      video={flow.video && links ? { ...flow.video, ...links } : null}
    />
  );
}
