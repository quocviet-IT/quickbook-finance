import PageHeader from "@/components/PageHeader";
import SettingsHubClient from "./SettingsHubClient";

export const dynamic = "force-dynamic";

/**
 * One entry in the sidebar instead of a leaf per screen. The catalog lives in
 * lib/domain/navigation.ts and a unit test asserts every /settings/* route the
 * app serves appears there, so a new settings page cannot go unreachable.
 */
export default async function SettingsHubPage() {
  return (
    <div>
      <PageHeader
        title="Settings"
        description="Company profile, the accounting calendar, who has access, and the controls around it."
      />
      <SettingsHubClient />
    </div>
  );
}
