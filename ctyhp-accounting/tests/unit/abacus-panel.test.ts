import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  ABACUS_KEPT,
  filterConversations,
  groupByDay,
  guideForScreen,
  guideTag,
  knownSource,
  plainAnswer,
  questionCounter,
  screenArea,
  shortTitle,
  topicIcon,
} from "@/components/abacus/abacus-view";
import { ABACUS_KEPT_CONVERSATIONS } from "@/lib/services/abacus-history";

/**
 * Abacus's panel (3.0.20): Ask AI renamed and redrawn, with every conversation
 * kept under the person's account. The panel is read as source here, as the
 * repo's other screens are, plus the pure helpers it draws with.
 */
const ROOT = process.cwd();
const read = (...path: string[]) => readFileSync(join(ROOT, ...path), "utf8").replace(/\r\n/g, "\n");

const PANEL_DIR = join("components", "abacus");
const panelFiles = readdirSync(join(ROOT, PANEL_DIR))
  .filter((name) => /\.(tsx?|css)$/.test(name))
  .map((name) => ({ name, source: read(PANEL_DIR, name) }));
const tsxFiles = panelFiles.filter((file) => file.name.endsWith(".tsx"));
const panel = read(PANEL_DIR, "AbacusPanel.tsx");
const launcher = read("components", "assistant", "AssistantLauncher.tsx");
const css = read(PANEL_DIR, "abacus.module.css");

