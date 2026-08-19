/**
 * Raw colour values. These carry no meaning on their own — `red700` says what
 * the colour is, never what it is for. Meaning is assigned once, in tokens.ts,
 * so a screen that wants "an overdue amount" cannot pick a different red from
 * the one every other screen uses.
 *
 * To ensure all screens use consistent meanings, application code must import
 * colours only through tokens.ts. This module's tests are exempt: they import
 * from here to verify that every semantic token resolves to a palette entry.
 *
 * The dark half was added with the theme switch. A dark theme is not the light
 * one inverted: the same teal that reads well on white is 2.3:1 on a dark
 * surface, far under AA, so dark needs its own lighter entries rather than a
 * filter over these. Every entry below is used by a token in tokens.ts; none
 * is here speculatively.
 */
export const PALETTE = {
  // Brand and chrome
  teal700: "#0f766e",
  slate900: "#0f172a",
  slate600: "#475569",
  slate400: "#94a3b8",
  slate200: "#e2e8f0",
  slate100: "#f1f5f9",
  slate50: "#f6f7f9",
  // Added with the shell conversion. The stylesheet already used every one of
  // these; they were literals repeated by hand, not new colour.
  slate50Bright: "#f8fafc",
  slate500: "#64748b",
  slate700: "#334155",
  slate800: "#1e293b",
  slate800Blue: "#263449",
  mist300: "#e5eaf0",
  white: "#ffffff",

  // Intent
  red700: "#b91c1c",
  green700: "#15803d",
  amber700: "#b45309",
  orange700: "#c2410c",
  blue700: "#1d4ed8",
  violet600: "#7c3aed",
  sky700: "#0369a1",

  // --- Dark theme -----------------------------------------------------------
  // Surfaces, darkest first. The sider is darker than the page and the page is
  // darker than a card, so the same depth order the light theme has by
  // lightness survives inversion instead of flattening into one slab.
  ink950: "#0a101c",
  ink900: "#0b1220",
  ink800: "#131c2e",
  ink700: "#1b2740",
  ink600: "#2a3854",

  // Text and lines on those surfaces.
  mist100: "#f1f5f9",
  mist200: "#e2e8f0",
  mist400: "#94a3b8",

  // Intent, lightened for a dark background. Each was chosen to clear 4.5:1
  // against ink800, which the contrast test asserts rather than trusts.
  teal400: "#2dd4bf",
  red400: "#f87171",
  green400: "#4ade80",
  amber400: "#fbbf24",
  blue400: "#60a5fa",
  orange400: "#fb923c",
  violet400: "#c4b5fd",
  sky400: "#38bdf8",
} as const;

export type PaletteKey = keyof typeof PALETTE;
