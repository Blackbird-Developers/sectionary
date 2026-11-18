-- Migration 16: a Saved library next to folders, and saved sites (Blimp Boards, Mobbin-style saving).
--
-- boards.kind          'folder' (every board until now: named, ordered, shareable with a client) or
--                      'library' (an account's one "Saved" list: Save puts a block or site here at once,
--                      folders are optional). The app keeps one library per owner: it reuses the oldest,
--                      and a token library claimed by an account that already has one becomes a folder.
-- board_items.site_host A whole site saved, by host. An item is now a block or a site, never both:
--                      block_id becomes optional and the check below holds exactly one of the two.
--
-- Old rows are untouched: every existing board is a folder and every existing item is a block.
-- Hand-written, mirrored in platform/src/schema.ts.

ALTER TABLE boards ADD COLUMN kind text NOT NULL DEFAULT 'folder' CHECK (kind IN ('folder', 'library'));
CREATE INDEX boards_owner_kind_idx ON boards(owner_id, kind);

ALTER TABLE board_items
  ALTER COLUMN block_id DROP NOT NULL,
  ADD COLUMN site_host text REFERENCES sites(host) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT board_items_block_or_site CHECK (num_nonnulls(block_id, site_host) = 1);

-- A site once per board. NULLs are distinct, so block rows never collide here.
CREATE UNIQUE INDEX board_items_board_site_uidx ON board_items(board_id, site_host);
CREATE INDEX board_items_site_idx ON board_items(site_host);
