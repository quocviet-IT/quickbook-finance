import { describe, expect, it } from "vitest";
import {
  abacusBlocks,
  abacusCoveredFromKey,
  abacusSourceFromKey,
  parseAbacusAnswer,
} from "@/lib/domain/abacus-answer";
import { abacusFollowUps, abacusTopics } from "@/lib/domain/abacus-topics";
import { GUIDE_AREAS, GUIDE_FLOWS } from "@/lib/domain/system-guide";
import { MANUAL_CONTEXT } from "@/lib/ai/manual-context.generated";

describe("parseAbacusAnswer", () => {
  it("takes a guide source off the end of the answer", () => {
    const parsed = parseAbacusAnswer("Open Invoices and press `Receive payment`.\n\nSource: get-paid");
    expect(parsed.body).toBe("Open Invoices and press `Receive payment`.");
    expect(parsed.sourceKey).toBe("get-paid");
    expect(parsed.covered).toBe(true);
    expect(parsed.source).toEqual({
      kind: "guide",
      id: "get-paid",
      title: "Invoice a customer and get paid",
      href: "/guide/get-paid",
    });
  });

  it("reads a manual chapter, with its heading as the title", () => {
    const parsed = parseAbacusAnswer("Text.\nSource: 03_Customers_and_Receivables.md");
    expect(parsed.sourceKey).toBe("03_Customers_and_Receivables.md");
    expect(parsed.source).toMatchObject({ kind: "manual", file: "03_Customers_and_Receivables.md" });
    const heading = /<chapter file="03_Customers_and_Receivables.md">\s*\n# ([^\n]+)/.exec(MANUAL_CONTEXT)?.[1];
    expect(parsed.source && parsed.source.kind === "manual" && parsed.source.title).toBe(heading?.trim());
  });

  it("tolerates a missing extension, backticks, brackets, case and a trailing full stop", () => {
    for (const line of [
      "Source: `03_customers_and_receivables`",
      "source: [03_Customers_and_Receivables.md].",
      "  SOURCE : 03_Customers_and_Receivables.md  ",
    ]) {
      expect(parseAbacusAnswer(`Text.\n${line}`).sourceKey, line).toBe("03_Customers_and_Receivables.md");
    }
    expect(parseAbacusAnswer("Text.\nSource: `Get-Paid`.").sourceKey).toBe("get-paid");
  });

  it("marks an answer the guides do not cover", () => {
    const parsed = parseAbacusAnswer("The guides do not say.\nSource: None");
    expect(parsed).toMatchObject({ covered: false, source: null, sourceKey: "none", body: "The guides do not say." });
  });

  it("leaves the body alone when the source is unknown or missing", () => {
    for (const raw of ["Text.\nSource: made-up-guide", "Text with no source line."]) {
      expect(parseAbacusAnswer(raw)).toEqual({ body: raw, source: null, covered: true, sourceKey: null });
    }
  });

  it("uses the last source line", () => {
    const parsed = parseAbacusAnswer("Source: sales-tax\nMore.\nSource: get-paid");
    expect(parsed.sourceKey).toBe("get-paid");
    expect(parsed.body).toBe("Source: sales-tax\nMore.");
  });

  it("reads keys back from history", () => {
    expect(abacusSourceFromKey("get-paid")?.kind).toBe("guide");
    expect(abacusSourceFromKey("none")).toBeNull();
    expect(abacusSourceFromKey(null)).toBeNull();
    expect(abacusSourceFromKey("gone")).toBeNull();
    expect(abacusCoveredFromKey("none")).toBe(false);
    expect(abacusCoveredFromKey(null)).toBe(true);
    expect(abacusCoveredFromKey("get-paid")).toBe(true);
  });
});

