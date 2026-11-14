import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cellKey, describeChange, flip, pendingChanges } from "@/lib/domain/permission-changes";
import { rolePermissionsSchema } from "@/lib/domain/schemas";
import { RELEASES } from "@/lib/domain/changelog";

/**
 * 3.0.34 (UI audit D5): a switch on the permission matrix wrote the moment it
 * moved. Now the matrix is edited like a form: flipped switches are marked,
 * Save shows every change and writes them together, Discard puts it back.
 */
const ROOT = process.cwd();
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8").replace(/\r\n/g, "\n");
const matrix = read("app", "(app)", "settings", "permissions", "PermissionMatrixClient.tsx");
const actions = read("app", "(app)", "settings", "permissions", "actions.ts");

describe("unsaved permission changes (3.0.34)", () => {
  it("record a flipped switch, and forget one flipped back to where it was", () => {
    const once = flip({}, "accountant", "bill.approve", true, false);
    expect(once).toEqual({ "accountant:bill.approve": true });
    expect(flip(once, "accountant", "bill.approve", false, false)).toEqual({});
  });

  it("are listed in the matrix's order, by permission then role", () => {
    const drafts = { [cellKey("sales", "items.manage")]: false, [cellKey("accountant", "bill.approve")]: true, [cellKey("admin", "bill.approve")]: false };
    const permissions = [
      { key: "bill.approve", label: "Approve bills" },
      { key: "items.manage", label: "Manage items" },
    ];
    expect(pendingChanges(drafts, permissions, ["admin", "accountant", "viewer", "sales"])).toEqual([
      { role: "admin", permission_key: "bill.approve", label: "Approve bills", allowed: false },
      { role: "accountant", permission_key: "bill.approve", label: "Approve bills", allowed: true },
      { role: "sales", permission_key: "items.manage", label: "Manage items", allowed: false },
    ]);
  });

  it("are said in words", () => {
    expect(describeChange({ role: "accountant", label: "Approve bills", allowed: true })).toBe("Accountant gets Approve bills");
    expect(describeChange({ role: "sales", label: "Manage items", allowed: false })).toBe("Sales loses Manage items");
  });
});

describe("the permission matrix (3.0.34)", () => {
  it("does not write when a switch moves", () => {
    expect(matrix).toMatch(/onChange=\{\(checked\) => setDrafts\(\(d\) => flip\(d, role, r\.key, checked, saved\)\)\}/);
    // The write-per-switch action is gone from the app altogether.
    const sources: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry)) sources.push(readFileSync(full, "utf8"));
      }
    };
    walk(join(ROOT, "app"));
    walk(join(ROOT, "components"));
    expect(sources.some((source) => source.includes("setRolePermissionAction"))).toBe(false);
  });

  it("marks what is unsaved, and says how much", () => {
    expect(matrix).toMatch(/permission-matrix__cell--changed/);
    expect(matrix).toMatch(/<Tag color="gold">Unsaved<\/Tag>/);
    expect(matrix).toMatch(/unsaved change"\)\}, marked in the table`/);
    expect(read("app", "globals.css")).toMatch(/\.permission-matrix__cell--changed \{\n  outline: 2px dashed var\(--ob-intent-warning\);/);
  });

  it("shows every change before saving, with Cancel first, and asks before leaving", () => {
    expect(matrix).toMatch(/modal\.confirm\(\{\n\s+autoFocusButton: "cancel",/);
    expect(matrix).toMatch(/changes\.map\(\(change\) => \(\n\s+<li key=\{cellKey\(change\.role, change\.permission_key\)\}>\{describeChange\(change\)\}<\/li>/);
    expect(matrix).toMatch(/useUnsavedGuard\(dirty, modal, "the permissions"\)/);
    expect(matrix).toMatch(/Discard changes/);
  });

  it("keeps a refused change to try again, and says what was refused beside Save", () => {
    expect(matrix).toMatch(/What was saved leaves the drafts; what was refused stays/);
    expect(matrix).toMatch(/`\$\{saved\} saved, \$\{refused\.length\} not: `/);
    expect(matrix).toMatch(/<FormActions\s+error=\{saveError\}/);
  });
});

describe("saving them (3.0.34)", () => {
  it("is one request, checked as before, change by change", () => {
    expect(actions).toMatch(/export async function saveRolePermissionsAction/);
    expect(actions).toMatch(/const denied = await guard\("permissions\.manage"\);/);
    expect(actions).toMatch(/rolePermissionsSchema\.safeParse\(raw\)/);
    expect(actions).toMatch(/await setRolePermission\(sb, change\);/);
  });

  it("takes between one and four hundred changes", () => {
    const one = { role: "accountant", permission_key: "bill.approve", allowed: true };
    expect(rolePermissionsSchema.safeParse([]).success).toBe(false);
    expect(rolePermissionsSchema.safeParse([one]).success).toBe(true);
    expect(rolePermissionsSchema.safeParse(Array.from({ length: 401 }, () => one)).success).toBe(false);
    expect(rolePermissionsSchema.safeParse([{ ...one, role: "owner" }]).success).toBe(false);
  });
});

describe("the release note (3.0.34)", () => {
  it("says the permissions are saved with Save", () => {
    const release = RELEASES.find((candidate) => candidate.version === "3.0.34");
    expect(release).toBeDefined();
    const said = (release?.changes ?? []).map((change) => `${change.title} ${change.detail ?? ""}`).join(" ");
    expect(said).toMatch(/Save changes/);
    expect(said).toMatch(/Discard/);
  });
});