describe("the launcher (3.0.20)", () => {
  it("reads Ask Abacus, with the mark instead of the question icon", () => {
    expect(launcher).toContain('aria-label="Ask Abacus"');
    expect(launcher).toMatch(/>\s*Ask Abacus\s*</);
    expect(launcher).toContain("icon={<AbacusMark size={22} />}");
    expect(launcher).toContain('title="Ask how something in OneBook works"');
    expect(launcher).toContain('title="Show Report and Ask Abacus"');
  });

  it("fetches the panel when it is first wanted, not with every page", () => {
    expect(launcher).toContain('dynamic(() => import("@/components/abacus/AbacusPanel"), { ssr: false })');
    expect(launcher).not.toMatch(/^import AbacusPanel/m);
    expect(launcher).toMatch(/\{askWanted \? \(\s*<AbacusPanel/);
  });

  it("still steps out of sight while the panel is open", () => {
    expect(launcher).toContain('askOpen ? " assistant-launcher--behind-panel" : ""');
  });
});

describe("the name Ask AI", () => {
  it("is gone from the panel and the launcher", () => {
    for (const file of [...tsxFiles, { name: "AssistantLauncher.tsx", source: launcher }]) {
      expect(file.source, file.name).not.toMatch(/Ask AI/);
    }
  });

  it("is gone with the old panel", () => {
    expect(existsSync(join(ROOT, "components", "ai", "AskAiPanel.tsx"))).toBe(false);
  });

  it("names the panel Abacus, answering from the guides", () => {
    expect(panel).toMatch(/>\s*Abacus\s*<\/h2>/);
    expect(panel).toContain("Answers from the guides");
  });
});

describe("what the panel keeps, and where", () => {
  it("asks /api/ask with the question, the screen and the conversation's id, never earlier turns", () => {
    expect(panel).toContain('fetch("/api/ask"');
    expect(panel).toContain("body: JSON.stringify({ question, route, conversationId })");
    expect(panel).not.toMatch(/\bhistory:/);
  });

  it("keeps nothing in the browser", () => {
    for (const file of panelFiles) {
      expect(file.source, file.name).not.toMatch(/localStorage|sessionStorage|HISTORY_KEY/);
    }
  });

  it("reads and changes the history through the server actions", () => {
    for (const call of [
      "listAbacusConversationsAction(",
      "readAbacusConversationAction(",
      "deleteAbacusConversationAction(",
      "clearAbacusHistoryAction(",
      "rateAbacusAnswerAction(",
    ]) {
      expect(panel, call).toContain(call);
    }
    expect(panel).toMatch(/from "\.\/actions"/);
  });

  it("says how many conversations are kept, the number the database prunes to", () => {
    expect(ABACUS_KEPT).toBe(ABACUS_KEPT_CONVERSATIONS);
    expect(read(PANEL_DIR, "AbacusHistory.tsx")).toContain("The last {ABACUS_KEPT} conversations are kept.");
  });
});

describe("deleting", () => {
  /** Each `modal.confirm({...})` in the panel, as text. */
  const confirms = [...panel.matchAll(/modal\.confirm\(\{([\s\S]*?)\n {4}\}\);/g)].map((match) => match[1]);

  it("asks first, for one conversation and for all of them", () => {
    expect(confirms).toHaveLength(2);
    expect(confirms[0]).toContain("title: `Delete \"${shortTitle(conversation.title)}\"?`");
    expect(confirms[1]).toContain('`Delete all ${plural(count, "conversation")}?`');
    expect(confirms[1]).toContain('content: "This cannot be undone."');
  });

  it("opens with focus on Cancel, and names its action on a danger button", () => {
    for (const confirm of confirms) {
      expect(confirm).toContain('autoFocusButton: "cancel"');
      expect(confirm).toMatch(/okText: "Delete( all)?"/);
      expect(confirm).toContain("okButtonProps: { danger: true }");
    }
  });
});

describe("the drawer", () => {
  it("has no Ant Design header, and is 468 wide, never wider than a phone", () => {
    expect(panel).toContain("title={null}");
    expect(panel).toContain("closable={false}");
    expect(panel).toContain("size={468}");
    expect(panel).toContain('wrapper: { maxWidth: "100vw" }');
    expect(panel).toContain('body: { padding: 0, display: "flex", flexDirection: "column", overflow: "hidden" }');
    expect(panel).toContain('classNames={{ wrapper: "abacus-drawer" }}');
  });

  it("keeps the composer at the foot and sends on Enter, not Shift+Enter", () => {
    expect(css).toMatch(/\.composer \{\s*flex: none;/);
    expect(panel).toContain('event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing');
    expect(panel).toContain("maxLength={ASK_AI_MAX_QUESTION_LENGTH}");
    expect(panel).toContain("{ASK_AI_GROUNDING_NOTE}");
  });

  it("offers each placeholder in its place", () => {
    for (const words of [
      "Ask how something works, e.g. Why can't I void this invoice?",
      "Ask a follow-up…",
      "Continue this conversation…",
    ]) {
      expect(panel).toContain(words);
    }
  });
});

describe("every state the plan names", () => {
  const all = tsxFiles.map((file) => file.source).join("\n");

  it("has words for each", () => {
    for (const words of [
      "What do you need to do on",
      "Ask in your own words. Follow-up questions keep the thread.",
      "Can answer",
      "Cannot see",
      "Common questions",
      "Recent conversations",
      "See all",
      "Reading the guides…",
      "The guides don&apos;t cover this.",
      "Hourly limit reached.",
      "No answer came back.",
      "Try again",
      "Report a problem",
      "This answer was not saved to your history.",
      "Back to chat",
      "No conversations yet",
      "Questions you ask are kept here, under your account.",
      "No conversation matches",
      "Clear search",
      "Clear all history",
      "Conversation from",
      "Asked on",
      "Ask next",
      "Ref.",
    ]) {
      expect(all, words).toContain(words);
    }
  });

  it("reads the conversation out as it grows", () => {
    expect(panel).toContain('role="log" aria-live="polite"');
  });

  it("marks a failure as an alert and the hourly limit as a status", () => {
    const thread = read(PANEL_DIR, "AbacusThread.tsx");
    expect(thread).toMatch(/noteError\}`\} role="alert"/);
    expect(thread).toMatch(/className=\{styles\.note\} role="status"/);
  });

  it("lets only the newest answer be rated, with toggle buttons", () => {
    const thread = read(PANEL_DIR, "AbacusThread.tsx");
    expect(thread).toContain("const rateable = newest && turn.messageId !== null;");
    expect(thread).toContain("aria-pressed={turn.rating === 1}");
    expect(thread).toContain("aria-pressed={turn.rating === -1}");
    // A thumbs down goes on to the report, after the rating is saved.
    expect(panel).toMatch(/await rateAbacusAnswerAction\([\s\S]*?if \(next === -1\) onReportProblem\(\);/);
  });

  it("stops the beads when motion is reduced", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.rod i \{\s*animation: none;/);
  });
});

describe("buttons that are only an icon", () => {
  type Jsx = ts.JsxElement | ts.JsxSelfClosingElement;
  const isJsx = (node: ts.Node): node is Jsx => ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node);
  const tagOf = (node: Jsx) => (ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName).getText();
  const attributes = (node: Jsx) => (ts.isJsxElement(node) ? node.openingElement.attributes : node.attributes);
  const hasAttribute = (node: Jsx, name: string) =>
    attributes(node).properties.some((p) => ts.isJsxAttribute(p) && p.name.getText() === name);

  /** Whether anything in it reads as words: text, or an expression with no markup in it. */
  function hasWords(node: ts.Node): boolean {
    if (ts.isJsxText(node)) return /[A-Za-z]/.test(node.getText());
    if (ts.isJsxExpression(node) && node.parent && !ts.isJsxAttribute(node.parent)) {
      return node.expression !== undefined && !node.expression.getText().includes("<");
    }
    if (ts.isJsxAttributes(node)) return false;
    return node.getChildren().some(hasWords);
  }

  const bare: string[] = [];
  let found = 0;
  for (const file of tsxFiles) {
    const source = ts.createSourceFile(file.name, file.source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node) => {
      if (isJsx(node) && tagOf(node) === "button") {
        const iconOnly = ts.isJsxSelfClosingElement(node) || !node.children.some(hasWords);
        if (iconOnly) {
          found += 1;
          if (!hasAttribute(node, "aria-label") || !hasAttribute(node, "title")) {
            bare.push(`${file.name}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  it("are found (the scan itself works)", () => {
    // Close, Send, Copy, Helpful, Not right, Delete.
    expect(found).toBeGreaterThanOrEqual(6);
  });

  it("each have a name and a tooltip", () => {
    expect(bare).toEqual([]);
  });

  it("include the header's New and History, whose words hide on a phone", () => {
    expect(panel).toContain('aria-label="New conversation"');
    expect(panel).toContain('aria-label="History"');
    expect(css).toMatch(/@media \(max-width: 520px\) \{\s*\.headerLabel,\s*\.enterHint \{\s*display: none;/);
  });
});

describe("colour", () => {
  it("comes from the theme's variables in the stylesheet, with no hex anywhere in it", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).toContain("var(--ob-");
  });

  it("is written out only in the mark, which is a light tile in both themes", () => {
    const withHex = panelFiles.filter((file) => /#[0-9a-fA-F]{3,8}\b/.test(file.source)).map((file) => file.name);
    expect(withHex).toEqual(["AbacusMark.tsx"]);
    expect(read(PANEL_DIR, "AbacusMark.tsx")).toContain('aria-hidden="true"');
  });

  it("never reads the light-only TOKENS", () => {
    for (const file of panelFiles) expect(file.source, file.name).not.toMatch(/\bTOKENS\b/);
  });
});

describe("the screen an answer or a row belongs to", () => {
  it("takes the sidebar's group", () => {
    expect(screenArea("/invoices")).toBe("sales");
    expect(screenArea("/bills")).toBe("purchases");
    expect(screenArea("/banking")).toBe("banking");
    expect(screenArea("/banking/reconcile/1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed")).toBe("banking");
    expect(screenArea("/journal")).toBe("accounting");
    expect(screenArea("/inventory/stock-count")).toBe("inventory");
    expect(screenArea("/reports/ar-aging")).toBe("reports");
    expect(screenArea("/settings/import")).toBe("settings");
    expect(screenArea("/guide/get-paid")).toBe("guide");
    expect(screenArea("/dashboard")).toBe("dashboard");
    expect(screenArea("/somewhere-new")).toBe("other");
  });

  it("gives a topic chip its screen's icon, or its guide area's", () => {
    expect(topicIcon("screen", "/banking")).toBe("banking");
    expect(topicIcon("controls", "/banking")).toBe("controls");
    expect(topicIcon("unknown", "/banking")).toBe("other");
  });
});

describe("a common question's guide tag", () => {
  const guide = { id: "import-transactions", title: "Bring bank lines in" };

  it("names the guide that answers it", () => {
    expect(guideTag({ question: 'What does "Import" do?', guide })).toBe("Bring bank lines in");
  });

  it("is left off when it would only repeat the question", () => {
    expect(guideTag({ question: "How do I bring bank lines in?", guide })).toBeNull();
    expect(guideTag({ question: "Why is it blocked?", guide: null })).toBeNull();
  });
});

describe("the guide the hourly limit points to", () => {
  it("is the one that starts on this screen", () => {
    expect(guideForScreen("/invoices")).toEqual({
      href: "/guide/get-paid",
      name: "Invoice a customer and get paid",
      path: "Guide › Sales",
    });
  });

  it("is every guide when none starts here", () => {
    expect(guideForScreen("/somewhere-new").href).toBe("/guide");
  });
});

describe("History", () => {
  const ZONE = "America/New_York";
  const rows = [
    { id: "a", title: "How do I record a payment?", lastQuestion: "What if the customer overpays?", route: "/invoices", updatedAt: "2026-11-11T19:16:00Z" },
    { id: "b", title: "Why is October closed?", lastQuestion: "Why is October closed?", route: "/journal", updatedAt: "2026-11-11T14:02:00Z" },
    { id: "c", title: "How do I match a deposit?", lastQuestion: "Can I undo a match?", route: "/banking", updatedAt: "2026-11-10T21:45:00Z" },
    { id: "d", title: "Why is Void greyed out?", lastQuestion: "Why is Void greyed out?", route: "/bills", updatedAt: "2026-11-06T20:27:00Z" },
  ];

  it("finds a conversation by its title, its last question or its screen's name, in any case", () => {
    expect(filterConversations(rows, "PAYMENT").map((row) => row.id)).toEqual(["a"]);
    expect(filterConversations(rows, "undo").map((row) => row.id)).toEqual(["c"]);
    expect(filterConversations(rows, "bank transactions").map((row) => row.id)).toEqual(["c"]);
    expect(filterConversations(rows, "  ").map((row) => row.id)).toEqual(["a", "b", "c", "d"]);
    expect(filterConversations(rows, "payroll")).toEqual([]);
  });

  it("groups by day on the company's clock: Today, Yesterday, then the weekday and date", () => {
    const groups = groupByDay(rows, ZONE, "2026-11-11");
    expect(groups.map((group) => [group.heading, group.items.map((row) => row.id)])).toEqual([
      ["Today", ["a", "b"]],
      ["Yesterday", ["c"]],
      ["Friday, 11/06/2026", ["d"]],
    ]);
  });

  it("names a long conversation in a question short enough to read", () => {
    expect(shortTitle("How do I record a payment against this invoice?")).toBe(
      "How do I record a payment against this invoice?",
    );
    const long = shortTitle("Why ".repeat(40));
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("the composer's count", () => {
  it("reads as the box allows", () => {
    expect(questionCounter(0, 1000)).toBe("0 / 1,000");
    expect(questionCounter(1000, 1000)).toBe("1,000 / 1,000");
  });
});

describe("Copy", () => {
  it("copies an answer as plain text: steps numbered, no backticks, a screen by its name", () => {
    const body = [
      "Receive it from the invoice.",
      "",
      "1. Open the invoice and press `Receive payment`.",
      "2. Enter the amount. A smaller one leaves it **Partial**.",
      "",
      "[/reports/ar-aging]",
    ].join("\n");
    expect(plainAnswer(body)).toBe(
      [
        "Receive it from the invoice.",
        "",
        "1. Open the invoice and press Receive payment.",
        "2. Enter the amount. A smaller one leaves it Partial.",
        "",
        "Accounts Receivable Aging (Reports › Accounts Receivable Aging)",
      ].join("\n"),
    );
  });
});

describe("a reply's source", () => {
  it("is rebuilt from its key, so only a guide that exists becomes a link", () => {
    expect(knownSource({ kind: "guide", id: "get-paid", title: "anything", href: "https://example.com" })).toEqual({
      kind: "guide",
      id: "get-paid",
      title: "Invoice a customer and get paid",
      href: "/guide/get-paid",
    });
    expect(knownSource({ kind: "guide", id: "no-such-guide", title: "x", href: "/guide/no-such-guide" })).toBeNull();
    expect(knownSource(null)).toBeNull();
    expect(knownSource(undefined)).toBeNull();
  });
});
