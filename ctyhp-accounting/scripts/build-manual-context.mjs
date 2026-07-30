// Generate lib/ai/manual-context.generated.ts from the US accounting manual.
//
// The manual lives at the repository root, outside this Next.js project, so it
// is not deployed with the app. Committing a generated module keeps the runtime
// dependency-free (no filesystem reads, works on Vercel) and keeps the manual
// itself the single source of truth.
//
// Run: node scripts/build-manual-context.mjs
// Guarded by tests/unit/manual-context.test.ts, which fails if the generated
// file drifts from the manual.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const manualDir = join(here, "..", "..", "US_ACCOUNTING_USER_MANUAL");
const outFile = join(here, "..", "lib", "ai", "manual-context.generated.ts");

export function readManualChapters() {
  return readdirSync(manualDir)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => ({
      file: name,
      text: readFileSync(join(manualDir, name), "utf8").replace(/\r\n/g, "\n").trim(),
    }));
}

export function buildManualContext(chapters) {
  return chapters
    .map((chapter) => `<chapter file="${chapter.file}">\n${chapter.text}\n</chapter>`)
    .join("\n\n");
}

export function generateModule(context, chapterFiles) {
  return `// GENERATED FILE — do not edit by hand.
// Source: US_ACCOUNTING_USER_MANUAL/*.md
// Regenerate: node scripts/build-manual-context.mjs

/** Chapters bundled into the assistant's grounding context, in reading order. */
export const MANUAL_CHAPTERS: readonly string[] = ${JSON.stringify(chapterFiles, null, 2)};

/** The whole manual, chapter-tagged so an answer can cite where it came from. */
export const MANUAL_CONTEXT = ${JSON.stringify(context)};
`;
}

// Windows paths need pathToFileURL: a hand-built `file://` prefix is one slash
// short of what import.meta.url carries, so the guard never matched.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const chapters = readManualChapters();
  const context = buildManualContext(chapters);
  writeFileSync(
    outFile,
    generateModule(
      context,
      chapters.map((c) => c.file),
    ),
    "utf8",
  );
  console.log(
    `wrote ${outFile} — ${chapters.length} chapters, ${context.length} characters`,
  );
}
