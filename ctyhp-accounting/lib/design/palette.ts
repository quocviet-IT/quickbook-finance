/**
 * Raw colour values. These carry no meaning on their own — `red700` says what
 * the colour is, never what it is for. Meaning is assigned once, in tokens.ts,
 * so a screen that wants "an overdue amount" cannot pick a different red from
 * the one every other screen uses.
 *
 * Nothing outside tokens.ts may import this file.
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
  white: "#ffffff",

  // Intent
  red700: "#b91c1c",
  green700: "#15803d",
  amber700: "#b45309",
  orange700: "#c2410c",
  blue700: "#1d4ed8",
  violet600: "#7c3aed",
  sky700: "#0369a1",
} as const;

export type PaletteKey = keyof typeof PALETTE;
