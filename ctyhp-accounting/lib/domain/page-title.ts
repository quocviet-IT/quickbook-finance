import type { Metadata } from "next";
import { screenName } from "./screen-names";

/**
 * What a browser tab says (3.0.32).
 *
 * Every page used to be titled "One Book", so a reader with Invoices,
 * Customers and a report open in three tabs saw three tabs called the same,
 * and a screen reader announced the same words on every page it reached. The
 * root layout's template adds "· One Book"; the page says which screen it is,
 * in the words its menu uses (screenName), so the tab, the menu, the guide and
 * Abacus all call it one thing.
 */
export function pageMetadata(route: string): Metadata {
  return { title: screenName(route) };
}

/**
 * A record's own page: the record first, then the screen it belongs to —
 * "Alder Grove Ventures · Customers · One Book". Without the record (it could
 * not be read) the tab still names the screen. `screen` is a route ("/customers")
 * or, for a page no menu holds, the words themselves ("Statement file").
 */
export function recordMetadata(record: string | null | undefined, screen: string): Metadata {
  return { title: recordTitle(record, screen) };
}

/** The words of recordMetadata's title, for a test or a caller that needs the string. */
export function recordTitle(record: string | null | undefined, where: string): string {
  const screen = where.startsWith("/") ? screenName(where) : where;
  const named = record?.trim();
  return named ? `${named} · ${screen}` : screen;
}
