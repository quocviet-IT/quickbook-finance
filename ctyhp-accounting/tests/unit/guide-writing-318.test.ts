import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GUIDE_FLOWS, type GuideFlow } from "@/lib/domain/system-guide";
import { searchGuide } from "@/lib/domain/screen-context";
import { guideLanding, retiredGuideTarget } from "@/lib/domain/guide-help";
import { RELEASES } from "@/lib/domain/changelog";

/**
 * 3.0.18: the guide says less on the page. A step is what you are doing, in a
 * few words, and one line on what happens. The paragraph that used to follow
 * every step is folded under Details, where the search and Ask AI still read it.
 */

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8").replace(/\r\n/g, "\n");
const everyStep = GUIDE_FLOWS.flatMap((flow) =>
  flow.steps.map((step, index) => ({ flow, step, label: `${flow.id} step ${index + 1}` })),
);

describe("the guide's writing limits (3.0.18)", () => {
  it("names each step in eight words or fewer", () => {
    for (const { step, label } of everyStep) {
      expect(words(step.action), `${label}: ${step.action}`).toBeLessThanOrEqual(8);
    }
  });

  it("gives every step one line on what happens, fifteen words at most", () => {
    for (const { step, label } of everyStep) {
      expect(typeof step.summary, label).toBe("string");
      expect(words(step.summary), `${label}: ${step.summary}`).toBeGreaterThan(2);
      expect(words(step.summary), `${label}: ${step.summary}`).toBeLessThanOrEqual(15);
      expect(step.summary, label).toMatch(/[.?]$/);
      expect(step.summary, label).not.toMatch(/\n/);
    }
  });

  it("keeps a step's Details only where they say more than its line", () => {
    // A note that fits in fifteen words is the line itself; folding it away
    // would only make the reader click to read the same thing twice.
    for (const { step, label } of everyStep) {
      if (step.note === undefined) continue;
      expect(words(step.note), label).toBeGreaterThan(15);
      expect(words(step.note), label).toBeGreaterThan(words(step.summary));
    }
  });

  it("says what each guide is for in twenty words or fewer", () => {
    for (const flow of GUIDE_FLOWS) {
      expect(words(flow.purpose), `${flow.id}: ${flow.purpose}`).toBeLessThanOrEqual(20);
    }
  });

  it("keeps a guide to nine steps and three cautions, each caution titled in a line", () => {
    for (const flow of GUIDE_FLOWS) {
      expect(flow.steps.length, flow.id).toBeLessThanOrEqual(9);
      expect(flow.cautions?.length ?? 0, flow.id).toBeLessThanOrEqual(3);
      for (const caution of flow.cautions ?? []) {
        expect(words(caution.title), `${flow.id}: ${caution.title}`).toBeLessThanOrEqual(12);
      }
    }
  });

  it("writes OneBook as one word, and no longer calls this a test round", () => {
    const text = JSON.stringify(GUIDE_FLOWS);
    expect(text).not.toMatch(/One Book/);
    expect(text).not.toMatch(/test round/i);
  });
});

describe("cautions merged without losing a word (3.0.18)", () => {
  const flow = (id: string) => GUIDE_FLOWS.find((candidate) => candidate.id === id);
  const said = (id: string) =>
    (flow(id)?.cautions ?? []).map((caution) => `${caution.title} ${caution.body}`).join(" ");

  it("keeps each merged caution's parts as paragraphs", () => {
    const merged = flow("import-transactions")?.cautions?.find((caution) => caution.title.startsWith("Every account and bank"));
    expect(merged?.body.split("\n\n")).toHaveLength(3);
  });

  it("keeps everything the transactions import warned about", () => {
    const text = said("import-transactions");
    for (const words of [
      "This tab wants the other shape: one row per transaction",
      "Every account the file names must already be in the chart of accounts",
      "A name two accounts answer to is refused, and the account code is the way out",
      "\"1000 Cash on Hand\" without the hyphen is not a form the chart recognizes",
      "The bank accounts have to exist under Banking, not only in the chart",
      "Undo voids the entries it posted and removes its bank lines",
      "Rows carrying no money are left out, and that is not a fault",
      "A waived fee is often written as 0.00.",
    ]) {
      expect(text, words).toContain(words);
    }
  });

  it("keeps everything the ledger import warned about", () => {
    const text = said("import-a-ledger");
    for (const words of [
      "There is no way to move an import from one company to another afterwards.",
      "A ledger row never creates an account",
      "An entry dated in a closed period cannot be voided at all",
      "Do not close a period until you have checked the import against the report you exported.",
      "a doubled ledger balances perfectly and looks entirely correct",
      "A sample company can be thrown away.",
    ]) {
      expect(text, words).toContain(words);
    }
  });
});

