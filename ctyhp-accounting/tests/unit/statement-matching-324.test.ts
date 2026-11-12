import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MATCH_WINDOW_DEFAULT,
  MATCH_WINDOW_OPTIONS,
  matchRuleSentence,
  matchWindowLabel,
  matchWindowProblem,
} from "@/lib/domain/statement-match-window";

/**
 * 3.0.24, item E of the defect report of 11 Nov 2026: what counts as a match
 * is the company's to set, a line that fits more than one entry is left for a
 * person, and a line the books do not have is added only to an account the
 * person confirmed. The pairing itself is proved in statement-pairing.test.ts
 * and reconcile-statement.test.ts; this holds the migration and the wiring.
 */
const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8").replace(/\r\n/g, "\n");
const sql = read("supabase", "migrations", "0193_statement_match_window.sql");
/** Without its prose, so naming a thing in a comment never reads as doing it. */
const code = sql.replace(/--[^\n]*/g, "");

function body(source: string, name: string): string {
  const start = source.search(new RegExp(`create or replace function ${name}\\(`));
  if (start < 0) throw new Error(`${name} is not defined`);
  return source.slice(start, source.indexOf("\n$$;", source.indexOf("as $$", start)) + 4);
}

describe("the window", () => {
  it("starts at the 5 days the pairing always used", () => {
    expect(MATCH_WINDOW_DEFAULT).toBe(5);
    expect(MATCH_WINDOW_OPTIONS).toContain(5);
  });

  it("takes 0 to 31 whole days, in the database's words", () => {
    expect(matchWindowProblem(0)).toBeNull();
    expect(matchWindowProblem(31)).toBeNull();
    for (const bad of [-1, 32, 2.5, Number.NaN]) expect(matchWindowProblem(bad), String(bad)).toBe("Choose a window from 0 to 31 days");
  });

  it("is said plainly", () => {
    expect(matchWindowLabel(0)).toBe("Same day");
    expect(matchWindowLabel(1)).toBe("1 day");
    expect(matchWindowLabel(7)).toBe("7 days");
    expect(matchRuleSentence(5)).toBe(
      "Lines pair with entries of the same amount dated within 5 days, or with the same check number. Change the window on Banking › Rules.",
    );
    expect(matchRuleSentence(0)).toContain("dated the same day");
  });
});

describe("0193_statement_match_window", () => {
  it("starts with the schema search path and qualifies nothing with public.", () => {
    expect(code).toMatch(/^\s*set search_path = public;/);
    expect(code).not.toMatch(/\bpublic\.\w/);
  });

  it("adds the window with a default of 5 and a range of 0 to 31, and changes no row", () => {
    expect(code).toMatch(/add column if not exists match_window_days integer not null default 5;/);
    expect(code).toMatch(/check \(match_window_days between 0 and 31\)/);
    expect(code).not.toMatch(/\bupdate acc_banking_preference\b|\bdelete from\b|\bdrop table\b/i);
  });

  it("reads the window in one place, 5 when nothing is saved", () => {
    const fn = body(code, "acc_statement_match_window");
    expect(fn).toMatch(/language sql stable security definer set search_path = public/);
    expect(fn).toContain("coalesce((select match_window_days from acc_banking_preference where singleton), 5)");
  });

  it("saves it for staff only, in range", () => {
    const fn = body(code, "acc_save_statement_match_window");
    const lines = fn.slice(fn.indexOf("begin")).split("\n");
    expect(lines[1]).toMatch(/if not acc_is_staff\(\) then/);
    expect(fn).toContain("if p_days is null or p_days < 0 or p_days > 31 then");
    expect(fn).toContain("on conflict (singleton) do update");
  });

  it("checks for duplicates within the company's window, its body otherwise 0142's", () => {
    const original = body(read("supabase", "migrations", "0142_reconciliation_history.sql"), "acc_statement_line_duplicates").split("\n");
    const copy = body(sql, "acc_statement_line_duplicates").split("\n");
    const changed = copy.filter((line) => !original.includes(line));
    expect(changed).toEqual(["  v_window integer := acc_statement_match_window();", "      or abs(k.e_on - a.ask_on) <= v_window"]);
    expect(original.filter((line) => !copy.includes(line))).toEqual(["      or abs(k.e_on - a.ask_on) <= 5"]);
  });

  it("opens every function to signed-in users and the service role only", () => {
    for (const signature of ["acc_statement_match_window()", "acc_save_statement_match_window(integer)", "acc_statement_line_duplicates(uuid, integer[])"]) {
      const escaped = signature.replace(/[()[\]]/g, "\\$&");
      expect(code, signature).toMatch(new RegExp(`revoke all on function ${escaped} from public, anon;`));
      expect(code, signature).toMatch(new RegExp(`grant execute on function ${escaped} to authenticated, service_role;`));
    }
  });
});

