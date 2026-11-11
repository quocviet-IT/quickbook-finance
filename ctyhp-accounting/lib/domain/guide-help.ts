/**
 * Where the guide opens for a screen, and how it describes a workflow (3.0.17).
 *
 * Every page header carries a Help link (lib/domain/help-link.ts). It holds
 * only the screen's path, so the guide's workflows load on the guide's own
 * pages and nowhere else; this module reads the path back and opens the guide
 * on what covers that screen.
 */

import { GUIDE_FLOWS, type GuideFlow, type GuideStep } from "./system-guide";
import { screenContextFor } from "./screen-context";
import { screenName } from "./screen-names";
import { plural } from "@/lib/format";
import { GUIDE_ROUTE } from "./help-link";

export { GUIDE_ROUTE, helpHref } from "./help-link";

export interface GuideLanding {
  /** The route the reader came from, normalised, or null when there was none to trust. */
  route: string | null;
  /** That screen's name, for "For the screen you were on: …". */
  screen: string | null;
  /** Guides that start there first, then guides that pass through it. */
  flows: GuideFlow[];
  /**
   * When exactly one guide covers the screen, its address: a list of one is a
   * click in the way. Opened at the step that happens on that screen when the
   * guide only passes through it.
   */
  redirectTo: string | null;
}

const NOWHERE: GuideLanding = { route: null, screen: null, flows: [], redirectTo: null };

/**
 * What the guide shows for `?from=`. Only a path inside OneBook is believed: the
 * value arrives in a URL anybody can type, and an address elsewhere ("//host",
 * "https:…", "javascript:…") must never become the target of a redirect.
 */
export function guideLanding(from: string | null | undefined): GuideLanding {
  if (!from || !from.startsWith("/") || from.startsWith("//") || from.includes("\\")) return NOWHERE;
  const context = screenContextFor(from);
  const flows = [...context.flowsStartingHere, ...context.flowsPassingThrough.map((entry) => entry.flow)];
  let redirectTo: string | null = null;
  if (flows.length === 1) {
    const flow = flows[0];
    const stepIndex = flow.route === context.route ? -1 : flow.steps.findIndex((step) => step.route === context.route);
    redirectTo =
      `${GUIDE_ROUTE}/${flow.id}?from=${encodeURIComponent(context.route)}` +
      (stepIndex >= 0 ? `#step-${stepIndex + 1}` : "");
  }
  return { route: context.route, screen: screenName(context.route), flows, redirectTo };
}

export function guideFlowById(id: string): GuideFlow | undefined {
  return GUIDE_FLOWS.find((flow) => flow.id === id);
}

/** The screen a step happens on: its own, or the one its workflow starts on. */
export function stepScreen(flow: GuideFlow, step: GuideStep): string {
  return screenName(step.route ?? flow.route);
}

/** What a workflow's card says under its purpose: "7 steps", "Starts on Invoices", "Pictures". */
export function guideCardMeta(flow: GuideFlow): string[] {
  const meta = [plural(flow.steps.length, "step"), `Starts on ${screenName(flow.route)}`];
  if (flow.steps.some((step) => step.screenshot)) meta.push("Pictures");
  return meta;
}
