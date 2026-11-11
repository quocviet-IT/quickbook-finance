/**
 * What Abacus offers to ask (pure).
 *
 * The start view lists common questions by topic: first the screen the person
 * is on, then one topic per guide area. Each question carries the guide that
 * answers it, so the panel can tag it. Built from the guide's own data, so a
 * suggested question is always one the guides can answer.
 */

import { GUIDE_AREAS, GUIDE_FLOWS } from "./system-guide";
import { screenContextFor, suggestedQuestions } from "./screen-context";

export interface AbacusQuestion {
  question: string;
  guide: { id: string; title: string } | null;
}
export interface AbacusTopic {
  id: string;
  label: string;
  questions: AbacusQuestion[];
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

const SCREEN_LIMIT = 3;
const AREA_LIMIT = 4;

function screenQuestions(route: string): AbacusQuestion[] {
  const screen = screenContextFor(route);
  const questions: AbacusQuestion[] = [];
  const push = (question: AbacusQuestion) => {
    if (!questions.some((q) => q.question === question.question)) questions.push(question);
  };
  for (const flow of screen.flowsStartingHere) {
    const guide = { id: flow.id, title: flow.title };
    push({ question: `How do I ${lowerFirst(flow.title)}?`, guide });
    for (const step of flow.steps.slice(0, 2)) push({ question: `What does "${step.control}" do?`, guide });
  }
  for (const entry of screen.flowsPassingThrough) {
    const guide = { id: entry.flow.id, title: entry.flow.title };
    for (const step of entry.steps.slice(0, 1)) push({ question: `What does "${step.control}" do?`, guide });
  }
  return questions.slice(0, SCREEN_LIMIT);
}

export function abacusTopics(route: string): AbacusTopic[] {
  const topics: AbacusTopic[] = [];
  const here = screenQuestions(route);
  if (here.length > 0) topics.push({ id: "screen", label: "This screen", questions: here });

  for (const area of GUIDE_AREAS) {
    const flows = GUIDE_FLOWS.filter((flow) => flow.area === area.id).slice(0, AREA_LIMIT);
    if (flows.length === 0) continue;
    topics.push({
      id: area.id,
      label: area.title,
      questions: flows.map((flow) => ({
        question: `How do I ${lowerFirst(flow.title)}?`,
        guide: { id: flow.id, title: flow.title },
      })),
    });
  }
  return topics;
}

/** Questions to offer after an answer: this screen's, minus what was already asked. */
export function abacusFollowUps(route: string, asked: readonly string[], limit = 2): string[] {
  const seen = new Set(asked.map((q) => q.trim().toLowerCase()));
  return suggestedQuestions(route, 6)
    .filter((q) => !seen.has(q.toLowerCase()))
    .slice(0, limit);
}
