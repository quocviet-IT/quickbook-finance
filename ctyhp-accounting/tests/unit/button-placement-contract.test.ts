import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Where the main button sits, and what a button that is only an icon says.
 *
 * The UI review of 2026-10-19 found:
 * - a page's main action in a different place on each page. Sixteen lists put
 *   "New …" at the right end of the toolbar; Journal, Pay Bills, Bank Rules,
 *   Reconcile, Sales Tax and Companies put it in a loose row above the table,
 *   Stock Count put it in the page header;
 * - three settings forms with a Save button each placed its own way, and
 *   Approval Policies saving from a floppy-disk icon at the end of every row;
 * - buttons that were only an icon, with nothing on screen to say what they
 *   do: the ⋮ on six lists, and the theme button.
 *
 * The rules, which this test holds:
 * 1. A button that is only an icon has a name for a screen reader and a
 *    tooltip for everyone else.
 * 2. A page's create action ("New …", "Pay bills", "Record payment" …) is in
 *    its toolbar's `actions`, or in an empty state that offers it.
 * 3. The page header carries no primary action.
 * 4. A settings form's Save sits in FormActions, under the form.
 *
 * Documents & Attachments is left out: that screen is on hold and not to be
 * touched.
 */

const ROOTS = ["app", "components"];
const NOT_SCANNED = [/^app\/\(app\)\/documents\//, /^components\/documents\//];

function sourceFiles(dir: string, root: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, root, out);
    else if (entry.endsWith(".tsx")) out.push(relative(root, full).replaceAll("\\", "/"));
  }
  return out;
}

type Jsx = ts.JsxElement | ts.JsxSelfClosingElement;
const isJsx = (node: ts.Node): node is Jsx => ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node);
const tagOf = (node: Jsx) => (ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName).getText();
const attrsOf = (node: Jsx) => (ts.isJsxElement(node) ? node.openingElement.attributes : node.attributes);
function attr(node: Jsx, name: string): ts.JsxAttribute | undefined {
  return attrsOf(node).properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === name);
}
const attrText = (node: Jsx, name: string) => attr(node, name)?.initializer?.getText();
/** The words inside an element, or "" for an element with none. */
function textOf(node: Jsx): string {
  if (!ts.isJsxElement(node)) return "";
  return node.children
    .map((child) => (ts.isJsxText(child) ? child.getText() : ts.isJsxExpression(child) ? (child.expression ? "{…}" : "") : "<…>"))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

interface Found {
  file: string;
  line: number;
  node: Jsx;
  /** Tag names and attribute names from the button outwards, to the enclosing component. */
  ancestry: string[];
}

const root = process.cwd();
const files = ROOTS.flatMap((dir) => sourceFiles(join(root, dir), root)).filter(
  (file) => !NOT_SCANNED.some((skip) => skip.test(file)),
);
const sources = new Map(files.map((file) => [file, readFileSync(join(root, file), "utf8")]));

function elements(tag: string): Found[] {
  const found: Found[] = [];
  for (const [file, text] of sources) {
    if (!text.includes(`<${tag}`)) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node) => {
      if (isJsx(node) && tagOf(node) === tag) {
        const ancestry: string[] = [];
        for (let p = node.parent; p && !ts.isSourceFile(p); p = p.parent) {
          if (isJsx(p)) ancestry.push(tagOf(p));
          else if (ts.isJsxAttribute(p)) ancestry.push(`@${p.name.getText()}`);
          else if (ts.isVariableDeclaration(p)) ancestry.push(`var:${p.name.getText()}`);
          else if (ts.isFunctionDeclaration(p) && p.name) ancestry.push(`fn:${p.name.getText()}`);
        }
        found.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, node, ancestry });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return found;
}

const buttons = elements("Button");
const where = (b: Found) => `${b.file}:${b.line}`;
const isPrimary = (b: Found) => attrText(b.node, "type") === '"primary"';

describe("buttons that are only an icon", () => {
  const iconOnly = buttons.filter((b) => attr(b.node, "icon") && textOf(b.node) === "");

  it("finds the ones it is guarding", () => {
    expect(iconOnly.map(where)).toEqual(expect.arrayContaining([expect.stringMatching(/^components\/ui\/RowActionsMenu\.tsx:/)]));
  });

  it("each has a name and a tooltip", () => {
    const bare = iconOnly
      // A disabled stand-in while the real menu loads is not a control.
      .filter((b) => attrText(b.node, "aria-hidden") !== '"true"')
      .filter((b) => !(attr(b.node, "aria-label") || attr(b.node, "title")) || !b.ancestry.some((a) => a === "Tooltip" || a === "Popover"))
      .map(where);
    expect(bare).toEqual([]);
  });
});

describe("a page's create action", () => {
  const CREATE = /^(New |Pay bills$|Record payment$|Receive payment$|Import statement$|Add user$)/;
  /** Places a create action may be other than the toolbar: an empty state's offer, a dialog, a card about one thing. */
  const CONTEXTUAL = new Set(["@emptyAction", "@action", "Modal", "Drawer", "StandingCard", "Alert"]);
  const creates = buttons.filter((b) => isPrimary(b) && CREATE.test(textOf(b.node)));

  it("finds the ones it is guarding", () => {
    expect(creates.length).toBeGreaterThan(20);
  });

  it("is at the right end of the page's toolbar, in its actions", () => {
    const misplaced = creates.filter((b) => {
      // Up to the enclosing component, before any outer JSX the component is rendered in.
      if (b.ancestry.includes("@actions")) return false;
      if (b.ancestry.some((a) => CONTEXTUAL.has(a))) return false;
      const variable = b.ancestry.find((a) => a.startsWith("var:"))?.slice(4);
      if (variable && new RegExp(`actions=\\{[^\\n]*\\b${variable}\\b`).test(sources.get(b.file)!)) return false;
      // A component that is the button (NewCountButton): where it is used.
      const component = b.ancestry.find((a) => a.startsWith("fn:"))?.slice(3);
      if (component && b.ancestry.every((a) => !/^[A-Z]/.test(a) || a === "Tooltip")) {
        const used = new RegExp(`actions=\\{[^\\n]*<${component}\\b`);
        return ![...sources.values()].some((text) => used.test(text));
      }
      return true;
    });
    expect(misplaced.map((b) => `${where(b)}  ${textOf(b.node)}`)).toEqual([]);
  });
});

describe("the page header", () => {
  it("carries no primary action", () => {
    const headed = elements("PageHeader").filter((h) => attr(h.node, "actions"));
    const offenders = headed.filter((h) => {
      const text = attr(h.node, "actions")!.getText();
      return /type="primary"/.test(text) || /<New[A-Z]\w*/.test(text);
    });
    expect(offenders.map(where)).toEqual([]);
  });
});

describe("a settings form's Save", () => {
  it("sits under the form, in FormActions", () => {
    const saves = buttons.filter(
      (b) => b.file.startsWith("app/(app)/settings/") && isPrimary(b) && /^Save\b/.test(textOf(b.node)),
    );
    expect(saves.length).toBeGreaterThanOrEqual(4);
    const loose = saves.filter((b) => !b.ancestry.includes("FormActions") && !b.ancestry.includes("Modal"));
    expect(loose.map((b) => `${where(b)}  ${textOf(b.node)}`)).toEqual([]);
  });
});
