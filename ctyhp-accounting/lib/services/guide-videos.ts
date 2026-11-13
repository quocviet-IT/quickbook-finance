import type { SupabaseClient } from "@supabase/supabase-js";
import type { GuideVideo } from "@/lib/domain/system-guide";

/**
 * The guide's narrated videos (3.0.28) live in a Storage bucket of their own,
 * private: anyone signed in may read it (migration 0196), and only the
 * recording script, with the service role, adds to it. A film is a few
 * megabytes, too heavy for the repo the step pictures sit in.
 */
export const GUIDE_VIDEO_BUCKET = "onebook-guide-videos";

/** Long enough to watch a guide twice over a long lunch; short enough that a copied link soon stops working. */
const LINK_SECONDS = 6 * 60 * 60;

export function guideVideoObjects(video: GuideVideo): { film: string; captions: string } {
  return { film: `${video.name}.mp4`, captions: `${video.name}.en.vtt` };
}

export interface GuideVideoLinks {
  film: string;
  captions: string;
}

/**
 * Short-lived links to a guide's film and its captions, asked for as the
 * signed-in reader. Null when either cannot be had (the bucket is missing, or
 * the file has not been uploaded yet): the page then shows its steps alone.
 */
export async function guideVideoLinks(sb: SupabaseClient, video: GuideVideo): Promise<GuideVideoLinks | null> {
  const { film, captions } = guideVideoObjects(video);
  try {
    const { data, error } = await sb.storage.from(GUIDE_VIDEO_BUCKET).createSignedUrls([film, captions], LINK_SECONDS);
    if (error || !data) return null;
    const byPath = new Map(data.map((entry) => [entry.path, entry.signedUrl]));
    const filmUrl = byPath.get(film);
    const captionsUrl = byPath.get(captions);
    if (!filmUrl || !captionsUrl) return null;
    return { film: filmUrl, captions: captionsUrl };
  } catch {
    return null;
  }
}
