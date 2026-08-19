import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  restore: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/db/server", () => ({ createSupabaseServerClient: mocks.createClient }));
vi.mock("@/lib/services/backup-restore", () => ({
  restoreBackupIntoNewCompany: mocks.restore,
}));

import { restoreBackupAction } from "@/app/(app)/settings/backups/[id]/restore/actions";

const id = "11111111-1111-4111-8111-111111111111";

/** A signed-in client whose permission answers come from the given matrix. */
function clientWith(perms: Record<string, boolean>) {
  return {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "u1" } } })) },
    rpc: vi.fn(async (_fn: string, args: { p_key: string }) => ({
      data: perms[args.p_key] === true,
      error: null,
    })),
  };
}

describe("restoreBackupAction checks both permissions the restore actually needs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.restore.mockResolvedValue({ companyId: "c1" });
  });

  it("refuses without company.restore, before the service is ever called", async () => {
    mocks.createClient.mockResolvedValue(
      clientWith({ "company.restore": false, "company.export": true }),
    );
    await expect(restoreBackupAction(id, "Copy")).resolves.toEqual({
      ok: false,
      error: "You do not have permission to restore a backup",
    });
    expect(mocks.restore).not.toHaveBeenCalled();
  });

  it("names the export permission when that is what is missing, not a phantom missing snapshot", async () => {
    // acc_backup's RLS policy (migration 0114) admits reads on company.export,
    // so restore-without-export makes the register read come back empty and
    // the old message — "That snapshot does not exist in this company's
    // register" — explained a permission refusal as a missing row. Production
    // edit that makes this fail: dropping the export check, which sends this
    // call into the service (asserted uncalled below) and back to that lie.
    mocks.createClient.mockResolvedValue(
      clientWith({ "company.restore": true, "company.export": false }),
    );
    const result = await restoreBackupAction(id, "Copy");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("company.export");
    expect(result.error).not.toContain("does not exist");
    expect(mocks.restore).not.toHaveBeenCalled();
  });

  it("restores with both permissions, and refreshes the shell's company switcher", async () => {
    const sb = clientWith({ "company.restore": true, "company.export": true });
    mocks.createClient.mockResolvedValue(sb);
    const result = await restoreBackupAction(id, "  Copy  ");
    expect(result.ok).toBe(true);
    expect(mocks.restore).toHaveBeenCalledWith(sb, id, "Copy");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });
});

describe("the restore page gates on both permissions too", () => {
  const source = readFileSync(
    join(process.cwd(), "app", "(app)", "settings", "backups", "[id]", "restore", "page.tsx"),
    "utf8",
  );

  it("awaits a company.restore gate", () => {
    expect(source).toMatch(/await requireSettingsPermission\(\s*\[\s*"company\.restore"/);
  });

  it("awaits a company.export gate, which is what lets the page read acc_backup at all", () => {
    // Without this the page renders its register read against RLS that
    // returns nothing, and a person granted restore-but-not-export is told
    // the snapshot does not exist. Production edit that makes this fail:
    // removing the second guard.
    expect(source).toMatch(/await requireSettingsPermission\(\s*\[\s*"company\.export"/);
  });
});