/** Every file that could print a label on screen, apart from the guide and the release notes. */
function appSource(): string {
  const skip = new Set([
    join("lib", "domain", "system-guide.ts"),
    join("lib", "domain", "changelog.ts"),
    join("lib", "ai", "manual-context.generated.ts"),
  ]);
  const texts: string[] = [];
  const walk = (dir: string) => {
    // Dirent types rather than a stat per file: on Windows the stats were most of the time.
    for (const entry of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(entry.name) && !skip.has(path)) texts.push(read(path));
    }
  };
  for (const dir of ["app", "components", "lib"]) walk(dir);
  return texts.join("\n");
}

/** Labels the guide describes rather than quotes: there is no button with these words on it. */
const DESCRIBED = new Set(["The company switcher", "The panels below the preview", "The red panels"]);

function printed(source: string, label: string): boolean {
  // "Suspend or Offboard", "The whole history / Closing balances only": two buttons side by side.
  const parts = label.split(/ or (?=[A-Z])| \/ /);
  if (parts.length > 1) return parts.every((part) => printed(source, part));
  // "Adjust inventory by …": the screen fills in the rest.
  if (label.endsWith(" …")) return source.includes(label.slice(0, -1));
  if (/\bN\b/.test(label)) {
    // "Remove these N entries" is printed with the count in its place, and the
    // count may bring its own noun: `Remove these ${plural(n, "entry", "entries")}`.
    const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const [before, after] = label.split(/\bN\b/);
    const count = "(?:\\{[^}]+\\}|\\$\\{[^}]+\\})";
    const rest = /^ \w+$/.test(after) ? `(?:${escape(after)})?` : escape(after);
    return new RegExp(`${escape(before)}${count}${rest}`).test(source);
  }
  // A label quoted from the middle of a sentence starts with a capital in the guide.
  return source.includes(label) || source.includes(label.charAt(0).toLowerCase() + label.slice(1));
}

describe("the buttons the guide names are the ones on screen (3.0.18)", () => {
  it("names only labels the app prints", () => {
    const source = appSource();
    const labels = [...new Set(everyStep.map(({ step }) => step.control))].filter((label) => !DESCRIBED.has(label));
    const missing = labels.filter((label) => !printed(source, label));
    expect(missing, `the guide names buttons no screen prints: ${missing.join(", ")}`).toEqual([]);
    // It reads every source file the app is built from; alone that takes a few
    // seconds, and beside the rest of the suite several times that.
  }, 60_000);

  it("no longer names the six it had wrong", () => {
    const controls = everyStep.map(({ step }) => step.control);
    for (const gone of [
      "Suggest matches",
      "Close period",
      "Reopen period",
      "Convert to bill",
      "Add all to the books",
      "AR aging",
      "AP aging",
      "Sales tax liability",
    ]) {
      expect(controls, gone).not.toContain(gone);
    }
  });

  it("says Report and Ask Abacus are on every screen, not on the screen the guide starts on", () => {
    const flow = GUIDE_FLOWS.find((candidate) => candidate.id === "feedback");
    expect(flow?.steps.filter((step) => step.everyScreen).map((step) => step.control)).toEqual(["Report", "Ask Abacus"]);
    const view = read("app", "(app)", "guide", "[id]", "GuideFlowView.tsx");
    expect(view).toMatch(/step\.everyScreen \? "every screen"/);
  });

  it("puts Import on the import screen, where its button is", () => {
    const flow = GUIDE_FLOWS.find((candidate) => candidate.id === "import-transactions");
    const step = flow?.steps.find((candidate) => candidate.control === "Import");
    expect(step?.route ?? flow?.route).toBe("/settings/import");
  });

  it("saves a new invoice as a draft and issues it from the draft's row", () => {
    const flow = GUIDE_FLOWS.find((candidate) => candidate.id === "get-paid");
    expect(flow?.steps[0].summary).toContain("Save draft");
    expect(flow?.steps[1].control).toBe("Issue");
    expect(flow?.steps[1].summary).toContain("draft's row");
  });
});

