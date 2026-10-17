import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The Exceptions screen is a client component that imports the exceptions domain,
 * and through it the statement-overrides domain. In 2.11 the second reached the
 * PDF statement reader for one date helper, which put the reader in the browser
 * bundle and the all-routes total over its ceiling. Neither module may import
 * the PDF modules.
 */
describe("the domain the Exceptions screen ships to the browser", () => {
  for (const path of ["lib/domain/exceptions.ts", "lib/domain/statement-overrides.ts"]) {
    it(`${path} imports no PDF statement module`, () => {
      const source = readFileSync(join(process.cwd(), path), "utf8");
      expect(source).not.toMatch(/from\s+["'][^"']*pdf-statement/);
    });
  }
});
