import { notFound } from "next/navigation";
import { GUIDE_AREAS } from "@/lib/domain/system-guide";
import { guideFlowById, guideLanding } from "@/lib/domain/guide-help";
import GuideFlowView from "./GuideFlowView";

/**
 * One workflow, on a page of its own (3.0.17). Only this workflow is handed to
 * the browser; the list of all of them stays on /guide.
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
  if (!flow) notFound();
  const from = typeof query.from === "string" ? guideLanding(query.from) : null;
  const area = GUIDE_AREAS.find((candidate) => candidate.id === flow.area);
  return (
    <GuideFlowView
      flow={flow}
      areaTitle={area?.title ?? "Guide"}
      from={from?.route ? { route: from.route, screen: from.screen ?? "" } : null}
    />
  );
}
