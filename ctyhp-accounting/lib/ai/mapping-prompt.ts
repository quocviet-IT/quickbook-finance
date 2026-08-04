/**
 * What the model is asked about an import file, and how little of its answer is
 * believed. Pure and unit-tested, following `ask-prompt.ts`: what leaves this
 * system and what is trusted coming back are product decisions, not details of
 * whichever provider is configured.
 *
 * The model is sent column *headers* and the field list. It is not sent data.
 * Mapping is a naming problem and headers are the names; a sample row would push
 * customer names and amounts to a third party for a marginal gain, in a system
 * that keeps taxpayer identifiers out of even its own audit log.
 */
import { fieldsFor, type ImportTarget, type ProposedMapping } from "@/lib/domain/import-mapping";

export const MAPPING_SYSTEM_PROMPT = `You map spreadsheet column headers onto the fields of an accounting import.

Reply with JSON only, no prose and no code fence, in this exact shape:
{"mapping": {"<field_key>": <zero-based column index or null>}}

Rules:
- Use only the field keys given to you. Invent nothing.
- Use each column index at most once.
- Use null when no column plausibly matches a field.
- Judge by the meaning of the header, not its position.
- A header you cannot place is simply left out; do not force it.`;

/** Headers and field list only — never a row of the file. */
export function buildMappingQuestion(headers: readonly string[], target: ImportTarget): string {
  const fields = fieldsFor(target)
    .map((field) => {
      const parts = [`- ${field.key}: ${field.label}`];
      if (field.required) parts.push("(required)");
      if (field.hint) parts.push(`— ${field.hint}`);
      return parts.join(" ");
    })
    .join("\n");
  const columns = headers.map((header, index) => `${index}: ${header}`).join("\n");
  return `Fields:\n${fields}\n\nColumns in the file:\n${columns}`;
}

/**
 * Pull the mapping out of a reply and discard everything that cannot be true.
 *
 * A field name outside the spec, an index the file does not have, a fraction, a
 * string, a column already used — all dropped. The model gets no benefit of the
 * doubt, because a wrong column here bills the wrong amount to the right
 * customer and looks entirely plausible on screen.
 */
export function parseMappingReply(
  text: string,
  target: ImportTarget,
  headerCount: number,
): Record<string, number> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return {};

  let body: unknown;
  try {
    body = JSON.parse(text.slice(start, end + 1));
  } catch {
    return {};
  }

  const raw = (body as { mapping?: unknown })?.mapping;
  if (!raw || typeof raw !== "object") return {};

  const allowed = new Set(fieldsFor(target).map((field) => field.key));
  const used = new Set<number>();
  const result: Record<string, number> = {};

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!allowed.has(key)) continue;
    if (typeof value !== "number" || !Number.isInteger(value)) continue;
    if (value < 0 || value >= headerCount) continue;
    if (used.has(value)) continue;
    used.add(value);
    result[key] = value;
  }
  return result;
}

export interface MergedMapping extends ProposedMapping {
  /** Fields the model filled that the alias matcher had left empty. */
  aiFields: string[];
}

/**
 * The deterministic proposal, with the model filling only its gaps.
 *
 * Where the alias matcher found a column it keeps it: it is reproducible, and a
 * scored hit on "Invoice No" is not improved on by a guess. This ordering is
 * what makes the model an improvement on the fallback rather than a dependency
 * of it — take the model away and the result is exactly today's behaviour.
 */
export function mergeMapping(
  baseline: ProposedMapping,
  suggested: Record<string, number>,
  headers: readonly string[],
  target: ImportTarget,
): MergedMapping {
  const columns = { ...baseline.columns };
  const taken = new Set(
    Object.values(columns).filter((value): value is number => value !== null),
  );
  const aiFields: string[] = [];

  for (const [key, index] of Object.entries(suggested)) {
    if (columns[key] !== null && columns[key] !== undefined) continue;
    if (taken.has(index)) continue;
    columns[key] = index;
    taken.add(index);
    aiFields.push(key);
  }

  const fields = fieldsFor(target);
  return {
    columns,
    unmapped: headers.filter((_, index) => !taken.has(index)),
    missingRequired: fields
      .filter((field) => field.required && columns[field.key] === null)
      .map((field) => field.key),
    aiFields,
  };
}
