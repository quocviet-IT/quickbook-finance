/**
 * Builds a guide's film from its take (3.0.28).
 *
 *   FFMPEG=<ffmpeg with libx264> node scripts/guide-videos/build.mjs <work-dir> <guide id>… [--release=3.0.28]
 *
 * Each beat is a span of the take; everything between beats (pages loading, a
 * dialog closing) is cut. The screencast frames covering a beat are laid end to
 * end for the time each stayed on screen, so the picture plays at the speed it
 * was recorded. A beat about one part of the screen is framed closer, so its
 * words read when the film plays at the width of a guide's page: the area the
 * recorder noted, padded and widened to 16:9, at most one and a half times
 * closer. Each line of narration is placed where it was read during the take,
 * levelled with loudnorm and never amplified.
 *
 * Writes, in <work-dir>/build/<guide>: `<guide>-<release>.mp4` (H.264 and AAC,
 * 1280×720), `<guide>-<release>.en.vtt` (the captions, from narration.json's
 * `sub`), `chapters.json` (where each step starts, for the guide's `video`), and
 * a poster for the page, public/guide/videos/<guide>.jpg.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const args = process.argv.slice(2);
const work = args.find((arg) => !arg.startsWith("--"));
const guides = args.filter((arg) => !arg.startsWith("--") && arg !== work);
const release = args.find((arg) => arg.startsWith("--release="))?.slice("--release=".length) ?? "3.0.28";
const FFMPEG = process.env.FFMPEG;
if (!work || !guides.length || !FFMPEG) throw new Error("usage: FFMPEG=<path> build.mjs <work-dir> <guide id>… [--release=x.y.z]");

const W = 1280;
const H = 720;
/** Never closer than this: the viewer still sees which screen it is. */
const MIN_W = Math.round(W / 1.5);
const PAD = 90;

const narration = JSON.parse(readFileSync(join(HERE, "narration.json"), "utf8"));

/** The 16:9 area of the frame a beat is filmed from: around its boxes, or the whole frame. */
function regionFor(boxes) {
  if (!boxes?.length) return { left: 0, top: 0, width: W, height: H };
  const left = Math.min(...boxes.map((b) => b.x)) - PAD;
  const top = Math.min(...boxes.map((b) => b.y)) - PAD;
  const right = Math.max(...boxes.map((b) => b.x + b.width)) + PAD;
  const bottom = Math.max(...boxes.map((b) => b.y + b.height)) + PAD;
  let width = Math.max(MIN_W, right - left, ((bottom - top) * W) / H);
  width = Math.min(W, Math.round(width));
  const height = Math.round((width * H) / W);
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const x = Math.round(Math.min(Math.max(cx - width / 2, 0), W - width));
  const y = Math.round(Math.min(Math.max(cy - height / 2, 0), H - height));
  return { left: x, top: y, width, height };
}

const stamp = (t) => {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
};