describe("every pairing reads the company's window", () => {
  it("on the server", () => {
    for (const [file, call] of [
      [["lib", "services", "bankrec.ts"], "reconciliationStandings(statement, book, windowDays)"],
      [["lib", "services", "add-missing.ts"], "reconciliationStandings(statement, book, windowDays)"],
      [["lib", "services", "statement-bank-lines.ts"], "reconciliationStandings(statement, book, windowDays)"],
      [["lib", "services", "reconcile-history.ts"], "reconciliationStandings(statement, book, windowDays)"],
    ] as const) {
      const source = read(...file);
      expect(source, file.join("/")).toContain("getStatementMatchWindow(sb)");
      expect(source, file.join("/")).toContain(call);
    }
    const preview = read("app", "(app)", "banking", "reconcile", "statement-actions.ts");
    expect(preview).toContain("getStatementMatchWindow(sb)");
    expect(preview).toMatch(/simulateRun\([\s\S]*?money,\s*windowDays,\s*\)/);
  });

  it("on the reconciliation, which says the rule under its statement lines", () => {
    const page = read("app", "(app)", "banking", "reconcile", "[id]", "page.tsx");
    expect(page).toContain("getStatementMatchWindow(sb)");
    expect(page).toContain("matchWindowDays={matchWindowDays}");
    const client = read("app", "(app)", "banking", "reconcile", "[id]", "ReconcileWorkspaceClient.tsx");
    expect(client).toContain("reconciliationStandings(statement, lines, matchWindowDays)");
    expect(client).toContain("{matchRuleSentence(matchWindowDays)}");
  });

  it("and the setting lives on Banking › Rules", () => {
    const page = read("app", "(app)", "banking", "rules", "page.tsx");
    expect(page).toContain("<MatchWindowPreference initialDays={preference.matchWindowDays} canWrite={canWrite(role)} />");
  });
});

describe("a line the books do not have does not post itself", () => {
  const box = read("app", "(app)", "banking", "reconcile", "[id]", "AddMissingBox.tsx");
  const client = read("app", "(app)", "banking", "reconcile", "[id]", "ReconcileWorkspaceClient.tsx");

  it("starts each line on what the plan proposes, and a line nothing places on nothing", () => {
    expect(box).toContain("proposedAccount(line)");
    expect(box).toContain("Nothing places this line: choose its account.");
  });

  it("adds only the lines with an account, each to its own", () => {
    expect(box).toContain("onClick={() => onAdd(chosen)}");
    expect(box).toContain("Add {chosen.length} to the books");
    expect(client).toContain("afterAdding(await addMissingLinesAction(reconciliationId, chosen));");
    expect(client).not.toContain("shownPlan.items.map((item) => ({ lineNo: item.lineNo, accountId: item.accountId }))");
  });

  it("asks for an account before Add anyway, too", () => {
    expect(box).toContain("disabled={!accountId || (busy && addingLine !== line.lineNo)}");
    expect(client).toContain("addMissingLinesAction(reconciliationId, [{ lineNo: line.lineNo, accountId }], [line.lineNo])");
  });
});
