/**
 * The time zone a company has until it chooses one. The company settings schema
 * defaults to the same value (`lib/domain/schemas.ts`, which is too heavy to
 * import into client code); every place that needs a fallback uses this one.
 */
export const DEFAULT_TIME_ZONE = "America/New_York";
