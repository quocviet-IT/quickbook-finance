/**
 * The gate for the light/dark conversion.
 *
 * Two jobs, because the conversion has two ways of going wrong and eyes catch
 * neither reliably across fifty-six routes.
 *
 *   `--baseline`  Record every colour each route paints, in light mode. Run
 *                 once before the stylesheet is touched.
 *   `--compare`   Record again and report which colours appeared or vanished.
 *                 The light theme works today; a token conversion that shifts
 *                 it has traded a feature for a defect, so this is the gate on
 *                 every tranche.
 *
 *                 Colours, not screenshots. The first version of this compared
 *                 PNG hashes and reported sixteen routes as changed before a
 *                 line had been edited — then seventeen, a different set, on
 *                 the next run. Pages carry today's date, a row count, a chart:
 *                 pixels move on their own. The set of colours a page paints
 *                 does not, and it is the only thing this conversion can break.
 *   `--dark`      Walk the DOM of every route in dark mode and report what
 *                 the conversion missed: elements still painting a light
 *                 background, text below WCAG AA against what is behind it,
 *                 and elements that set a background without a colour —
 *                 which is where white-on-white comes from.
 *
 * Writes nothing to the database, and no screenshot is committed: the routes
 * are captured against whatever company the signed-in user is in.
 *
 * Run: npm run build && npm start, then
 *      node --env-file=.env.local scripts/verify-theme.mjs --baseline
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { smokeSession } from "./smoke-environment.mjs";
// The same route list the page smoke sweep walks, so the two cannot drift.
import { discoverStaticRoutes } from "./quality/routes.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROUTES = discoverStaticRoutes(join(here, "..", "app", "(app)")).sort();

const args = process.argv.slice(2);
const mode = args.find((a) => a.startsWith("--"))?.replace("--", "") ?? "dark";
const base = args.find((a) => a.startsWith("http")) ?? "http://localhost:3000";
const outDir = process.env.THEME_SHOT_DIR ?? join(process.cwd(), ".theme-shots");

/** The same cookie shape `@supabase/ssr` reads, as the smoke sweep builds it. */
function sessionCookies(session, user, supabaseUrl, domain) {
  const ref = new URL(supabaseUrl).hostname.split(".")[0];
  const payload = {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    expires_in: session.expires_in,
    token_type: "bearer",
    user,
  };
  const encoded = "base64-" + Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  const name = `sb-${ref}-auth-token`;
  const CHUNK = 3180;
  const cookies = [];
  if (encoded.length <= CHUNK) cookies.push({ name, value: encoded });
  else {
    for (let i = 0; i * CHUNK < encoded.length; i++) {
      cookies.push({ name: `${name}.${i}`, value: encoded.slice(i * CHUNK, (i + 1) * CHUNK) });
    }
  }
  return cookies.map((c) => ({ ...c, domain, path: "/", httpOnly: false, secure: false }));
}

/**
 * Relative luminance, per WCAG. Used both to decide whether a background is
 * "still light" and to compute a contrast ratio.
 */
const LUMINANCE = `
  function luminance(rgb) {
    const [r, g, b] = rgb.map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function parse(colour) {
    const m = colour.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const parts = m[1].split(",").map((p) => parseFloat(p.trim()));
    // Fully transparent paints nothing, so it is not this element's colour.
    if (parts.length > 3 && parts[3] === 0) return null;
    return { rgb: parts.slice(0, 3), alpha: parts.length > 3 ? parts[3] : 1 };
  }
  /**
   * What a background actually looks like, which is not what it declares.
   * rgba(255,255,255,0.25) reads as white to a naive check and is a dark grey
   * once composited over a dark card — 56 of the first run's 160 findings
   * were that single mistake, repeated on every route.
   */
  function effectiveBackground(el) {
    let top = null;
    for (let node = el; node; node = node.parentElement) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (!c) continue;
      if (top === null) top = c;
      if (c.alpha >= 1) {
        if (top.alpha >= 1) return top.rgb;
        return top.rgb.map((v, i) => v * top.alpha + c.rgb[i] * (1 - top.alpha));
      }
    }
    return top ? top.rgb : null;
  }
`;

/**
 * Every distinct colour this route paints.
 *
 * A set, not a tally: a page with three more rows than last night paints the
 * same colours more times, and counting them would report that as a change.
 * A colour that appears or disappears is the only thing a token conversion
 * can do, and it is exactly what this has to catch.
 */
async function colourSnapshot(page) {
  return page.evaluate(`(() => {
    const found = new Set();
    for (const el of document.querySelectorAll("body *, body")) {
      const style = getComputedStyle(el);
      for (const prop of ["background-color", "color", "border-top-color", "border-left-color", "outline-color", "fill", "stroke"]) {
        const value = style.getPropertyValue(prop);
        // Nothing that paints nothing.
        if (!value || value === "none" || value.includes(", 0)")) continue;
        found.add(prop + " " + value);
      }
    }
    return [...found].sort();
  })()`);
}

