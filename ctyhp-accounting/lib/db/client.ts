"use client";
import { createBrowserClient } from "@supabase/ssr";

/** Supabase client for Client Components (browser). RLS applies. */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
