/**
 * How a version is named and printed (v3.0.2).
 *
 * Its own small module, so the screens that only print or look up a version
 * (the guide's search, the Ask AI panel, the report dialog) do not carry the
 * whole release history with them.
 *
 * From v3.0 (3 November 2026) a version is MAJOR.MINOR.PATCH, shown with a v:
 * v3.0, v3.0.1, v3.0.2, and v3.1 for the next larger step. Before it a version
 * had two digits after the point (2.98, 2.99), and those keep their numbers.
 */

/** A version as the screens print it: v3.0.1, v2.98. */
export function versionLabel(version: string): string {
  return `v${version}`;
}

/**
 * The names the first two v3 releases went out under (3.00 and 3.01), and the
 * names they have now. A browser that read them under the old name remembers
 * that name; without this it would match no release, and every release would
 * be shown to it as unread.
 */
export const LEGACY_VERSION_NAMES: Readonly<Record<string, string>> = { "3.00": "3.0", "3.01": "3.0.1" };

/** A version under its current name, whichever name it was given. */
export function currentVersionName(version: string): string {
  return LEGACY_VERSION_NAMES[version] ?? version;
}
