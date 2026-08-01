/**
 * What the person is looking at.
 *
 * Pure. Three features were each guessing at this separately and getting it
 * wrong in the same way: the assistant answered as if every question arrived
 * from nowhere, the guide listed thirteen workflows and left you to find yours,
 * and a problem report recorded a URL but not what that screen is *for*.
 *
 * They are all the same question — "which part of the system is this?" — so it
 * is answered once, here, from the guide's own data. The guide already knows
 * which route each step lives on and a test already proves those routes exist,
 * which makes it the only description of the application that cannot quietly
 * drift out of date.
 */

import { GUIDE_FLOWS, type GuideFlow, type GuideStep } from "./system-guide";

export interface ScreenContext {
  /** The route as the browser has it. */
  route: string;
  /** Workflows that start here, best match first. */
  flowsStartingHere: GuideFlow[];
  /** Workflows that pass through here without starting here. */
  flowsPassingThrough: { flow: GuideFlow; steps: GuideStep[] }[];
  /** One line naming what this screen is for, or null when nothing covers it. */
  summary: string | null;
}

/** Strip query strings, trailing slashes and record ids down to the route. */
export function normaliseRoute(raw: string): string {
  const path = (raw ?? "").split("?")[0].split("#")[0];
  const trimmed = path.replace(/\/+$/, "");
  if (trimmed === "") return "/";
  // `/invoices/8f3c…` is still the invoices screen as far as the guide knows.
  return trimmed.replace(
    /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}.*$/i,
    "",
  );
}

/**
 * Everything the guide knows about this screen.
 *
 * A workflow that *starts* here is what the person most likely came to do; one
 * that merely passes through is worth offering second, with only the steps that
 * happen here rather than the whole flow.
 */
export function screenContextFor(rawRoute: string): ScreenContext {
  const route = normaliseRoute(rawRoute);

  const flowsStartingHere = GUIDE_FLOWS.filter((flow) => flow.route === route);

  const flowsPassingThrough = GUIDE_FLOWS.filter((flow) => flow.route !== route)
    .map((flow) => ({
      flow,
      steps: flow.steps.filter((step) => step.route === route),
    }))
    .filter((entry) => entry.steps.length > 0);

  return {
    route,
    flowsStartingHere,
    flowsPassingThrough,
    summary: summarise(route, flowsStartingHere, flowsPassingThrough),
  };
}

function summarise(
  route: string,
  starting: GuideFlow[],
  passing: { flow: GuideFlow; steps: GuideStep[] }[],
): string | null {
  if (starting.length > 0) {
    return starting.length === 1
      ? `${route} is where you ${lowerFirst(starting[0].title)}. ${starting[0].purpose}`
      : `${route} starts ${starting.length} workflows: ${starting.map((f) => f.title).join(", ")}.`;
  }
  if (passing.length > 0) {
    const actions = passing.flatMap((entry) => entry.steps.map((step) => step.action));
    return `${route} is used part-way through ${passing
      .map((entry) => lowerFirst(entry.flow.title))
      .join(", ")} — to ${actions.slice(0, 3).map(lowerFirst).join(", ")}.`;
  }
  return null;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

// --- Searching the guide ----------------------------------------------------

export interface GuideMatch {
  flow: GuideFlow;
  /** Steps that matched, when the match was on a step rather than the flow. */
  steps: GuideStep[];
  score: number;
}

/**
 * Find the workflow somebody is describing.
 *
 * Matches the title first, then the purpose, then the individual steps and the
 * on-screen control names — because people search for the button they can see
 * ("void"), not for the name of the workflow it belongs to.
 */
/**
 * Words that appear in almost every sentence. Left in, a search for "an" would
 * match every workflow and rank them by nothing at all. The list is short on
 * purpose: a genuine two-letter search like "AR" must still work.
 */
const STOP_WORDS = new Set([
  "an", "and", "are", "as", "at", "be", "by", "do", "for", "from", "how", "in",
  "is", "it", "of", "on", "or", "the", "to", "up", "was", "what", "when",
  "where", "which", "with",
]);

export function searchGuide(query: string, flows: readonly GuideFlow[] = GUIDE_FLOWS): GuideMatch[] {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 1 && !STOP_WORDS.has(term));
  if (terms.length === 0) return [];

  const matches: GuideMatch[] = [];
  for (const flow of flows) {
    let score = 0;
    const title = flow.title.toLowerCase();
    const purpose = flow.purpose.toLowerCase();

    for (const term of terms) {
      if (title.includes(term)) score += 10;
      if (purpose.includes(term)) score += 4;
    }

    const steps = flow.steps.filter((step) => {
      const haystack = `${step.action} ${step.control} ${step.note ?? ""}`.toLowerCase();
      return terms.some((term) => haystack.includes(term));
    });
    // A control name is what people actually type, so weight it above prose.
    for (const step of steps) {
      const control = step.control.toLowerCase();
      score += terms.some((term) => control.includes(term)) ? 6 : 2;
    }

    if (score > 0) matches.push({ flow, steps, score });
  }

  return matches.sort((a, b) => b.score - a.score || a.flow.title.localeCompare(b.flow.title));
}

