import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DataTable from "@/components/ui/DataTable";

/**
 * A table that is still loading has not found nothing. Ant Design keeps the
 * empty placeholder under its spinner, so "No bank transactions" read through
 * the spinner while the lines were on their way — and the filter bar beside it
 * said "0 results" — on the screen people open for exactly those lines.
 */
const columns = [{ title: "Description", dataIndex: "description", key: "description" }];
const render = (loading: boolean) =>
  renderToString(
    createElement(DataTable<{ id: string; description: string }>, {
      rowKey: "id",
      columns,
      dataSource: [],
      loading,
      emptyTitle: "No bank transactions",
    }),
  );

describe("a loading table does not say it is empty", () => {
  it("shows no empty message while loading", () => {
    expect(render(true)).not.toContain("No bank transactions");
  });

  it("still says so once it has loaded and found nothing", () => {
    expect(render(false)).toContain("No bank transactions");
  });

  it("the registers under the bank lines say they are loading until their first answer", () => {
    // They now queue behind the lines in Next's one-at-a-time action queue, so
    // a register that claimed to be empty before its data came would claim it
    // for longer than before.
    const imports = readFileSync(join(process.cwd(), "app/(app)/banking/BankImportList.tsx"), "utf8");
    expect(imports).toMatch(/const \[loaded, setLoaded\] = useState\(false\)/);
    expect(imports).toMatch(/loading=\{!loaded\}/);
    expect(imports).toMatch(/emptyText: loaded \? "No statement has been imported into this company yet\." : ""/);
    const syncs = readFileSync(join(process.cwd(), "app/(app)/banking/BankFeedSyncList.tsx"), "utf8");
    expect(syncs).toMatch(/const \[loaded, setLoaded\] = useState\(false\)/);
    expect(syncs).toMatch(/loading=\{!loaded\}/);
  });

  it("the banking filter bar shows no count until the lines have loaded", () => {
    const client = readFileSync(join(process.cwd(), "app/(app)/banking/BankingClient.tsx"), "utf8");
    expect(client).toMatch(/resultCount=\{loading \? undefined : reviewRows\.length\}/);
  });
});
