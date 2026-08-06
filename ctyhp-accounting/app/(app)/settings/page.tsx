import PageHeader from "@/components/PageHeader";
import SettingsHubClient from "./SettingsHubClient";
import { settingsGateFor, settingsHubForAccess } from "@/lib/domain/navigation";
import { currentAccess } from "@/lib/db/settings-access";

export const dynamic = "force-dynamic";

/**
 * One entry in the sidebar instead of a leaf per screen. The catalog lives in
 * lib/domain/navigation.ts and a unit test asserts every /settings/* route the
 * app serves appears there, so a new settings page cannot go unreachable.
 *
 * `denied` is set by requireSettingsAccess when it turns someone away. Sending
 * them back with no explanation invites them to conclude the app is broken.
 */
export default async function SettingsHubPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const [{ denied }, access] = await Promise.all([searchParams, currentAccess()]);
  const groups = settingsHubForAccess(access);

  let deniedTitle: string | null = null;
  if (denied) {
    try {
      deniedTitle = settingsGateFor(denied).title;
    } catch {
      // A denied value naming no screen is a stale or hand-edited link. Show the
      // hub without a banner rather than an error page.
      deniedTitle = null;
    }
  }

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Company profile, the accounting calendar, who has access, and the controls around it."
      />
      <SettingsHubClient groups={groups} deniedTitle={deniedTitle} />
    </div>
  );
}
