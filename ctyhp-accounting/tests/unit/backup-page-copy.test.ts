import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = join(process.cwd(), "app", "(app)", "settings", "backups");
const client = readFileSync(join(dir, "BackupsClient.tsx"), "utf8");
const actions = readFileSync(join(dir, "actions.ts"), "utf8");

describe("what the backups screen tells a reader", () => {
  it("says outright that attachments are not in a snapshot", () => {
    // The export carries an inventory of stored files but not their bytes.
    // Unwritten, this is the misunderstanding that only surfaces at the worst
    // possible moment.
    expect(client.toLowerCase()).toMatch(/attachment/);
    expect(client.toLowerCase()).toMatch(/not included|does not include|are not/);
  });

  it("explains a night with no file rather than showing a blank row", () => {
    expect(client).toMatch(/have not changed|nothing changed|unchanged/i);
  });
});

describe("what the screen actually reads from acc_backup", () => {
  it("selects taken_at, the column the table has, not taken_on", () => {
    // supabase/migrations/0114_backups.sql declares `taken_at date not null` —
    // there is no taken_on column. A select naming the wrong column fails at
    // the database, not at compile time, so this is the regression a plain
    // read of the migration would not catch on its own.
    expect(actions).toContain("taken_at");
    expect(actions).not.toMatch(/\btaken_on\b/);
  });

  it("never writes to acc_backup", () => {
    // acc_backup grants `select` to authenticated and `all` to service_role
    // (migration 0114). This screen reads through the signed-in person's own
    // client, which only ever has select — so no insert/update/delete/upsert
    // belongs anywhere in this action file.
    expect(actions).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });
});

describe("size formatting stays away from the money helpers", () => {
  it("never reaches for fromMinor or formatMoney to render a byte count", () => {
    // fromMinor asserts its input is an integer and throws otherwise
    // (lib/domain/money.ts). Byte-to-MB conversion is ordinary division that
    // produces a fraction on purpose, so handing that fraction to a money
    // helper is exactly the mistake that took the dashboard down: money and
    // display arithmetic must never share a code path. Matches a call, not
    // just the word, so this still passes a comment that explains the rule.
    expect(client).not.toMatch(/\bfromMinor\(|\bformatMoney\(/);
  });
});
