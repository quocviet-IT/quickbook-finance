"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { WarningOutlined } from "@ant-design/icons";
import type { GuideFlow, GuideVideo as GuideVideoData } from "@/lib/domain/system-guide";
import { videoChapterLabel } from "@/lib/domain/guide-help";

/** A guide's video, with the short-lived links the page asked for. */
export interface GuideVideoSource extends GuideVideoData {
  film: string;
  captions: string;
}

export interface GuideVideoHandle {
  /** Plays from where step `index` (from 0) starts, bringing the film into view. */
  playFrom(index: number): void;
}

/**
 * A guide's narrated video (3.0.28), at the top of its page: the browser's own
 * player, English captions on, and under it the steps, each a button that
 * plays from where that step starts. The step playing is marked as it plays.
 * A film that cannot be played says so; the steps below still read on their own.
 */
const GuideVideo = forwardRef<GuideVideoHandle, { flow: GuideFlow; video: GuideVideoSource }>(function GuideVideo(
  { flow, video },
  ref,
) {
  const player = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState<number | null>(null);

  const playFrom = (index: number) => {
    const film = player.current;
    if (!film) return;
    film.currentTime = video.chapters[index] ?? 0;
    // A browser may refuse to start on its own; the reader then presses play.
    void film.play().catch(() => undefined);
  };

  useImperativeHandle(ref, () => ({
    playFrom(index: number) {
      player.current?.scrollIntoView({ block: "start", behavior: "smooth" });
      playFrom(index);
    },
  }));

  const followTime = () => {
    const at = player.current?.currentTime ?? 0;
    const index = video.chapters.findLastIndex((start) => start <= at + 0.05);
    setPlaying(index >= 0 ? index : null);
  };

  if (failed) {
    return (
      <p className="guide-video__failed" role="status">
        <WarningOutlined /> The video could not be played. The steps below show the same, one at a time.
      </p>
    );
  }

  return (
    <section className="guide-video" aria-label={`Video: ${flow.title}`}>
      <video
        ref={player}
        className="guide-video__film"
        controls
        preload="metadata"
        playsInline
        // The film and its captions come from Supabase Storage: without CORS the captions are dropped.
        crossOrigin="anonymous"
        poster={`/guide/videos/${flow.id}.jpg`}
        onError={() => setFailed(true)}
        onTimeUpdate={followTime}
      >
        <source src={video.film} type="video/mp4" onError={() => setFailed(true)} />
        <track kind="captions" src={video.captions} srcLang="en" label="English" default />
      </video>
      <ol className="guide-video__chapters" aria-label="Steps in the video">
        {flow.steps.map((step, index) => (
          <li key={`${flow.id}-chapter-${index}`}>
            <button
              type="button"
              className={`guide-video__chapter${playing === index ? " guide-video__chapter--playing" : ""}`}
              aria-label={`Play step ${index + 1}, ${step.action}, from ${videoChapterLabel(video.chapters[index] ?? 0)}`}
              aria-current={playing === index ? "step" : undefined}
              onClick={() => playFrom(index)}
            >
              <span className="guide-video__n" aria-hidden="true">
                {index + 1}
              </span>
              <span className="guide-video__action">{step.action}</span>
              <time className="guide-video__at">{videoChapterLabel(video.chapters[index] ?? 0)}</time>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
});

export default GuideVideo;
