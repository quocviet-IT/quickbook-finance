-- 0196 — A bucket for the guide's narrated videos (3.0.28).
--
-- The guides used most get a short video: recorded from the sample company,
-- read by one voice, with English captions. A film is a few megabytes, too
-- heavy for the repo the step pictures live in, so films and their captions go
-- into a Storage bucket of their own.
--
-- Private: the page asks, as the signed-in reader, for a link that lasts a few
-- hours (lib/services/guide-videos.ts), so a film is never at a lasting public
-- address. Anyone signed in may read it, in any company: the videos show the
-- sample company only and are the same for everybody. Nothing here lets a user
-- write: there is no insert, update or delete policy, so only the recording
-- script, with the service role, adds or replaces a film.
--
-- storage.buckets and storage.objects are shared by every company, so running
-- this once per company schema, as scripts/migrate.mjs does, changes nothing
-- after the first time.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'onebook-guide-videos',
  'onebook-guide-videos',
  false,
  52428800,
  array['video/mp4', 'text/vtt']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Guide videos are watched by anyone signed in" on storage.objects;
create policy "Guide videos are watched by anyone signed in"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'onebook-guide-videos');
