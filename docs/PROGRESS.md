# Progress

The session log (SEC-35). One entry per working session, newest first: what
moved, what is waiting and on whom, and anything the next person needs to know.
PLAN.md changes only when scope does; the board mirrors every work item.

Earlier sessions are in Ben's vault copy (To Do's/New APP Mobbin Recreate).
This file starts on 2026-10-01 so every lane can append to it.

## 2026-11-26 · Ben (with Claude)

**Block review and the hide mark (migration 0019).** Many blocks on the Blocks
page offer nothing to someone browsing (a lone photo, a copyright sliver, a bare
line of text, a "collection is empty" page). They stay part of their page, so
Sites keeps them: `blocks.wall_hidden` takes a block off the Blocks page only.

- Review: Claude Haiku 5.5 over every block then on the wall (22,867, Message
  Batches, $1.61): keep 18,122, hide 3,873, retake 801. Rules settled in a
  300-block pilot with Ben: judge a block against its own kind; complete page
  parts (headers, footers, carts including empty carts, grids, forms) are kept.
  The run's files are in `_tmp/block-review/` on Ben's PC (not in the repo).
- Migration 0019: `wall_hidden`, `wall_hidden_reason`, `wall_hidden_at`;
  `wall_shown` rebuilt with `AND NOT b.wall_hidden`; the blocks trigger watches
  `wall_hidden`; `blocks_wall_idx` covers it. When a shown block is hidden, the
  store's next copy of that section takes its place.
- `npm run hide-blocks -- --from answers.jsonl [--except ticks.txt] [--apply]`,
  `--unhide <file>`, `--status`. Dry run unless `--apply`; rebuilds the wall after.
- `wall.test.ts`: "nothing changed ... one rebuild" picked the lowest block id,
  which is random per import, and failed whenever that block's section had no
  second copy. It now picks a block that has one.
- Waiting: the team's review and merge (the migration needs `npm run db:migrate`
  on production), then Ben's approval of the hides before `--apply`.

## 2026-11-20 · Buna (Lane B)

