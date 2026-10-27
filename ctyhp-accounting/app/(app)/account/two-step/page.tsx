import { currentUser } from "@/lib/db/company";
import { twoStepStanding } from "@/lib/db/two-step";
import { verifiedAppFactors } from "@/lib/domain/two-step";
import PageHeader from "@/components/PageHeader";
import TwoStepClient from "./TwoStepClient";

export const dynamic = "force-dynamic";

/**
 * Your own second sign-in step (2.65). Anyone may set one up; once it is on,
 * every sign-in asks for the code and the database refuses a session that has
 * not given it (0174). The factor comes from the auth server, the same answer
 * the layout already asked for.
 */
export default async function TwoStepPage() {
  const [user, standing] = await Promise.all([currentUser(), twoStepStanding()]);
  const factor = verifiedAppFactors(user?.factors)[0] ?? null;
  return (
    <div>
      <PageHeader
        title="Two-step sign-in"
        description="A six-digit code from an app on your phone, asked for after your password."
      />
      <TwoStepClient email={user?.email ?? ""} onSince={factor?.created_at ?? null} canTurnOff={!standing.required} />
    </div>
  );
}
