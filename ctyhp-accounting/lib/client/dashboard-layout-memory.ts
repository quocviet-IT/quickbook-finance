/**
 * The Overview layout this browser last saw saved, per company (3.0.40).
 *
 * The layout itself is kept per person per company in the database (0198),
 * but the dashboard's loading outline is drawn before anything is read, so it
 * would always draw the Standard Overview and the page would jump when a
 * person's own arrived. The dashboard remembers the saved layout here, and
 * the outline reads it back.
 *
 * Only a shape to draw while loading: what the page shows always comes from
 * the database. Every access is in try/catch, because a private-mode browser
 * throws on localStorage; then nothing is remembered and the outline is the
 * Standard one, as before.
 *
 * Exposed as an external store so the outline can read it with
 * `useSyncExternalStore`: the server has no remembered layout, and that hook is
 * how a browser-only value reaches a rendered tree without a hydration
 * mismatch.
 */
import { normalizeOverview, type OverviewLayout } from "@/lib/domain/dashboard-home/layout";

const KEY_PREFIX = "onebook.dashboard.overview.";

/** Where a company's layout is remembered: one key per company, by its slug. */
export function overviewLayoutKey(slug: string): string {
  return `${KEY_PREFIX}${slug}`;
}

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();

/** Keeps the company's saved layout: its three lists, as JSON. */
export function rememberOverviewLayout(slug: string, layout: OverviewLayout): void {
  const storage = browserStorage();
  if (storage) {
    try {
      storage.setItem(overviewLayoutKey(slug), JSON.stringify({ order: layout.order, shown: layout.shown, wide: layout.wide }));
    } catch {
      /* Nothing to keep it in; the outline stays the Standard one. */
    }
  }
  for (const listener of listeners) listener();
}

/**
 * The last text read and the layout made from it. `useSyncExternalStore`
 * compares snapshots by identity, so the same stored text must give back the
 * same object, or every render would read as a change.
 */
let lastRead: { key: string; text: string; layout: OverviewLayout } | null = null;

/**
 * The company's remembered layout, through `normalizeOverview` so a layout
 * kept before a card existed still draws; null when none is remembered or it
 * cannot be read.
 */
export function recallOverviewLayout(slug: string): OverviewLayout | null {
  const storage = browserStorage();
  if (!storage) return null;
  const key = overviewLayoutKey(slug);
  let text: string | null;
  try {
    text = storage.getItem(key);
  } catch {
    return null;
  }
  if (text === null) return null;
  if (lastRead && lastRead.key === key && lastRead.text === text) return lastRead.layout;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const layout = normalizeOverview(parsed);
  lastRead = { key, text, layout };
  return layout;
}

/** For `useSyncExternalStore`: a layout kept in this tab, and the `storage` event for one kept in another. */
export function subscribeOverviewLayout(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(KEY_PREFIX)) listener();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}
