/**
 * What the Abacus panel works out before it draws (3.0.20). Pure, so a test can
 * hold it without a browser.
 */

import { abacusBlocks, abacusSourceFromKey, type AbacusInline, type AbacusSource } from "@/lib/domain/abacus-answer";
import type { AbacusQuestion } from "@/lib/domain/abacus-topics";
import { HELP_NAV_ITEM, NAV, findActiveGroup, findActivePage } from "@/lib/domain/navigation";
import { normaliseRoute } from "@/lib/domain/route-path";
import { screenName } from "@/lib/domain/screen-names";
import { screenContextFor } from "@/lib/domain/screen-context";
import { GUIDE_AREAS } from "@/lib/domain/system-guide";
import { formatDayHeading } from "@/lib/format";

/** Which part of OneBook a screen belongs to, for the small icon beside its name. */
export type ScreenArea =
  | "dashboard"
  | "sales"
  | "purchases"
  | "inventory"
  | "banking"
  | "accounting"
  | "reports"
  | "settings"
  | "guide"
  | "other";

/** An icon a topic or a screen is drawn with: a screen's area, or one of the guide's two areas no menu has. */
export type AbacusIconKind = ScreenArea | "data" | "controls";

const GROUP_AREA: Readonly<Record<string, ScreenArea>> = {
  sales: "sales",
  purchases: "purchases",
  "inventory-assets": "inventory",
  banking: "banking",
  accounting: "accounting",
};

const PAGE_AREA: Readonly<Record<string, ScreenArea>> = {
  "/dashboard": "dashboard",
  "/reports": "reports",
  "/settings": "settings",
  "/guide": "guide",
};

/**
 * The menu group a screen sits under, read from the sidebar's own data, so the
 * icon beside a screen's name is the one the sidebar shows for it. A report
 * opens under Reports and a settings page under Settings, as the menu does.
 */
export function screenArea(route: string): ScreenArea {
  const page = findActivePage(normaliseRoute(route), [...NAV, HELP_NAV_ITEM]);
  if (!page) return "other";
  const group = findActiveGroup(page.key);
  return (group ? GROUP_AREA[group] : PAGE_AREA[page.key]) ?? "other";
}

/** The icon a topic chip carries: the screen's own for "This screen", otherwise its guide area's. */
export function topicIcon(topicId: string, route: string): AbacusIconKind {
  if (topicId === "screen") return screenArea(route);
  switch (topicId) {
    case "sales":
    case "purchases":
    case "inventory":
    case "banking":
    case "accounting":
    case "data":
    case "controls":
      return topicId;
    default:
      return "other";
  }
}

/**
 * The guide tag beside a common question, or null when it would only repeat
 * the question: "How do I bring bank lines in?" needs no "Bring bank lines in"
 * beside it, while "What does "Issue" do?" is told which guide answers it.
 */
export function guideTag(question: AbacusQuestion): string | null {
  if (!question.guide) return null;
  return question.question.toLowerCase().includes(question.guide.title.toLowerCase()) ? null : question.guide.title;
}

/** Where to read the steps when Abacus cannot answer: the guide that starts on this screen, or every guide. */
export function guideForScreen(route: string): { href: string; name: string; path: string } {
  const flow = screenContextFor(route).flowsStartingHere[0];
  if (!flow) return { href: "/guide", name: "Guide", path: "Every guide, by area" };
  const area = GUIDE_AREAS.find((candidate) => candidate.id === flow.area);
  return { href: `/guide/${flow.id}`, name: flow.title, path: area ? `Guide › ${area.title}` : "Guide" };
}

interface Searchable {
  title: string;
  lastQuestion: string;
  route: string;
}

/**
 * Conversations whose title, last question or screen name holds the words
 * searched for, in any case. The list is at most twenty, already in the
 * browser, so the search never goes back to the server.
 */
export function filterConversations<T extends Searchable>(items: readonly T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...items];
  return items.filter((item) =>
    [item.title, item.lastQuestion, screenName(item.route)].some((text) => text.toLowerCase().includes(needle)),
  );
}

/**
 * The list cut into days, newest first as it arrives: "Today", "Yesterday",
 * then "Friday, 11/06/2026", on the company's clock.
 */
export function groupByDay<T extends { updatedAt: string }>(
  items: readonly T[],
  timeZone: string,
  today: string,
): { heading: string; items: T[] }[] {
  const groups: { heading: string; items: T[] }[] = [];
  for (const item of items) {
    const heading = formatDayHeading(item.updatedAt, timeZone, today);
    const last = groups[groups.length - 1];
    if (last && last.heading === heading) last.items.push(item);
    else groups.push({ heading, items: [item] });
  }
  return groups;
}

/** A conversation's title short enough for a dialog's question: `How do I record a payment…`. */
/** A server's message read as a sentence, so the line after it does not run on: "fetch failed" → "fetch failed." */
export function asSentence(message: string): string {
  const text = message.trim();
  if (!text) return text;
  return /[.!?…]$/.test(text) ? text : `${text}.`;
}

export function shortTitle(title: string, limit = 60): string {
  const flat = title.replace(/\s+/g, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1).trimEnd()}…`;
}

/** The character count under the box: `0 / 1,000`. */
export function questionCounter(length: number, max: number): string {
  return `${length.toLocaleString("en-US")} / ${max.toLocaleString("en-US")}`;
}

function inlineText(inlines: readonly AbacusInline[]): string {
  return inlines.map((inline) => (inline.kind === "route" ? inline.name : inline.text)).join("");
}

/**
 * An answer as plain text, for Copy: steps numbered, bullets dashed, a button's
 * name without its backticks, a screen by its name and where the menu has it.
 */
export function plainAnswer(body: string): string {
  return abacusBlocks(body)
    .map((block) => {
      switch (block.kind) {
        case "paragraph":
          return inlineText(block.inlines);
        case "steps":
          return block.items.map((item, index) => `${index + 1}. ${inlineText(item)}`).join("\n");
        case "bullets":
          return block.items.map((item) => `- ${inlineText(item)}`).join("\n");
        case "route":
          return `${block.name} (${block.path})`;
      }
    })
    .join("\n\n");
}

/**
 * The source a reply names, rebuilt from its key here rather than taken as
 * sent: only a guide or a chapter that exists becomes a link or a name.
 */
export function knownSource(source: AbacusSource | undefined): AbacusSource {
  if (!source || typeof source !== "object") return null;
  if (source.kind === "guide") return abacusSourceFromKey(source.id);
  if (source.kind === "manual") return abacusSourceFromKey(source.file);
  return null;
}

/** How many conversations the database keeps per person per company (0190; ABACUS_KEPT_CONVERSATIONS on the server). */
export const ABACUS_KEPT = 20;

/** One question in the thread and what came back for it. */
export interface AbacusTurn {
  /** A message id once saved; a local key while it is being asked. */
  key: string;
  question: string;
  /** The screen it was asked from. */
  route: string;
  askedAt: string;
  status: "waiting" | "answered" | "limit" | "failed";
  answer: string;
  source: AbacusSource;
  covered: boolean;
  /** Null when the answer was not saved, which also means it cannot be rated. */
  messageId: string | null;
  saved: boolean;
  rating: -1 | 1 | null;
  answeredAt: string | null;
  /** What the server said when no answer came back. */
  error: string | null;
}
