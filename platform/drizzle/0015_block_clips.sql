-- Migration 15: clips (video-sections brief; manifest contract #41, crawler #46).
--
-- blocks.motion_hint   What moves in the block (video, embed, carousel, marquee, animation): the crawler's
--                      motion hint, set even when the block turned out not to move and has no clip.
-- blocks.clip          The block's recording: { kind, url, width, height, durationMs, bytes, rect } (the
--                      contract's BlockClip). url is the public MP4; the block's image is its poster. rect is
--                      the recorded part in CSS pixels from the block's top-left corner.
--
-- Both null for captures made without --clips, so old captures read exactly as before.
-- Hand-written, mirrored in platform/src/schema.ts. The web app reads them through the table's
-- existing SELECT (migration 12); the importer writes them as the owner.

ALTER TABLE blocks ADD COLUMN motion_hint text, ADD COLUMN clip jsonb;
