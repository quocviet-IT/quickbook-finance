import { redirect } from "next/navigation";
import { currentUser, owesSecondStepNow, resolveActiveCompany } from "@/lib/db/company";
import { twoStepStanding } from "@/lib/db/two-step";
import { CODE_STEP_PATH } from "@/lib/domain/two-step";
import TwoStepRequiredClient from "./TwoStepRequiredClient";

export const dynamic = "force-dynamic";

/**
 * An admin or accountant past the 2.66 deadline without a second sign-in step.
 * The database already refuses them the books (0175); this is the one page
 * they can use, outside the app shell, which would only show them empty
 * screens. Anyone who does not owe it is sent on.
 */
export default async function TwoStepRequiredPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (await owesSecondStepNow()) redirect(CODE_STEP_PATH);
  const { active } = await resolveActiveCompany();
  if (!active) redirect("/dashboard");
  if (!(await twoStepStanding()).overdue) redirect("/dashboard");
  return <TwoStepRequiredClient email={user.email ?? ""} />;
}
