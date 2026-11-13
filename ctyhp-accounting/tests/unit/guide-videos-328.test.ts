import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GUIDE_FLOWS } from "@/lib/domain/system-guide";
import { RELEASES } from "@/lib/domain/changelog";
import { guideCardMeta, videoChapterLabel } from "@/lib/domain/guide-help";
import { GUIDE_VIDEO_BUCKET, guideVideoObjects } from "@/lib/services/guide-videos";

/**
 * 3.0.28: a narrated video at the top of the guides people use most, recorded
 * from the sample company by scripts/guide-videos, read by one voice, with
 * captions and a mark where each step starts. The files live in their own
 * Supabase Storage bucket; the page asks for short-lived links to them.
 */

const ROOT = process.cwd();
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8").replace(/\r\n/g, "\n");
const withVideo = GUIDE_FLOWS.filter((flow) => flow.video);
const FIRST = ["get-paid", "quote-a-price", "bank-lines-in", "reconcile-by-hand"];

describe("the guides with a video (3.0.28)", () => {
  it("starts with the four guides used most", () => {
    expect(withVideo.map((flow) => flow.id)).toEqual(expect.arrayContaining(FIRST));
  });

  it("marks where every step starts, in order, inside the video", () => {
    for (const flow of withVideo) {
      const video = flow.video!;
      expect(video.chapters, flow.id).toHaveLength(flow.steps.length);
      video.chapters.forEach((at, index) => {
        expect(at, `${flow.id} step ${index + 1}`).toBeGreaterThanOrEqual(0);
        if (index > 0) expect(at, `${flow.id} step ${index + 1}`).toBeGreaterThan(video.chapters[index - 1]);
      });
      expect(video.chapters.at(-1)!, flow.id).toBeLessThan(video.duration);
    }
  });

  it("names each video by its guide and the release it was recorded for, so a new take never reuses a cached file", () => {
    for (const flow of withVideo) {
      expect(flow.video!.name, flow.id).toMatch(new RegExp(`^${flow.id}-\\d+\\.\\d+\\.\\d+$`));
    }
  });

  it("keeps the film and its English captions side by side in the bucket", () => {
    expect(guideVideoObjects({ name: "get-paid-3.0.28", duration: 60, chapters: [0] })).toEqual({
      film: "get-paid-3.0.28.mp4",
      captions: "get-paid-3.0.28.en.vtt",
    });
  });

  it("says on the card and the page that a guide has a video, and how long it runs", () => {
    const flow = withVideo[0];
    expect(guideCardMeta(flow)).toContain(`Video · ${videoChapterLabel(flow.video!.duration)}`);
    expect(videoChapterLabel(0)).toBe("0:00");
    expect(videoChapterLabel(7.4)).toBe("0:07");
    expect(videoChapterLabel(83.9)).toBe("1:23");
  });
});

describe("where the videos are kept (3.0.28)", () => {
  const migration = read("supabase", "migrations", "0196_guide_videos.sql");

  it("is a private bucket of its own, for MP4 films and WebVTT captions only", () => {
    expect(GUIDE_VIDEO_BUCKET).toBe("onebook-guide-videos");
    expect(migration).toMatch(/insert into storage\.buckets[\s\S]*'onebook-guide-videos'[\s\S]*false/);
    expect(migration).toMatch(/'video\/mp4'/);
    expect(migration).toMatch(/'text\/vtt'/);
  });

  it("lets anyone signed in watch, and nobody but the recording script add or change a film", () => {
    expect(migration).toMatch(/on storage\.objects\s+for select\s+to authenticated\s+using \(bucket_id = 'onebook-guide-videos'\)/);
    // No insert, update or delete policy: only the service role writes there.
    expect(migration).not.toMatch(/for (insert|update|delete)[\s\S]*onebook-guide-videos/);
  });

  it("asks for short-lived links on the server, never handing the browser a lasting one", () => {
    const service = read("lib", "services", "guide-videos.ts");
    expect(service).toMatch(/createSignedUrls\(/);
    const page = read("app", "(app)", "guide", "[id]", "page.tsx");
    expect(page).toMatch(/guideVideoLinks\(/);
  });
});

describe("the guide's page plays it (3.0.28)", () => {
  const view = read("app", "(app)", "guide", "[id]", "GuideVideo.tsx");

  it("plays with the browser's own controls, captions on, starting on the first step's picture", () => {
    expect(view).toMatch(/<video[\s\S]*controls/);
    expect(view).toMatch(/<track[\s\S]*kind="captions"[\s\S]*srcLang="en"[\s\S]*default/);
    // The captions come from another origin: without CORS the browser drops them.
    expect(view).toMatch(/crossOrigin="anonymous"/);
    expect(view).toMatch(/poster=/);
  });

  it("lists the steps under the film, each a button that plays from where it starts", () => {
    expect(view).toMatch(/aria-label=\{`Play step \$\{index \+ 1\}/);
    expect(read("app", "(app)", "guide", "[id]", "GuideFlowView.tsx")).toMatch(/Play this step/);
  });

  it("says so when the film cannot be played, and the steps below still read on their own", () => {
    expect(view).toMatch(/onError=/);
    expect(view).toMatch(/could not be played/);
  });
});

describe("how the videos are made (3.0.28)", () => {
  it("records, voices and builds them with the scripts in scripts/guide-videos", () => {
    for (const file of ["narration.json", "tts.py", "overlay.js", "record.mjs", "build.mjs", "upload.mjs"]) {
      expect(existsSync(join(ROOT, "scripts", "guide-videos", file)), file).toBe(true);
    }
  });

  it("narrates every step of every guide that has a video, one beat per step", () => {
    const narration = JSON.parse(read("scripts", "guide-videos", "narration.json")) as {
      guides: Record<string, { beats: Array<{ id: string; step?: number; lines: Array<{ say: string; sub: string }> }> }>;
    };
    for (const flow of withVideo) {
      const beats = narration.guides[flow.id]?.beats ?? [];
      const steps = beats.filter((beat) => beat.step !== undefined).map((beat) => beat.step);
      expect(steps, flow.id).toEqual(flow.steps.map((_, index) => index + 1));
      for (const beat of beats) expect(beat.lines.length, `${flow.id} ${beat.id}`).toBeGreaterThan(0);
    }
  });

  it("opens each film on a card of the guide's own title, purpose and steps", () => {
    const narration = JSON.parse(read("scripts", "guide-videos", "narration.json")) as {
      guides: Record<string, { card: { title: string; purpose: string; steps: string[] } }>;
    };
    for (const [id, body] of Object.entries(narration.guides)) {
      const flow = GUIDE_FLOWS.find((candidate) => candidate.id === id);
      expect(flow, id).toBeDefined();
      expect(body.card).toEqual({ title: flow!.title, purpose: flow!.purpose, steps: flow!.steps.map((step) => step.action) });
    }
  });

  it("records only the sample company", () => {
    const record = read("scripts", "guide-videos", "record.mjs");
    expect(record).toMatch(/\.eq\("slug", "meridian"\)/);
    expect(record).toMatch(/is_sample/);
  });
});

describe("the release note (3.0.28)", () => {
  it("says the guides used most now have a video", () => {
    const release = RELEASES.find((candidate) => candidate.version === "3.0.28");
    expect(release).toBeDefined();
    const said = (release?.changes ?? []).map((change) => `${change.title} ${change.detail ?? ""}`).join(" ");
    expect(said).toContain("video");
    expect(said).toContain("caption");
  });
});
