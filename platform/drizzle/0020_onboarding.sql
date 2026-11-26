-- Migration 20: the two questions after a first sign-in (web/src/components/onboarding-dialog.tsx).
--
-- "What do you do?" is one role; "What do you want to see?" is any number of
-- page types (the wall's `page` filter values) and industries (its `industry`
-- filter values). Stored as given, for picking designs later; nothing reads
-- them for access. onboarded_at is set by Continue and by Skip alike, so the
-- questions are asked once per account. Existing accounts get them on their
-- next visit.
--
-- sectionary_app already has INSERT and UPDATE on users (0012), which covers new columns.

ALTER TABLE users
  ADD COLUMN role text,
  ADD COLUMN interest_pages text[] NOT NULL DEFAULT '{}',
  ADD COLUMN interest_industries text[] NOT NULL DEFAULT '{}',
  ADD COLUMN onboarded_at timestamptz;
