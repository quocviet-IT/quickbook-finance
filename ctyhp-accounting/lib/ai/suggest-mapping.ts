import "server-only";
import { askProvider, AiNotConfiguredError, AiProviderError } from "./provider";
import {
  buildMappingQuestion,
  mergeMapping,
  parseMappingReply,
  MAPPING_SYSTEM_PROMPT,
  type MergedMapping,
} from "./mapping-prompt";
import { proposeMapping, type ImportTarget } from "@/lib/domain/import-mapping";

export interface SuggestedMapping extends MergedMapping {
  /** Shown beside the mapping when there is something a person should know. */
  note: string | null;
}

/**
 * Which column is which, with the model filling what the alias matcher could not.
 *
 * The model does not decide anything. Its answer is filtered by
 * `parseMappingReply`, merged under the deterministic proposal by `mergeMapping`,
 * and then put on screen for confirmation exactly as before — a person still
 * approves every column before one row is read.
 *
 * Nor is it depended on. Unreachable, unconfigured, slow or talking nonsense all
 * land on `proposeMapping` alone, which is what this screen has always used. The
 * worst outcome of the model being down is today's behaviour.
 */
export async function suggestMapping(
  headers: readonly string[],
  target: ImportTarget,
  options: { signal?: AbortSignal } = {},
): Promise<SuggestedMapping> {
  const baseline = proposeMapping(headers, target);
  const fallback = (note: string | null): SuggestedMapping => ({
    ...baseline,
    aiFields: [],
    note,
  });

  if (headers.length === 0) return fallback(null);

  let answer;
  try {
    answer = await askProvider({
      system: MAPPING_SYSTEM_PROMPT,
      question: buildMappingQuestion(headers, target),
      // Generous on purpose. A reasoning model — gemini-2.5-flash is the one
      // configured here — spends output tokens thinking before it writes, and
      // the OpenAI-compatible layer counts those against the same ceiling. At
      // 500 the JSON was cut off mid-object every time: the guards caught it and
      // fell back to name matching, so nothing broke, but the feature never
      // once did anything. The reply itself is a few hundred bytes.
      maxOutputTokens: 3000,
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof AiNotConfiguredError) return fallback(null);
    if (error instanceof AiProviderError) {
      return fallback("The model could not be reached, so columns were matched by name only.");
    }
    throw error;
  }

  const suggested = parseMappingReply(answer.text, target, headers.length);
  if (Object.keys(suggested).length === 0) {
    return fallback("The model returned nothing usable, so columns were matched by name only.");
  }

  const merged = mergeMapping(baseline, suggested, headers, target);
  return {
    ...merged,
    note:
      merged.aiFields.length > 0
        ? `${merged.aiFields.length} column${merged.aiFields.length === 1 ? "" : "s"} matched by the model — check them before importing.`
        : null,
  };
}
