"use server";
import { createSupabaseServerClient } from "@/lib/db/server";

export interface SearchHit {
  kind: string;
  id: string;
  label: string;
  sublabel: string | null;
  href: string;
}

export interface SearchResult {
  ok: boolean;
  error?: string;
  data?: SearchHit[];
}

/**
 * Global search for the top bar. The RPC runs with the caller's own rights, so
 * RLS decides what is visible — a suspended user finds nothing.
 */
export async function globalSearchAction(query: string): Promise<SearchResult> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return { ok: true, data: [] };
  try {
    const sb = await createSupabaseServerClient();
    const { data, error } = await sb.rpc("acc_global_search", { p_query: trimmed, p_limit: 10 });
    if (error) return { ok: false, error: error.message };
    return {
      ok: true,
      data: ((data ?? []) as Record<string, unknown>[]).map((r) => ({
        kind: String(r.kind),
        id: String(r.id),
        label: String(r.label ?? ""),
        sublabel: (r.sublabel as string | null) ?? null,
        href: String(r.href),
      })),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Search failed" };
  }
}
