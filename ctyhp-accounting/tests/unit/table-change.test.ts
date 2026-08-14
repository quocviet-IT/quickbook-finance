import { describe, expect, it } from "vitest";
import { tableStateFromAntdChange } from "@/components/ui/table-change";
import { DEFAULT_TABLE_STATE } from "@/lib/domain/table-url-state";

interface Row {
  due_date: string;
}

describe("reading a table interaction as table state", () => {
  it("takes the page and the page size from the pager", () => {
    const patch = tableStateFromAntdChange<Row>({ current: 3, pageSize: 50 }, {});
    expect(patch.page).toBe(3);
    expect(patch.pageSize).toBe(50);
  });

  it("takes the sorted column and its direction", () => {
    const patch = tableStateFromAntdChange<Row>(
      { current: 1, pageSize: 20 },
      { columnKey: "due_date", field: "due_date", order: "descend" },
    );
    expect(patch.sort).toBe("due_date");
    expect(patch.order).toBe("descend");
  });

  it("reads a cleared sort as no sort, even though the column name is still there", () => {
    // This is the case that decides whether a table can ever stop being
    // sorted. Ant Design empties `order` and leaves `field` behind, so a
    // reading based on the column name would sort for good.
    const patch = tableStateFromAntdChange<Row>(
      { current: 1, pageSize: 20 },
      { columnKey: "due_date", field: "due_date", order: undefined },
    );
    expect(patch.sort).toBeNull();
    expect(patch.order).toBeNull();
  });

  it("takes the first column of a multi-column sort, because these screens sort by one", () => {
    const patch = tableStateFromAntdChange<Row>({ current: 1, pageSize: 20 }, [
      { columnKey: "due_date", order: "ascend" },
      { columnKey: "amount", order: "descend" },
    ]);
    expect(patch.sort).toBe("due_date");
    expect(patch.order).toBe("ascend");
  });

  it("falls back to the defaults when the pager says nothing", () => {
    const patch = tableStateFromAntdChange<Row>({}, {});
    expect(patch.page).toBe(DEFAULT_TABLE_STATE.page);
    expect(patch.pageSize).toBe(DEFAULT_TABLE_STATE.pageSize);
  });
});
