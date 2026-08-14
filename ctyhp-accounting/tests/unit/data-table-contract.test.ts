// Imports table-data, never DataTable. See the note above: importing DataTable
// costs 55 seconds because it pulls Ant Design's runtime into a node process.
import { describe, expect, it } from "vitest";
import { resolveTableData } from "@/components/ui/table-data";

interface Row {
  id: string;
}

const rows: Row[] = [{ id: "a" }, { id: "b" }];

describe("the two-mode data contract", () => {
  it("pages locally when given rows", () => {
    const resolved = resolveTableData<Row>({ rows });
    expect(resolved.data).toEqual(rows);
    expect(resolved.pagination).toMatchObject({ pageSize: 20 });
    // No total: antd counts the rows it was given.
    expect((resolved.pagination as { total?: number }).total).toBeUndefined();
  });

  it("pages on the server when given a page", () => {
    const resolved = resolveTableData<Row>({
      page: { rows, total: 240, pageIndex: 3, pageSize: 50 },
    });
    expect(resolved.data).toEqual(rows);
    expect(resolved.pagination).toMatchObject({ total: 240, current: 3, pageSize: 50 });
  });

  it("still accepts dataSource, because 33 screens already pass it", () => {
    // This contract is being added, not swapped in. A change that broke the
    // existing callers would have to migrate 33 files in the same commit.
    const resolved = resolveTableData<Row>({ dataSource: rows });
    expect(resolved.data).toEqual(rows);
  });

  it("honours pagination={false} on a list bounded by construction", () => {
    expect(resolveTableData<Row>({ rows, pagination: false }).pagination).toBe(false);
  });

  it("refuses both modes at once rather than silently preferring one", () => {
    // Two sources of truth for what is on screen is exactly the bug this
    // contract exists to prevent, so it fails loudly at the call site.
    expect(() =>
      resolveTableData<Row>({ rows, page: { rows, total: 2, pageIndex: 1, pageSize: 20 } }),
    ).toThrow(/rows.*page|page.*rows/i);
  });
});
