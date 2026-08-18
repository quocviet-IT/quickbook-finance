import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * No `pagination={{ pageSize: <number> }}` anywhere under app/ or components/.
 *
 * RQ-04 (Bank Transactions) and its nineteen-site follow-up were the same bug
 * written at nineteen call sites: a literal `pageSize` inside the `pagination`
 * prop. Ant Design's Pagination treats a *defined* `pagination.pageSize` prop
 * as controlled — `useControlledState` in `@rc-component/pagination` always
 * prefers the prop over its own internal state, on every render — so a fresh
 * object literal rebuilt on each render pins the table back to whatever number
 * is written at the call site, no matter what the reader picks from the size
 * changer. The dropdown moves; the table does not.
 *
 * This is the guard against a twentieth: it does not care whether a screen
 * uses DataTable, ReportTable or Ant Design's Table directly, or whether the
 * literal sits behind a ternary (`cond ? { pageSize: 10 } : false}`, as two
 * of the nineteen did) — every one of those shapes still hands Ant Design a
 * fresh literal on every render, and every one of them matches below.
 */
function bugPattern(): RegExp {
  // A bounded window (not `.*`, and not unbounded `[\s\S]*`) so this survives
  // Prettier wrapping `pagination={{` and `pageSize: N` onto separate lines —
  // the shape all nineteen sites had before this sweep — without reaching far
  // enough into an unrelated `pageSize` number somewhere else in a large file.
  // 200 characters is generous for a JSX prop object; every real hit found by
  // this pattern during the sweep matched within the first 40.
  return /pagination=\{[\s\S]{0,200}?pageSize:\s*\d+/;
}

const ROOT = process.cwd();

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const files = [...sourceFiles(join(ROOT, "app")), ...sourceFiles(join(ROOT, "components"))].map(
  (file) => ({
    path: relative(ROOT, file).replaceAll("\\", "/"),
    source: readFileSync(file, "utf8"),
  }),
);

describe("table pagination guard", () => {
  it("finds files to check", () => {
    expect(files.length).toBeGreaterThan(150);
  });

  it("recognises the bug shape, including behind a ternary and across lines", () => {
    // The mistakes this guard exists to catch, and the correct shape it must
    // not flag — proven against synthetic strings before trusting it against
    // 266 real files.
    expect(bugPattern().test('pagination={{ pageSize: 20 }}')).toBe(true);
    expect(bugPattern().test('pagination={{ pageSize: 20, showSizeChanger: true }}')).toBe(true);
    expect(bugPattern().test('pagination={rows.length > 10 ? { pageSize: 10 } : false}')).toBe(
      true,
    );
    expect(bugPattern().test('pagination={{\n  pageSize: 20,\n}}')).toBe(true);
    // The fixed shape: pageSize is a variable, not a literal number, so no
    // digit ever follows the colon.
    expect(bugPattern().test('pagination={clientTablePagination(pageSize, setPageSize, opts)}')).toBe(
      false,
    );
    expect(bugPattern().test('pagination={resolved.pagination}')).toBe(false);
    expect(bugPattern().test('pagination={false}')).toBe(false);
  });

  it("hands Ant Design a literal pageSize nowhere under app/ or components/", () => {
    // Fails the instant any call site — new or reverted — writes
    // `pagination={{ pageSize: <number> ... }}` again, in any of the shapes
    // above. This is what stops the twentieth occurrence from shipping.
    const offenders = files
      .filter(({ source }) => bugPattern().test(source))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });
});
