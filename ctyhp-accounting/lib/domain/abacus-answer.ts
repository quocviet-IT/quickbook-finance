/**
 * Reading Abacus's answer.
 *
 * Pure. The model is told to end every answer with one line, `Source: <id>`,
 * naming the guide (or manual chapter) it answered from, or `none` when the
 * guides do not cover the question. This module takes that line off the end,
 * and turns the rest of the text into blocks the panel can draw: paragraphs,
 * numbered steps, bullets, and links to screens that exist.
 */

import { MANUAL_CHAPTERS, MANUAL_CONTEXT } from "@/lib/ai/manual-context.generated";
import { GUIDE_FLOWS } from "./system-guide";
import { guideKnownRoutes, normaliseRoute } from "./screen-context";
import { screenName, screenPath } from "./screen-names";

export type AbacusSource =
  | { kind: "guide"; id: string; title: string; href: string }
  | { kind: "manual"; file: string; title: string }
  | null;

export interface ParsedAbacusAnswer {
  body: string;
  source: AbacusSource;
  covered: boolean;
  /** What the server stores in ai_message.source. */
  sourceKey: string | null;
}

/** Chapter file name to its first "# " heading, read once from the bundled manual. */
const MANUAL_TITLES: ReadonlyMap<string, string> = (() => {
  const titles = new Map<string, string>();
  const pattern = /<chapter file="([^"]+)">\s*\n#\s+([^\n]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(MANUAL_CONTEXT)) !== null) titles.set(match[1], match[2].trim());
  return titles;
})();

const NONE_KEY = "none";

/** A key the model wrote, cleaned of the decoration models like to add. */
function cleanKey(raw: string): string {
  return raw
    .trim()
    .replace(/^[`'"[(<*_\s]+/, "")
    .replace(/[`'"\])>*_\s.]+$/, "")
    .trim();
}

/** The canonical key (guide id, chapter file or "none") for what was written, or null. */
function canonicalKey(raw: string): string | null {
  const cleaned = cleanKey(raw);
  if (!cleaned) return null;
  const lower = cleaned.toLowerCase();
  if (lower === NONE_KEY) return NONE_KEY;
  const flow = GUIDE_FLOWS.find((f) => f.id.toLowerCase() === lower);
  if (flow) return flow.id;
  const withoutExt = lower.replace(/\.md$/, "");
  const chapter = MANUAL_CHAPTERS.find((file) => file.toLowerCase().replace(/\.md$/, "") === withoutExt);
  return chapter ?? null;
}

/** The source a stored key stands for, or null for no source (or "none", or a key that no longer exists). */
export function abacusSourceFromKey(key: string | null): AbacusSource {
  if (!key || key === NONE_KEY) return null;
  const flow = GUIDE_FLOWS.find((f) => f.id === key);
  if (flow) return { kind: "guide", id: flow.id, title: flow.title, href: `/guide/${flow.id}` };
  if (MANUAL_CHAPTERS.includes(key)) {
    return { kind: "manual", file: key, title: MANUAL_TITLES.get(key) ?? key.replace(/\.md$/, "").replace(/_/g, " ") };
  }
  return null;
}

/** False only when the answer said the guides do not cover the question. */
export function abacusCoveredFromKey(key: string | null): boolean {
  return key !== NONE_KEY;
}

const SOURCE_LINE = /^\s*source\s*:\s*(.+?)\s*\.?\s*$/i;

export function parseAbacusAnswer(raw: string): ParsedAbacusAnswer {
  const lines = raw.split(/\r?\n/);
  let index = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (SOURCE_LINE.test(lines[i])) {
      index = i;
      break;
    }
  }
  if (index < 0) return { body: raw, source: null, covered: true, sourceKey: null };

  const key = canonicalKey((SOURCE_LINE.exec(lines[index]) as RegExpExecArray)[1]);
  if (key === null) return { body: raw, source: null, covered: true, sourceKey: null };

  const body = [...lines.slice(0, index), ...lines.slice(index + 1)].join("\n").trim();
  return {
    body,
    source: abacusSourceFromKey(key),
    covered: abacusCoveredFromKey(key),
    sourceKey: key,
  };
}

// --- Drawing the body --------------------------------------------------------

export type AbacusInline =
  | { kind: "text"; text: string }
  | { kind: "control"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "route"; route: string; name: string };

export type AbacusBlock =
  | { kind: "paragraph"; inlines: AbacusInline[] }
  | { kind: "steps"; items: AbacusInline[][] }
  | { kind: "bullets"; items: AbacusInline[][] }
  | { kind: "route"; route: string; name: string; path: string };

const INLINE = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\[(\/[a-z0-9\-/]*)\]/gi;

function inlines(text: string, known: readonly string[]): AbacusInline[] {
  const out: AbacusInline[] = [];
  const pushText = (value: string) => {
    if (!value) return;
    const last = out[out.length - 1];
    if (last && last.kind === "text") last.text += value;
    else out.push({ kind: "text", text: value });
  };
  let last = 0;
  INLINE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE.exec(text)) !== null) {
    pushText(text.slice(last, match.index));
    last = match.index + match[0].length;
    if (match[1] !== undefined) out.push({ kind: "control", text: match[1] });
    else if (match[2] !== undefined) out.push({ kind: "strong", text: match[2] });
    else {
      const route = normaliseRoute(match[3]);
      if (known.includes(route)) out.push({ kind: "route", route, name: screenName(route) });
      else pushText(match[0]);
    }
  }
  pushText(text.slice(last));
  return out;
}

const STEP_LINE = /^\s*\d+\s*[.)]\s+(.*\S)\s*$/;
const BULLET_LINE = /^\s*[-*•]\s+(.*\S)\s*$/;
const ROUTE_ONLY = /^\s*\[(\/[a-z0-9\-/]*)\]\s*$/i;

export function abacusBlocks(body: string, knownRoutes: readonly string[] = guideKnownRoutes()): AbacusBlock[] {
  const blocks: AbacusBlock[] = [];
  let paragraph: string[] = [];
  let list: { kind: "steps" | "bullets"; items: AbacusInline[][] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length > 0) blocks.push({ kind: "paragraph", inlines: inlines(paragraph.join(" "), knownRoutes) });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };

  for (const line of body.split(/\r?\n/)) {
    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }
    const step = STEP_LINE.exec(line);
    const bullet = step ? null : BULLET_LINE.exec(line);
    if (step || bullet) {
      flushParagraph();
      const kind = step ? "steps" : "bullets";
      if (list && list.kind !== kind) flushList();
      if (!list) list = { kind, items: [] };
      list.items.push(inlines((step ?? (bullet as RegExpExecArray))[1], knownRoutes));
      continue;
    }
    flushList();
    const only = ROUTE_ONLY.exec(line);
    if (only) {
      const route = normaliseRoute(only[1]);
      if (knownRoutes.includes(route)) {
        flushParagraph();
        blocks.push({ kind: "route", route, name: screenName(route), path: screenPath(route) });
        continue;
      }
    }
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  return blocks;
}