**SEC-31 in production (AWS).** Merging #55 and #56 deployed to ECS (checked
by image digest). Production migrations 0001–0016 all applied: 0016 had
been applied by hand and is now recorded. Backup before any change:
a full \`pg_dump\` of \`public\`, kept off the repo.

- MCP plans (#56): every plan can connect. Free gets the taxonomy, and every
  library tool answers with how to upgrade, never data. The trial gets
  everything plus its end date. Library data stays Pro and Team.
- Free rule tagger written to production: 81,302 of 117,225 blocks (69.4%)
  have a \`block_type\` (product 70%, home 62%, collection 76%, cart 80%). The
  95% target needs the paid AI tagger on the rest (\`--untagged-only\`), and
  that needs the owner's spend approval.
- \`benchmarks\` run on production: 2,444 rows, none under n = 10 (page length,
  block count, images per screen, block types per page). Store design profiles:
  0, because no production capture has \`--styles\` yet.
- The 20-store accuracy review is ready to do: [ACCURACY-REVIEW.md](ACCURACY-REVIEW.md).
- Open: \`PLAN_GATES\` and the Paddle prices are not set on the ECS service;
  the Vercel URL has not changed since about 3 Nov; \`account:acceptance\` fails one
  check on \`main\` ("Free: filters other than Store and Block type are
  dropped", 86 vs 172), which needs its own fix. \`blimp_compare_stores\` waits for
  the compare pilot.

## 2026-11-19 · Codex

**SEC-31 repository completion pass.** The contract gaps found in review are
closed: imports now rebuild L3 profiles and L4 benchmarks; `blimp_get_block`
supports selective `include`; the public store-design answer uses the shared
response cache while signed-in accessibility data remains private; and capture
hard-enforces the 20 KB design-metadata budget per viewport, marking trimmed
profiles partial. MCP evaluation (ten pinned questions, HTTP parity and source
safety), all 52 platform tests, all 11 web tests, all 42 root tests, the 31
browser style checks, and all three type-checks pass.

Still an operational release gate, not something this checkout can truthfully
mark done: the human 20-store browser/devtools accuracy comparison, production
tagging/import/embedding/recapture, and `blimp_compare_stores` after the compare
pilot defines its aligned-comparison contract.

## 2026-11-18 · Buna (Lane B)

**SEC-31: MCP v2, the design data API, design-aware search.** On `buna`, not
pushed. No migration.

- MCP v2: `blimp_get_store_design`, `blimp_get_page_profile`,
  `blimp_get_store_flow`, `blimp_get_benchmark`, `blimp_find_similar_blocks`
  (brief step 8). `npm run mcp:eval` in `web/` runs the ten evaluation
  questions against the fixtures through the real route: all pass.
- Brief section 8 (step 5): `GET /api/blocks/[id]` now carries tagger output,
  style and outline (`BlockDetail`); new `/api/sites/[host]/design`,
  `/api/benchmarks`, `/api/taxonomy`. Contract commit separate, with real
  fixtures in `fixtures/api/`; Lane C please review. A store's own
  accessibility signals go to signed-in accounts only.
- Brief 7.4: blocks from `--styles` captures are embedded with their outline's
  heading and button text and the store's design summary. After an import
  run `profile-sites`, `benchmarks`, then `embed`.
- Size budget: the only `--styles` fixture (myzoobox.com product page, 5
  blocks) adds 12.7 KB desktop and 11.5 KB mobile, about 2 KB a block, so a
  20-block home page may pass 20 KB. Measure on a long page before turning
  `--styles` on by default.
- Waiting: the 20-store accuracy check (a person with dev tools, brief
  section 10), then `--styles` on by default and a recapture; production runs
  of the tagger, `profile-sites`, `benchmarks` and `embed`; owner decisions in
  brief section 12 item 3 (thumbnails or full screenshots; item 2 decided:
  the MCP stays in Pro and Team);
  `blimp_compare_stores` after the compare pilot.

## 2026-10-28 · Buna (Lane B)

**Free plan with a 7-day trial, two-step sign-in, session fix.** On `buna`.

- Free plan, mostly the "free trial, then locked" model with two pieces of
  "blur the good stuff": every account gets Pro for 7 days, no card; after
  that Free opens 3 blocks a day, filters by Store and Block type only, has no
  Copy as brief, time machine, copy image or source link, and its boards are
  read-only. Signed out: blurred wall, and opening a block asks for an account.
  Enforced by the API (`can(access, feature)` in `server/plans.ts`), shown in
  the UI as locks and a trial badge in the app bar.
- Two-step sign-in with an authenticator app (TOTP), optional per account on
  the account page: QR setup, ten recovery codes, `/auth/two-step` after the
  email link, five tries, codes usable once.
- Session fix: the cookie is now renewed when the session slides (it used to
  expire 30 days after sign-in however often it was used). Sign out everywhere.
- Migration `0010_trial_two_step.sql` and the new `AUTH_ENCRYPTION_KEY`
  variable: see [AUTH-AND-BILLING.md](AUTH-AND-BILLING.md). `npm run
  account:acceptance` covers all of it and passes.
- Lane C files touched, for Leke's review: block dialog (locks), filter bar
  (locks), block card (blur), app bar (trial badge), account page (two-step card).

## 2026-10-15 · Buna (Lane B)

**SEC-27 · auth with magic links.** Built on `buna`. Supabase sends the link
and a six-digit code; the link uses the token-hash pattern and lands on
`/auth/confirm`, which signs in on a button press (mail scanners cannot use up
the token). The app keeps its own httpOnly session cookie, not Supabase's
JWT. `/account` signs in, shows the plan and signs out. Boards now belong to
the signed-in account; token boards are claimed on the first signed-in visit.
Migration `0009_accounts_billing.sql` (not yet applied to Supabase).

**SEC-28 · plans and Paddle billing.** Free, Pro, Team. Paddle.js checkout on
`/account`, signed webhooks at `/api/paddle/webhook` (idempotent, ordered),
customer portal for card, invoices and cancelling. Gates: Free has a daily
cap on opened blocks (`POST /api/views`) and no boards. **The gates stay off
until `PLAN_GATES=on`**, so staging keeps working for us.

- `npm run account:acceptance` (web/): 41 checks against a throwaway Postgres,
  a stand-in Supabase Auth and signed webhooks, all passing. Also driven in
  Chromium at 375px and 1280px against `next dev` (link on a second device,
  code, used link, gates, purchase, cancellation, sign out): all passing.
  WebKit (Safari's engine) not run: its download failed on this PC.
- Waiting on Ben: apply the migration; Supabase Site URL, custom SMTP and the
  two email templates; Paddle sandbox products, tokens and webhook; the Vercel
  variables. All listed in [AUTH-AND-BILLING.md](AUTH-AND-BILLING.md). The
  "done when" checks (real Safari, Chrome, a phone, a sandbox purchase and
  cancellation) need that setup.
- Contract: additive `Account`, `Plan`, `ViewCheck`, `GET /api/account`,
  `GET /api/boards`, `POST /api/views`. Raise in "Contracts v1".
- Lane C files touched, for Leke's review: `/account` and `/auth/confirm`
  pages, the account icon in the app bar, the limit panel in the block
  dialog, and the sign-in and plan gate messages in the boards components.
- Follow-up: Team seat invites.

**Ops · infrastructure.** [OPS.md](OPS.md) records what exists (Supabase,
DigitalOcean Spaces instead of R2, Vercel) and what is open (VPS, capped
Anthropic and Voyage keys). `ops/vps-setup.sh` sets up an Ubuntu VPS with
Playwright and the settings file outside the repo; `npm run hello-capture` is
the done-when check (capture, upload, read back). Not run yet: this PC has no
bucket key, and the VPS does not exist yet.

## 2026-10-01 · Leke (Lane C)

**SEC-47 · the app on the API.** In review as PR #15 (leke → main).

- With the API settings on, every page used to fetch one page of
  `/api/blocks` and `/api/stores` (60 rows) and treat it as the whole
  library: the wall showed 60 blocks and Flows counted 4 stores of 15.
- The wall now sends each query to `/api/blocks` and pages through the
  cursor; the sample JSON path still works for local development. Both sit
  behind one `WallSource` (`web/src/lib/load-blocks.ts`).
- `/api/blocks` gained `video` and `color` filters, facets for every filter
  and `nearMiss`, in one SQL pass that gives the same results as the browser
  code (checked on nine filter combinations). `GET /api/blocks/[id]` makes
  pasted `?open=` links work.
- A Store filter (`?host=`) on the wall. It also fixes the site profile's
  "See all N blocks" link, which was being ignored.
- `GET /api/sites` lists every store with its latest pages; Sites and Flows
  read it. Counts match the database.
- The M2 exit test passes against a local Postgres with the fixture
  manifests imported, at phone width.
- Waiting: a staging deployment, which needs the Vercel host (SEC-34,
  SEC-48). Staging sets `DATABASE_URL` and `NEXT_PUBLIC_BLOCKS_SRC`,
  `_STORES_SRC`, `_SITES_SRC` as in `web/.env.example`, and imports with
  `S3_PUBLIC_BASE_URL` so block images resolve.
- Waiting: a contract PR for `video`, `color`, `nearMiss`, comma-separated
  `vp` and `GET /api/sites`, to be raised in SEC-37 first. Lane B (Buna) to
  review the API changes in PR #15.
- Open question: on the API the flow view and the page viewer show full-page
  screenshots, not clickable blocks with markers as on the sample. Switching
  is small if wanted.

**SEC-25 · waitlist.** The `waitlist` table now exists in Supabase, with RLS
on and recorded in `sectionary_migrations` beside the earlier migrations, so
`npm run db:migrate` stays safe. Waiting: `DATABASE_URL` in Vercel (same step
as staging) so sign-ups save, and the domain (SEC-33).

**Housekeeping.** Stale uncommitted work from 2026-09-23 (an early
server-side block index) is parked on branch `wip/block-index-0923`. It is
superseded by PR #15 and can be deleted after that merges.
