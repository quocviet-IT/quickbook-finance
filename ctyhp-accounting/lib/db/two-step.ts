import "server-only";
import { cache } from "react";
import { createSupabaseServerClient } from "./server";
import { currentUser } from "./company";
import { currentAccess } from "./settings-access";
import {
  twoStepRequirement,
  verifiedAppFactors,
  type TwoStepPolicy,
  type TwoStepRequirement,
} from "@/lib/domain/two-step";

/**
 * What 2.66 asks of the signed-in person in the open company, once per request.
 *
 * The role is the person's own row (readable to them even while the database
 * refuses them everything else), the factors come from the auth server, and the
 * deadline from the company's acc_two_step_policy (0175). A failed read means
 * nothing is required here; the database still decides.
 */
export const twoStepStanding = cache(async (): Promise<TwoStepRequirement> => {
  const [user, access, sb] = await Promise.all([currentUser(), currentAccess(), createSupabaseServerClient()]);
  const { data } = await sb.from("acc_two_step_policy").select("roles, required_from").maybeSingle();
  return twoStepRequirement(
    access.role,
    (data as TwoStepPolicy | null) ?? null,
    verifiedAppFactors(user?.factors).length > 0,
  );
});
