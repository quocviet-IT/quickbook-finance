import { redirect } from "next/navigation";
import { resolveActiveCompany } from "@/lib/db/company";
import { guideLanding } from "@/lib/domain/guide-help";
import GuideHome, { type GuideTab } from "./GuideHome";
import { pageMetadata } from "@/lib/domain/page-title";

export const metadata = pageMetadata("/guide");

/**
 * The guide (3.0.17): every workflow, what changed in each release, and what
 * OneBook is. Reached from the left menu, and from the Help link on every
 * screen, which says which screen it came from in `?from=`.
 */
export default async function GuidePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const from = typeof query.from === "string" ? query.from : null;
  const tab = typeof query.tab === "string" ? query.tab : null;
  const landing = guideLanding(from);
  // One guide covers that screen: open it. A list of one is a click in the way —
  // unless the reader asked for a tab by name.
  if (landing.redirectTo && !tab) redirect(landing.redirectTo);

  const { active } = await resolveActiveCompany();
  const initialTab: GuideTab = tab === "new" || tab === "about" ? tab : "guides";
  return (
    <GuideHome
      initialTab={initialTab}
      from={
        landing.route
          ? { route: landing.route, screen: landing.screen ?? "", flowIds: landing.flows.map((flow) => flow.id) }
          : null
      }
      company={active ? { name: active.dbaName || active.legalName, isSample: active.isSample } : null}
    />
  );
}
