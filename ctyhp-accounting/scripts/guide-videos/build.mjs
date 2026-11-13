/**
 * Builds a guide's film from its take (3.0.28).
 *
 *   FFMPEG=<ffmpeg with libx264> node scripts/guide-videos/build.mjs <work-dir> <guide id>… [--release=3.0.28]
 *
 * The take is a list of spans (each step's beat, and the moves between
 * screens), with everything between them cut: pages loading, dialogs closing.
 * Inside a span the camera follows what the recorder said to look at: it eases
 * from one area to the next in three quarters of a second, and while it rests
 * it closes in a little more, slowly, so the picture is never quite still. An
 * area is padded and widened to 16:9, and never closer than the recorder asked
 * (at most 1.8×). Each span after the first fades in over the one before.
 *
 * Frames are drawn at 30 a second from the screencast's own frames, each
 * cropped where the camera is, and handed straight to ffmpeg. Each line of
 * narration is placed where it was read, levelled with loudnorm and never
 * amplified.
 *
 * Writes, in <work-dir>/build/<guide>: `<guide>-<release>.mp4` (H.264 and AAC,
 * 1280×720), `<guide>-<release>.en.vtt` (the captions, from narration.json's
 * `sub`), `chapters.json` (where each step starts, for the guide's `video`), and
 * a poster for the page, public/guide/videos/<guide>.jpg.
 */
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
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
const FPS = 30;
const PAD = 70;
const MAX_ZOOM = 1.8;
const TRANS = 0.75; // seconds the camera takes to reach a new area
const DRIFT = 0.035; // how much closer it creeps while resting…
const DRIFT_SECONDS = 7; // …over this long
const FADE = 0.3; // a span fades in over the one before

const narration = JSON.parse(readFileSync(join(HERE, "narration.json"), "utf8"));
const FULL = { x: 0, y: 0, w: W };

/** The 16:9 area around `boxes`, no closer than `zoom`; the whole frame when there are none. */
function areaFor(boxes, zoom) {
  if (!boxes?.length) return FULL;
  const left = Math.min(...boxes.map((b) => b.x)) - PAD;
  const top = Math.min(...boxes.map((b) => b.y)) - PAD;
  const right = Math.max(...boxes.map((b) => b.x + b.width)) + PAD;
  const bottom = Math.max(...boxes.map((b) => b.y + b.height)) + PAD;
  const minW = W / Math.min(MAX_ZOOM, Math.max(1, zoom ?? 1.6));
  const w = Math.min(W, Math.max(minW, right - left, ((bottom - top) * W) / H));
  const h = (w * H) / W;
  const x = Math.min(Math.max((left + right) / 2 - w / 2, 0), W - w);
  const y = Math.min(Math.max((top + bottom) / 2 - h / 2, 0), H - h);
  return { x, y, w };
}

const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
const lerp = (a, b, p) => ({ x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p, w: a.w + (b.w - a.w) * p });

