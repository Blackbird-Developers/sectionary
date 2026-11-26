-- Migration 21: the welcome questions are for a new account's first sign-in only.
--
-- 0020 left onboarded_at empty on every account, so accounts made before the
-- questions existed got them on their next visit, which read as "every time
-- you sign in". Accounts created before the release (26 Nov 2026, 22:00 UTC)
-- count as done; accounts created after it still get the questions once.

UPDATE users SET onboarded_at = created_at
WHERE onboarded_at IS NULL AND created_at < '2026-11-26 22:00:00+00';
