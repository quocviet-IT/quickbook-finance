/**
 * Whether the floating help controls are collapsed.
 *
 * The cluster sits over the bottom-right of every page, which is where a table's
 * last rows, its totals and its pager end up. Collapsing has to survive
 * navigation and a reload — a control that re-covers the numbers on every page
 * change has not been collapsed at all.
 *
 * Exposed as an external store so the component can read it with
 * `useSyncExternalStore`: the server has no stored choice, and that hook is how
 * a browser-only value reaches a rendered tree without a hydration mismatch.
 */

const COLLAPSED_KEY = "ctyhp.assistant-launcher.collapsed";

const listeners = new Set<() => void>();

export function isLauncherCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === "true";
  } catch {
    // Private-mode browsers throw on localStorage; the launcher still works,
    // it just forgets the choice.
    return false;
  }
}

/** What the server renders: expanded, so the controls are never lost to SSR. */
export function launcherCollapsedServerSnapshot(): boolean {
  return false;
}

export function setLauncherCollapsed(collapsed: boolean): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(COLLAPSED_KEY, String(collapsed));
    } catch {
      /* nothing to persist to; the current page still respects the choice */
    }
  }
  for (const listener of listeners) listener();
}

/** Also follows the other tabs: `storage` fires there, not in the writing tab. */
export function subscribeLauncherCollapsed(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === COLLAPSED_KEY) listener();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}