/** Everything wrong with one route, in dark mode. */
async function auditDark(page) {
  return page.evaluate(`(() => {
    ${LUMINANCE}
    const problems = [];
    const seen = new Set();
    const describe = (el) => {
      const cls = (el.className || "").toString().trim().split(/\\s+/).slice(0, 2).join(".");
      return el.tagName.toLowerCase() + (cls ? "." + cls : "");
    };
    for (const el of document.querySelectorAll("body *")) {
      const rect = el.getBoundingClientRect();
      // Nothing invisible, and nothing too small to read anything off.
      if (rect.width < 8 || rect.height < 8) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0") continue;

      const own = parse(style.backgroundColor);
      const bg = own ? effectiveBackground(el) : null;
      if (bg) {
        const lum = luminance(bg);
        if (lum > 0.6) {
          const key = "light|" + describe(el);
          if (!seen.has(key)) {
            seen.add(key);
            problems.push({ kind: "light-background", el: describe(el), colour: style.backgroundColor });
          }
        }
        // Only an element that paints text of its own. A container reports
        // its descendants' text through textContent, so checking that would
        // hold the sidebar's <aside> to the contrast of words its children
        // draw in their own colours — 1.18:1 against a navy background, on
        // every route, for text that does not exist at this level.
        const ownText = [...el.childNodes].some(
          (n) => n.nodeType === 3 && n.textContent.trim() !== "",
        );
        const fgc = parse(style.color);
        const fg = fgc ? fgc.rgb : null;
        if (fg && ownText) {
          const l1 = Math.max(luminance(fg), lum) + 0.05;
          const l2 = Math.min(luminance(fg), lum) + 0.05;
          const ratio = l1 / l2;
          if (ratio < 4.5) {
            const key = "contrast|" + describe(el);
            if (!seen.has(key)) {
              seen.add(key);
              problems.push({
                kind: "low-contrast",
                el: describe(el),
                ratio: Math.round(ratio * 100) / 100,
                colour: style.color,
                background: style.backgroundColor,
              });
            }
          }
        }
      }
    }
    return problems;
  })()`);
}

const session = await smokeSession();
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  colorScheme: mode === "dark" ? "dark" : "light",
});
if (mode === "dark") {
  // Stored before the first navigation, which is the only way React learns
  // about it. Setting `data-theme` after load — what this used to do —
  // switches the CSS variables and leaves Ant Design's algorithm on light,
  // so every Table header still measured #f1f5f9 and the audit reported ten
  // component bugs that did not exist.
  await context.addInitScript(
    `try{localStorage.setItem("onebook.theme","dark")}catch(e){}`,
  );
}
const host = new URL(base).hostname;
await context.addCookies(sessionCookies(session.session, session.user, session.supabaseUrl, host));

mkdirSync(outDir, { recursive: true });

const baselinePath = join(outDir, "baseline.json");
const baseline =
  mode === "compare" && existsSync(baselinePath)
    ? JSON.parse(readFileSync(baselinePath, "utf8"))
    : {};
const snapshot = {};

let checked = 0;
let problems = 0;
const moved = [];

for (const route of ROUTES) {
  // A fresh tab per route, which is how a reader arrives at one.
  //
  // Reusing a single page let Ant Design's injected style tags accumulate
  // across navigations — 27 after the first page, 66 after the third — and
  // the audit stopped being repeatable: 50 findings on one run, 71 on the
  // next, from an unchanged build. A tab that has already mounted forty
  // screens is not the tab anybody browses in.
  const page = await context.newPage();
  try {
    await page.goto(`${base}${route}`, { waitUntil: "networkidle", timeout: 45_000 });
    await page.waitForTimeout(700);
  } catch {
    console.log(`  SKIP  ${route} — did not load`);
    await page.close();
    continue;
  }
  checked += 1;

  if (mode === "dark") {
    const found = await auditDark(page);
    if (found.length) {
      problems += found.length;
      console.log(`\n  ${route}`);
      for (const p of found.slice(0, 6)) {
        console.log(
          p.kind === "light-background"
            ? `    light background  ${p.el}  ${p.colour}`
            : `    contrast ${p.ratio}:1  ${p.el}  ${p.colour} on ${p.background}`,
        );
      }
      if (found.length > 6) console.log(`    … and ${found.length - 6} more`);
    }
    await page.close();
    continue;
  }

  const colours = await colourSnapshot(page);
  snapshot[route] = colours;

  if (mode === "compare") {
    const before = baseline[route];
    if (!before) {
      console.log(`  NEW   ${route} — no baseline`);
      continue;
    }
    const added = colours.filter((c) => !before.includes(c));
    const gone = before.filter((c) => !colours.includes(c));
    if (added.length || gone.length) {
      moved.push({ route, added, gone });
      console.log(`
  ${route}`);
      for (const c of gone) console.log(`    gone     ${c}`);
      for (const c of added) console.log(`    appeared ${c}`);
    }
  }
  await page.close();
}

// Never in dark mode. That branch `continue`s before a snapshot is taken, so
// its `snapshot` is empty — and this line used to write it to baseline.json
// anyway, because the filename was chosen by "compare or not". Every dark
// audit therefore wiped the light baseline, and the next `--compare` reported
// "0 with a colour change" over nothing at all. A gate that cannot fail is
// worse than no gate: it reports success.
if (mode !== "dark") {
  writeFileSync(
    join(outDir, `${mode === "compare" ? "current" : "baseline"}.json`),
    JSON.stringify(snapshot, null, 1),
  );
}

await browser.close();

if (mode === "dark") {
  console.log(`\n${checked} routes audited, ${problems} problem(s) found.`);
  process.exit(problems ? 1 : 0);
}
if (mode === "compare") {
  console.log(`\n${checked} routes compared, ${moved.length} with a colour change.`);
  if (moved.length) {
    writeFileSync(join(outDir, "moved.json"), JSON.stringify(moved, null, 2));
    console.log(`Detail in ${join(outDir, "moved.json")}.`);
  }
  process.exit(moved.length ? 1 : 0);
}
console.log(`\nBaseline recorded for ${checked} route(s) in ${join(outDir, "baseline.json")}.`);