// --- Describing it to the assistant ----------------------------------------

export interface AssistantContext {
  route: string;
  companyName: string;
  isSampleCompany: boolean;
  role: string | null;
}

/**
 * The briefing the assistant gets before the question.
 *
 * Kept short on purpose. The point is not to hand it the whole application but
 * to stop it answering a question about *this* screen as though it had arrived
 * out of nowhere — and to stop it telling a viewer to press a button only an
 * administrator can see.
 */
export function describeContextForAssistant(context: AssistantContext): string {
  const screen = screenContextFor(context.route);
  const lines: string[] = [
    "Where this question is coming from:",
    `- Screen: ${screen.route}`,
  ];

  if (screen.summary) lines.push(`- What that screen is for: ${screen.summary}`);

  if (screen.flowsStartingHere.length > 0) {
    for (const flow of screen.flowsStartingHere) {
      lines.push(`- Workflow "${flow.title}" starts here. Steps:`);
      for (const step of flow.steps) {
        lines.push(
          `    * ${step.action} — control "${step.control}"${step.route ? ` on ${step.route}` : ""}` +
            `${step.note ? `. ${step.note}` : ""}`,
        );
      }
    }
  } else if (screen.flowsPassingThrough.length > 0) {
    for (const entry of screen.flowsPassingThrough) {
      for (const step of entry.steps) {
        lines.push(
          `- Part of "${entry.flow.title}": ${step.action} — control "${step.control}"` +
            `${step.note ? `. ${step.note}` : ""}`,
        );
      }
    }
  }

  lines.push(`- Company open: ${context.companyName}${context.isSampleCompany ? " (a sample company, not real books)" : ""}`);
  if (context.role) lines.push(`- The person asking is a ${context.role}.`);

  lines.push(
    "",
    "Use this to answer about the screen they are on. Do not repeat it back at them.",
  );
  return lines.join("\n");
}

// --- Reading the answer back ------------------------------------------------

export type AnswerSegment =
  | { kind: "text"; text: string }
  | { kind: "route"; route: string };

/**
 * Split an answer into prose and the routes it mentions.
 *
 * The assistant is told to write a route in square brackets when a step happens
 * elsewhere. Turning those into links is the difference between being told
 * where to go and being taken there — and it is done here, on known routes
 * only, so a hallucinated path cannot become a link to nowhere.
 */
export function splitAnswerRoutes(
  answer: string,
  knownRoutes: readonly string[] = guideKnownRoutes(),
): AnswerSegment[] {
  const segments: AnswerSegment[] = [];
  const pattern = /\[(\/[a-z0-9\-/]*)\]/gi;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(answer)) !== null) {
    const route = normaliseRoute(match[1]);
    if (!knownRoutes.includes(route)) continue;
    if (match.index > last) {
      segments.push({ kind: "text", text: answer.slice(last, match.index) });
    }
    segments.push({ kind: "route", route });
    last = match.index + match[0].length;
  }

  if (last < answer.length) segments.push({ kind: "text", text: answer.slice(last) });
  return segments.filter((s) => s.kind === "route" || s.text !== "");
}

/** Every route the guide names, which is the set an answer may link to. */
export function guideKnownRoutes(): string[] {
  const routes = new Set<string>();
  for (const flow of GUIDE_FLOWS) {
    routes.add(flow.route);
    for (const step of flow.steps) if (step.route) routes.add(step.route);
  }
  return [...routes];
}

/**
 * Questions worth offering on this screen.
 *
 * Built from what the guide says happens here, so they are always answerable —
 * a suggested question the assistant cannot answer is worse than none.
 */
export function suggestedQuestions(rawRoute: string, limit = 3): string[] {
  const screen = screenContextFor(rawRoute);
  const questions: string[] = [];

  for (const flow of screen.flowsStartingHere) {
    questions.push(`How do I ${lowerFirst(flow.title)}?`);
    for (const step of flow.steps.slice(0, 2)) {
      questions.push(`What does "${step.control}" do?`);
    }
  }
  for (const entry of screen.flowsPassingThrough) {
    for (const step of entry.steps.slice(0, 1)) {
      questions.push(`What does "${step.control}" do?`);
    }
  }

  return [...new Set(questions)].slice(0, limit);
}
