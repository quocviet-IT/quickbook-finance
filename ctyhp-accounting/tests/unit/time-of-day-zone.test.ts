import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { timeOnly } from "@/components/work-surface/DataStateNote";

/**
 * "Computed at 09:05 AM" is drawn on the server and again in the browser. If the
 * time of day depends on the machine's own zone the two texts differ and React
 * throws #418 on every overview page. These pin the cure: the company's zone is
 * always named, and nothing in the surface components reads the machine's.
 */

const INSTANT = "2026-10-16T13:05:00Z";
const originalTz = process.env.TZ;

afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe("timeOnly", () => {
  it("prints the company's local time", () => {
    expect(timeOnly(INSTANT, "America/New_York")).toBe("09:05 AM");
    expect(timeOnly(INSTANT, "UTC")).toBe("01:05 PM");
    expect(timeOnly(INSTANT, "Asia/Ho_Chi_Minh")).toBe("08:05 PM");
  });

  it("prints the same text whatever zone the machine is in", () => {
    const seen = new Set<string>();
    for (const machineZone of ["UTC", "America/Los_Angeles", "Asia/Tokyo", "Pacific/Kiritimati"]) {
      process.env.TZ = machineZone;
      seen.add(timeOnly(INSTANT, "America/New_York"));
    }
    expect([...seen]).toEqual(["09:05 AM"]);
  });

  it("follows daylight saving in the company's zone", () => {
    expect(timeOnly("2026-01-15T13:05:00Z", "America/New_York")).toBe("08:05 AM");
    expect(timeOnly("2026-07-15T13:05:00Z", "America/New_York")).toBe("09:05 AM");
  });
});

/**
 * Time-of-day APIs that read the machine's own zone unless told otherwise.
 * `toLocaleString`/`toLocaleDateString` on a number is fine; on a Date it is not,
 * so only the Date-shaped uses are matched.
 */
const SURFACE_DIRECTORIES = [
  "components/work-surface",
  "components/accounting-dashboard",
  "components/banking-surface",
  "components/sales-surface",
  "components/purchases-surface",
  "components/inventory-surface",
];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry) ? [path] : [];
  });
}

/** Strip comments so prose that names these APIs is not read as a call. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("the surface components never read the machine's time zone", () => {
  const files = SURFACE_DIRECTORIES.flatMap(sourceFiles);

  it("scans something", () => {
    expect(files.length).toBeGreaterThan(15);
  });

  it("calls no Date method that formats or reads local time", () => {
    const offenders = files.filter((file) =>
      /toLocaleTimeString|\.getHours\(|\.getMinutes\(|\.getSeconds\(|toLocaleDateString\(|new Date\([^)]*\)\.toLocaleString\(/.test(
        code(readFileSync(file, "utf8")),
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("gives every Intl.DateTimeFormat an explicit timeZone", () => {
    const offenders = files.filter((file) => {
      const text = code(readFileSync(file, "utf8"));
      const calls = text.match(/Intl\.DateTimeFormat\([\s\S]*?\)\s*(?:\.|;|,)/g) ?? [];
      return calls.some((call) => !/timeZone/.test(call));
    });
    expect(offenders).toEqual([]);
  });
});