describe("Banking in six guides (3.0.18)", () => {
  const banking = GUIDE_FLOWS.filter((flow) => flow.area === "banking");

  it("splits the one long guide into six, in the order the work is done", () => {
    expect(banking.map((flow) => flow.id)).toEqual([
      "bank-lines-in",
      "code-and-match",
      "cards-loans-companies",
      "reconcile-by-hand",
      "reconcile-from-files",
      "check-reconciliations",
    ]);
    expect(GUIDE_FLOWS.find((flow) => flow.id === "banking")).toBeUndefined();
  });

  it("keeps all thirty steps, each in one guide only", () => {
    const steps = banking.flatMap((flow) => flow.steps);
    expect(steps).toHaveLength(30);
    expect(new Set(steps.map((step) => `${step.control}|${step.summary}`)).size).toBe(30);
  });

  it("sends a step to its own screen when its guide starts on another", () => {
    const cards = banking.find((flow) => flow.id === "cards-loans-companies");
    expect(cards?.route).toBe("/banking/rules");
    // Split… is in Bank Transactions, not on the rules screen the guide starts on.
    expect(cards?.steps.find((step) => step.control === "Split…")?.route).toBe("/banking");
  });

  it("opens the rules screen's guide straight from its Help link", () => {
    expect(guideLanding("/banking/rules").redirectTo).toBe("/guide/cards-loans-companies?from=%2Fbanking%2Frules");
  });

  it("opens Reconcile history's Help at its step", () => {
    expect(guideLanding("/banking/reconcile/history").redirectTo).toBe(
      "/guide/reconcile-from-files?from=%2Fbanking%2Freconcile%2Fhistory#step-3",
    );
  });

  it("sends the old Banking guide's address to the six that replaced it", () => {
    expect(retiredGuideTarget("banking")).toBe("/guide#guide-area-banking");
    expect(retiredGuideTarget("get-paid")).toBeNull();
    expect(retiredGuideTarget("no-such-guide")).toBeNull();
    const page = read("app", "(app)", "guide", "[id]", "page.tsx");
    expect(page).toMatch(/retiredGuideTarget\(id\)/);
    expect(page).toMatch(/redirect\(/);
  });
});

describe("searching the guide (3.0.18)", () => {
  it("finds a step by the words of its line", () => {
    const flow: GuideFlow = {
      id: "test",
      area: "sales",
      title: "A title",
      purpose: "What it is for.",
      route: "/invoices",
      steps: [{ action: "Do the thing", summary: "Zebras cross here.", control: "Go" }],
    };
    expect(searchGuide("zebras", [flow]).map((match) => match.steps.length)).toEqual([1]);
  });
});

describe("the guide's page shows a line per step and folds the rest (3.0.18)", () => {
  const view = read("app", "(app)", "guide", "[id]", "GuideFlowView.tsx");

  it("shows each step's line, and its note under Details", () => {
    expect(view).toContain("{step.summary}");
    expect(view).toMatch(/<details className="guide-details">\s*<summary>Details<\/summary>\s*<p[^>]*>\{step\.note\}<\/p>/);
  });

  it("names a report's screen once, and links to a screen as Go to", () => {
    // "Open Invoices on Open Invoices · Open Open Invoices" said one name three times.
    expect(view).toMatch(/sameAsScreen \? null : <span>on \{screen\}<\/span>/);
    expect(view).toMatch(/Go to \{screen\}/);
    expect(view).not.toMatch(/Open \{screen\}/);
  });

  it("lands a step, or the Banking guides, below the header that stays at the top", () => {
    const css = read("app", "globals.css");
    expect(css).toMatch(/\.guide-step,\s*\.guide-area__title \{\s*scroll-margin-top: 72px;/);
    // On a phone the header is two rows, and taller still until the page has loaded.
    expect(css).toMatch(/@media \(max-width: 575px\) \{\s*\.guide-step,\s*\.guide-area__title \{\s*scroll-margin-top: 172px;/);
  });

  it("shows a caution's title and folds its body", () => {
    expect(view).toMatch(/<details className="guide-details guide-caution">\s*<summary>\{caution\.title\}<\/summary>/);
    // Its body in paragraphs: a caution merged from three keeps the three apart.
    expect(view).toMatch(/paragraphs\(caution\.body\)/);
  });
});

describe("the release note (3.0.18)", () => {
  const release = RELEASES.find((candidate) => candidate.version === "3.0.18");

  it("says what changed in the guide and which buttons it had wrong", () => {
    expect(release).toBeDefined();
    const said = (release?.changes ?? []).map((change) => `${change.title} ${change.detail ?? ""}`).join(" ");
    for (const words of ["Details", "six guides", "Suggest matches", "Approve", "Create bill"]) {
      expect(said, words).toContain(words);
    }
  });
});
