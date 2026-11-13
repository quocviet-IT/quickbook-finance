/**
 * Puts built guide films and their captions into the guide videos' bucket (3.0.28).
 *
 *   node --env-file=.env.local scripts/guide-videos/upload.mjs <work-dir> <guide id>…
 *
 * Uploads <work-dir>/build/<guide>/<name>.mp4 and <name>.en.vtt with the service
 * role, the only one allowed to write there (migration 0196), then reads each
 * back through a short-lived link, as the guide's page will, and checks its
 * size. Prints the `video` line to put on the guide in lib/domain/system-guide.ts.
 */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "onebook-guide-videos";
const [work, ...guides] = process.argv.slice(2);
if (!work || !guides.length) throw new Error("usage: upload.mjs <work-dir> <guide id>…");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
const storage = createClient(url, key, { auth: { persistSession: false } }).storage.from(BUCKET);

for (const guide of guides) {
  const dir = join(work, "build", guide);
  const { name, duration, chapters } = JSON.parse(readFileSync(join(dir, "chapters.json"), "utf8"));
  for (const [file, contentType] of [
    [`${name}.mp4`, "video/mp4"],
    [`${name}.en.vtt`, "text/vtt"],
  ]) {
    const body = readFileSync(join(dir, file));
    const { error } = await storage.upload(file, body, { contentType, upsert: true, cacheControl: "86400" });
    if (error) throw new Error(`${file}: ${error.message}`);
    const { data: link, error: linkError } = await storage.createSignedUrl(file, 300);
    if (linkError || !link) throw new Error(`${file}: no link (${linkError?.message})`);
    const response = await fetch(link.signedUrl, { method: "HEAD" });
    const length = Number(response.headers.get("content-length"));
    if (!response.ok || length !== statSync(join(dir, file)).size) {
      throw new Error(`${file}: read back ${response.status}, ${length} bytes`);
    }
    console.log(`  ${file}: ${(length / 1024).toFixed(0)} KB, ${response.headers.get("content-type")}`);
  }
  console.log(`    video: { name: "${name}", duration: ${duration}, chapters: [${chapters.join(", ")}] },`);
}