describe("abacusBlocks", () => {
  const known = ["/invoices", "/reports/ar-aging"];

  it("separates paragraphs on blank lines", () => {
    const blocks = abacusBlocks("One.\n\nTwo\nstill two.", known);
    expect(blocks).toEqual([
      { kind: "paragraph", inlines: [{ kind: "text", text: "One." }] },
      { kind: "paragraph", inlines: [{ kind: "text", text: "Two still two." }] },
    ]);
  });

  it("groups numbered steps and bullets", () => {
    const blocks = abacusBlocks("Do this:\n1. Open it\n2) Press `Save`\n\n- a\n* b\n• c", known);
    expect(blocks.map((b) => b.kind)).toEqual(["paragraph", "steps", "bullets"]);
    const steps = blocks[1];
    expect(steps.kind === "steps" && steps.items).toHaveLength(2);
    expect(steps.kind === "steps" && steps.items[1]).toEqual([
      { kind: "text", text: "Press " },
      { kind: "control", text: "Save" },
    ]);
    expect(blocks[2].kind === "bullets" && blocks[2].items).toHaveLength(3);
  });

  it("reads bold and key caps inline", () => {
    const [block] = abacusBlocks("Use **Void** or `Delete`.", known);
    expect(block).toEqual({
      kind: "paragraph",
      inlines: [
        { kind: "text", text: "Use " },
        { kind: "strong", text: "Void" },
        { kind: "text", text: " or " },
        { kind: "control", text: "Delete" },
        { kind: "text", text: "." },
      ],
    });
  });

  it("turns a known route into a link, inline or on a line of its own", () => {
    const blocks = abacusBlocks("See [/invoices] first.\n\n[/reports/ar-aging]", known);
    expect(blocks[0]).toMatchObject({
      kind: "paragraph",
      inlines: [{ kind: "text" }, { kind: "route", route: "/invoices", name: "Invoices" }, { kind: "text" }],
    });
    expect(blocks[1]).toEqual({
      kind: "route",
      route: "/reports/ar-aging",
      name: expect.any(String),
      path: expect.stringContaining("Reports"),
    });
  });

  it("leaves an unknown route as plain text", () => {
    expect(abacusBlocks("Go to [/nowhere].", known)).toEqual([
      { kind: "paragraph", inlines: [{ kind: "text", text: "Go to [/nowhere]." }] },
    ]);
    expect(abacusBlocks("[/nowhere]", known)[0].kind).toBe("paragraph");
  });

  it("defaults to the routes the guide names", () => {
    expect(abacusBlocks("[/invoices]")[0].kind).toBe("route");
  });

  it("reads a screen named twice, as a key cap and as its link, as one link", () => {
    const name = abacusBlocks("[/reports/ar-aging]", known)[0] as { name: string };
    const read = (text: string) => abacusBlocks(text, known)[0];
    expect(read(`View the \`${name.name}\` report [/reports/ar-aging].`)).toEqual({
      kind: "paragraph",
      inlines: [
        { kind: "text", text: "View the " },
        { kind: "route", route: "/reports/ar-aging", name: name.name },
        { kind: "text", text: " report." },
      ],
    });
    expect(read(`Check it — control \`${name.name}\` on [/reports/ar-aging].`)).toEqual({
      kind: "paragraph",
      inlines: [
        { kind: "text", text: "Check it — control " },
        { kind: "route", route: "/reports/ar-aging", name: name.name },
        { kind: "text", text: "." },
      ],
    });
    expect(read(`Open **${name.name}** [/reports/ar-aging] to see it.`)).toMatchObject({
      inlines: [{ kind: "text", text: "Open " }, { kind: "route" }, { kind: "text", text: " to see it." }],
    });
  });

  it("keeps a key cap that is not the linked screen's name", () => {
    expect(abacusBlocks("Click `Receive payment` on [/invoices].", known)[0]).toMatchObject({
      inlines: [
        { kind: "text", text: "Click " },
        { kind: "control", text: "Receive payment" },
        { kind: "text", text: " on " },
        { kind: "route", route: "/invoices" },
        { kind: "text", text: "." },
      ],
    });
  });
});

describe("abacusTopics", () => {
  it("starts with this screen, carrying the guide", () => {
    const topics = abacusTopics("/invoices");
    expect(topics[0].id).toBe("screen");
    expect(topics[0].label).toBe("This screen");
    expect(topics[0].questions.length).toBeLessThanOrEqual(3);
    expect(topics[0].questions[0].question).toMatch(/^How do I /);
    expect(topics[0].questions[0].guide?.id).toBeTruthy();
  });

  it("drops the screen topic where the guide has nothing to say", () => {
    expect(abacusTopics("/some-new/screen-here")[0].id).not.toBe("screen");
  });

  it("then has one topic per guide area that has flows, up to four questions each", () => {
    const topics = abacusTopics("/some-new/screen-here");
    const withFlows = GUIDE_AREAS.filter((a) => GUIDE_FLOWS.some((f) => f.area === a.id));
    expect(topics.map((t) => t.id)).toEqual(withFlows.map((a) => a.id));
    for (const topic of topics) {
      expect(topic.questions.length).toBeGreaterThan(0);
      expect(topic.questions.length).toBeLessThanOrEqual(4);
      for (const q of topic.questions) expect(q.guide).not.toBeNull();
    }
  });
});

describe("abacusFollowUps", () => {
  it("drops what was already asked, ignoring case, and caps the list", () => {
    const all = abacusFollowUps("/invoices", [], 6);
    expect(all.length).toBeGreaterThan(2);
    const next = abacusFollowUps("/invoices", [all[0].toUpperCase()]);
    expect(next).toHaveLength(2);
    expect(next).not.toContain(all[0]);
  });
});
