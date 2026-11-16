"use client";
import { createContext, useContext, type PropsWithChildren } from "react";

/**
 * The open company's slug, for code in the browser that keeps something per
 * company. The company is chosen by an httpOnly cookie the browser cannot
 * read; the signed-in layout resolves it on the server and `AppShell`
 * provides it here, around every page and every page's loading outline.
 * Null when no company is open.
 */
const ActiveCompanySlug = createContext<string | null>(null);

export function ActiveCompanyProvider({ slug, children }: PropsWithChildren<{ slug: string | null }>) {
  return <ActiveCompanySlug.Provider value={slug}>{children}</ActiveCompanySlug.Provider>;
}

/** The open company's slug; null when no company is open. */
export function useActiveCompanySlug(): string | null {
  return useContext(ActiveCompanySlug);
}