for (const guide of guides) {
  const takeDir = join(work, "takes", guide);
  const take = JSON.parse(readFileSync(join(takeDir, "take.json"), "utf8"));
  const frames = take.frames.map((f) => ({ ...f, at: f.ts + (take.skew ?? 0) })).sort((a, b) => a.at - b.at);
  const beats = narration.guides[guide].beats;
  const out = join(work, "build", guide);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, "frames"), { recursive: true });

  // ---- picture: each beat's frames, framed closer where the beat is about one part of the screen
  const list = ["ffconcat version 1.0"];
  let clock = 0;
  let last = null;
  const placed = [];
  for (const b of take.timeline) {
    const region = regionFor(b.focus);
    let i = frames.findLastIndex((f) => f.at <= b.start);
    if (i < 0) i = 0;
    let from = b.start;
    while (from < b.end - 1e-6) {
      const next = frames[i + 1];
      const until = next && next.at < b.end ? Math.max(next.at, from) : b.end;
      if (until > from) {
        const source = join(takeDir, "frames", `${String(frames[i].n).padStart(6, "0")}.jpg`);
        const file = join(out, "frames", `${b.id}-${String(frames[i].n).padStart(6, "0")}.jpg`);
        await sharp(source).extract(region).resize(W, H, { kernel: "lanczos3" }).jpeg({ quality: 92 }).toFile(file);
        list.push(`file '${file.replace(/\\/g, "/")}'`, `duration ${(until - from).toFixed(4)}`);
        last = file;
      }
      from = until;
      if (next && next.at < b.end) i += 1;
      else break;
    }
    placed.push({ beat: b, out: clock });
    clock += b.end - b.start;
  }
  list.push(`file '${last.replace(/\\/g, "/")}'`);
  writeFileSync(join(out, "frames.ffconcat"), list.join("\n"));
  const total = clock;
  const picture = join(out, "picture.mp4");
  execFileSync(FFMPEG, ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", join(out, "frames.ffconcat"),
    "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "22", "-r", "30", picture], { stdio: "inherit" });

  // ---- voice: every line where it was read
  const clips = [];
  for (const { beat: b, out: at } of placed) {
    const lines = beats.find((x) => x.id === b.id).lines;
    lines.forEach((line, k) => clips.push({ file: join(work, "voice", `${b.id}-${k}.wav`), at: at + b.offsets[k], dur: b.durs[k], sub: line.sub }));
  }
  const inputs = [];
  const graph = [];
  clips.forEach((c, i) => {
    inputs.push("-i", c.file);
    graph.push(
      `[${i}:a]aformat=channel_layouts=mono,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,` +
        `aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=mono,adelay=${Math.round(c.at * 1000)}:all=1[v${i}]`,
    );
  });
  graph.push(`${clips.map((_, i) => `[v${i}]`).join("")}amix=inputs=${clips.length}:normalize=0:dropout_transition=0,alimiter=limit=0.7:level=false,apad,atrim=0:${total.toFixed(3)}[voice]`);
  writeFileSync(join(out, "voice.graph.txt"), graph.join(";\n"));
  const voice = join(out, "voice.wav");
  execFileSync(FFMPEG, ["-y", "-v", "error", ...inputs, "-filter_complex_script", join(out, "voice.graph.txt"), "-map", "[voice]", "-ac", "1", "-ar", "48000", voice], { stdio: "inherit" });

  const name = `${guide}-${release}`;
  const film = join(out, `${name}.mp4`);
  execFileSync(FFMPEG, ["-y", "-v", "error", "-i", picture, "-i", voice, "-map", "0:v", "-map", "1:a", "-c:v", "copy",
    "-c:a", "aac", "-b:a", "64k", "-ac", "1", "-movflags", "+faststart", "-shortest", film], { stdio: "inherit" });

  // ---- captions, chapters and a poster
  const cues = clips.map((c, i) => {
    const next = clips[i + 1];
    return { start: c.at, end: Math.min(c.at + c.dur + 0.35, next ? next.at - 0.05 : total), text: c.sub };
  });
  writeFileSync(join(out, `${name}.en.vtt`), `WEBVTT\n\n${cues.map((c) => `${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}\n`).join("\n")}`);
  const chapters = placed.filter(({ beat: b }) => beats.find((x) => x.id === b.id).step !== undefined).map(({ out: at }) => Math.round(at * 10) / 10);
  writeFileSync(join(out, "chapters.json"), JSON.stringify({ name, duration: Math.round(total * 10) / 10, chapters }, null, 1));
  // The poster is the opening card, once it has drawn its steps.
  const intro = placed[0];
  const posterAt = intro.beat.start + Math.min(2.6, intro.beat.end - intro.beat.start - 0.1);
  const posterFrame = frames.findLast((f) => f.at <= posterAt) ?? frames[0];
  mkdirSync(join(ROOT, "public", "guide", "videos"), { recursive: true });
  await sharp(join(takeDir, "frames", `${String(posterFrame.n).padStart(6, "0")}.jpg`))
    .jpeg({ quality: 78, mozjpeg: true })
    .toFile(join(ROOT, "public", "guide", "videos", `${guide}.jpg`));

  const size = statSync(film).size / 1024 / 1024;
  console.log(`${guide}: ${total.toFixed(1)}s, ${size.toFixed(1)} MB, chapters ${chapters.map((c) => c.toFixed(1)).join(" ")}`);
}
