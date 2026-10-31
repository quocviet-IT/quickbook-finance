import { z } from "zod";

/**
 * Zod, as code that also runs in the browser imports it.
 *
 * Zod 4 compiles object parsers with `Function` where it can, and finds out by
 * trying once. Under the Content-Security-Policy (2.95) the browser refuses
 * the try, as it should, and reports a violation on every page with a form;
 * parsing then works without it anyway. Saying so up front skips the try. The
 * server is not under the policy and keeps the faster parsers.
 *
 * The setting is global to zod, so it holds for every schema once this module
 * has loaded; anything under lib/ or components/ imports zod from here
 * (tests/unit/zod-in-the-browser.test.ts).
 */
if (typeof window !== "undefined") z.config({ jitless: true });

export { z };