/** Where the camera is at take time `t` inside a span: easing between areas, creeping closer at rest. */
function cameraAt(spanCamera, startT, t) {
  let state = { from: FULL, to: FULL, t0: startT };
  const at = (s, time) => {
    const p = Math.min(1, Math.max(0, (time - s.t0) / TRANS));
    const moved = lerp(s.from, s.to, ease(p));
    const rest = Math.max(0, time - s.t0 - TRANS);
    const creep = 1 - DRIFT * Math.min(1, rest / DRIFT_SECONDS);
    const w = moved.w * creep;
    const h = (w * H) / W;
    const cx = moved.x + moved.w / 2;
    const cy = moved.y + (moved.w * H) / W / 2;
    return { x: Math.min(Math.max(cx - w / 2, 0), W - w), y: Math.min(Math.max(cy - h / 2, 0), H - h), w };
  };
  for (const key of spanCamera) {
    if (key.t > t) break;
    const here = at(state, key.t);
    state = { from: here, to: areaFor(key.boxes, key.zoom), t0: key.t };
  }
  return at(state, t);
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
  mkdirSync(out, { recursive: true });

  // ---- where each span sits in the film
  let clock = 0;
  const placed = take.timeline.map((s) => {
    const entry = { span: s, out: clock, length: s.end - s.start };
    clock += entry.length;
    return entry;
  });
  const total = clock;

  // ---- picture: 30 frames a second, each cropped where the camera is, straight into ffmpeg
  const picture = join(out, "picture.mp4");
  const encoder = spawn(FFMPEG, ["-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${W}x${H}`, "-r", String(FPS), "-i", "pipe:0",
    "-c:v", "libx264", "-preset", "slow", "-crf", "23", "-pix_fmt", "yuv420p", "-r", String(FPS), picture], { stdio: ["pipe", "inherit", "inherit"] });
  const decoded = new Map();
  const source = async (n) => {
    if (!decoded.has(n)) {
      if (decoded.size > 4) decoded.delete(decoded.keys().next().value);
      decoded.set(n, await sharp(join(takeDir, "frames", `${String(n).padStart(6, "0")}.jpg`)).removeAlpha().raw().toBuffer({ resolveWithObject: true }));
    }
    return decoded.get(n);
  };
  const frameAt = (t) => {
    let lo = 0;
    let hi = frames.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (frames[mid].at <= t) lo = mid;
      else hi = mid - 1;
    }
    return frames[lo];
  };
  let previousLast = null;
  let spanIndex = 0;
  let lastOfSpan = null;
  const count = Math.round(total * FPS);
  for (let k = 0; k < count; k++) {
    const filmT = k / FPS;
    while (spanIndex < placed.length - 1 && filmT >= placed[spanIndex + 1].out) {
      previousLast = lastOfSpan;
      spanIndex++;
    }
    const { span, out: spanOut } = placed[spanIndex];
    const takeT = span.start + (filmT - spanOut);
    const { data, info } = await source(frameAt(takeT).n);
    const cam = cameraAt(span.camera ?? [], span.start, takeT);
    const region = {
      left: Math.round(Math.min(Math.max(cam.x, 0), info.width - 2)),
      top: Math.round(Math.min(Math.max(cam.y, 0), info.height - 2)),
      width: Math.round(cam.w),
      height: Math.round((cam.w * H) / W),
    };
    region.width = Math.min(region.width, info.width - region.left);
    region.height = Math.min(region.height, info.height - region.top);
    let frame = await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })
      .extract(region)
      .resize(W, H, { kernel: "lanczos3" })
      .raw()
      .toBuffer();
    const into = filmT - spanOut;
    if (previousLast && into < FADE) {
      const p = into / FADE;
      const blended = Buffer.allocUnsafe(frame.length);
      for (let i = 0; i < frame.length; i++) blended[i] = frame[i] * p + previousLast[i] * (1 - p);
      frame = blended;
    }
    lastOfSpan = frame;
    if (!encoder.stdin.write(frame)) await once(encoder.stdin, "drain");
  }
  encoder.stdin.end();
  const [code] = await once(encoder, "close");
  if (code !== 0) throw new Error(`ffmpeg ended with ${code}`);

  // ---- voice: every line where it was read
  const clips = [];
  for (const { span, out: at } of placed) {
    if (span.kind !== "beat") continue;
    const lines = beats.find((x) => x.id === span.id).lines;
    lines.forEach((line, k) => clips.push({ file: join(work, "voice", `${span.id}-${k}.wav`), at: at + span.offsets[k], dur: span.durs[k], sub: line.sub }));
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
  // A step starts where the way to its screen does.
  const chapters = [];
  placed.forEach(({ span, out: at }, index) => {
    const step = beats.find((x) => x.id === span.id)?.step;
    if (step === undefined) return;
    const before = placed[index - 1];
    chapters.push(Math.round((before?.span.id === `${span.id}:move` ? before.out : at) * 10) / 10);
  });
  writeFileSync(join(out, "chapters.json"), JSON.stringify({ name, duration: Math.round(total * 10) / 10, chapters }, null, 1));
  // The poster is the opening card, once it has drawn its steps.
  const intro = placed[0];
  const posterFrame = frameAt(intro.span.start + Math.min(2.6, intro.length - 0.1));
  mkdirSync(join(ROOT, "public", "guide", "videos"), { recursive: true });
  await sharp(join(takeDir, "frames", `${String(posterFrame.n).padStart(6, "0")}.jpg`))
    .jpeg({ quality: 78, mozjpeg: true })
    .toFile(join(ROOT, "public", "guide", "videos", `${guide}.jpg`));

  const size = statSync(film).size / 1024 / 1024;
  const over = take.timeline.filter((s) => s.over > 1.5).map((s) => `${s.id} +${s.over.toFixed(1)}s`);
  console.log(`${guide}: ${total.toFixed(1)}s, ${size.toFixed(1)} MB, chapters ${chapters.map((c) => c.toFixed(1)).join(" ")}${over.length ? `; quiet after the words: ${over.join(", ")}` : ""}`);
}
