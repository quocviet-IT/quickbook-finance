/**
 * Does the stylesheet still declare the same colours it did before?
 *
 * This is the gate on the light theme during the token conversion, and it
 * replaced two attempts that could not do the job:
 *
 *   1. Full-page screenshots, hashed. Reported sixteen routes as changed
 *      before a line was edited, then seventeen, a different set. Pages carry
 *      today's date and a row count; pixels move on their own.
 *   2. The set of colours each rendered route paints. Steadier, but still not
 *      steady: a page only paints the warning amber when its data has
 *      something to warn about, so the set moved between runs — eleven routes,
 *      then ten, different ones.
 *
 * Both were measuring the *rendered app*, which depends on the books. The
 * conversion cannot change the books; it can only change what the stylesheet
 * says. So this reads the stylesheet, resolves every `var(--ob-…)` back to the
 * value it holds in the light theme, and lists what each selector declares.
 * Deterministic, offline, and precisely as sensitive as it needs to be: if a
 * declaration would paint a different colour, this says so and names it.
 *
 * Run:  node scripts/verify-stylesheet-colours.mjs            (compare to HEAD)
 *       node scripts/verify-stylesheet-colours.mjs <git-ref>  (to another commit)
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const CSS = "app/globals.css";
const ref = process.argv[2] ?? "HEAD";

/** `--ob-money-negative: #b91c1c;` from the light `:root` block only. */
function lightVariables(css) {
  const start = css.indexOf(":root {");
  const end = css.indexOf("}", start);
  const block = css.slice(start, end);
  const vars = new Map();
  for (const m of block.matchAll(/(--ob-[\w-]+):\s*([^;]+);/g)) vars.set(m[1], m[2].trim());
  return vars;
}

/**
 * Every colour-bearing declaration, as `selector | property | value`, with
 * variables resolved and the `:root` blocks left out — those *define* the
 * variables, so including them would report the definition and the use as two
 * separate changes for one edit.
 */
function declarations(css) {
  const vars = lightVariables(css);
  const resolve = (value) =>
    value.replace(/var\((--ob-[\w-]+)\)/g, (_, name) => vars.get(name) ?? `«${name} undefined»`);

  const out = [];
  let selector = "";
  let inRoot = false;
  for (const raw of css.split("\n")) {
    const line = raw.trim();
    if (line.endsWith("{")) {
      selector = line.slice(0, -1).trim();
      inRoot = /^:root(\[data-theme="dark"\])?$/.test(selector);
      continue;
    }
    if (inRoot) continue;
    const m = line.match(/^([-a-z]+)\s*:\s*(.+);$/);
    if (!m) continue;
    const value = resolve(m[2]);
    // Only declarations that actually name a colour.
    if (!/#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(/.test(value)) continue;
    out.push(`${selector} | ${m[1]} | ${value}`);
  }
  return out;
}

const now = declarations(readFileSync(CSS, "utf8"));
const then = declarations(execFileSync("git", ["show", `${ref}:ctyhp-accounting/${CSS}`], { encoding: "utf8" }));

const before = new Map();
for (const d of then) before.set(d, (before.get(d) ?? 0) + 1);
const after = new Map();
for (const d of now) after.set(d, (after.get(d) ?? 0) + 1);

const gone = then.filter((d) => (after.get(d) ?? 0) < (before.get(d) ?? 0));
const added = now.filter((d) => (before.get(d) ?? 0) < (after.get(d) ?? 0));

console.log(`${then.length} colour declarations at ${ref}, ${now.length} now.`);
if (!gone.length && !added.length) {
  console.log("\nIdentical. The light theme declares exactly what it declared.");
  process.exit(0);
}
console.log(`\n${gone.length} declaration(s) changed:\n`);
for (const d of gone.slice(0, 40)) console.log(`  was  ${d}`);
for (const d of added.slice(0, 40)) console.log(`  now  ${d}`);
if (gone.length > 40) console.log(`  … and ${gone.length - 40} more`);
process.exit(1);
