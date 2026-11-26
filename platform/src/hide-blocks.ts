// Hide blocks from the Blocks page (migration 0019): they stay on their store's page in Sites; nothing is deleted.
//
//   npm run hide-blocks -- --from <answers.jsonl> [--except <file>] [--apply]
//       Hide every block a review answered "hide" for. answers.jsonl has one JSON object a line:
//       {"id": "<block uuid>", "action": "keep" | "hide" | "retake", "issue": "...", "score": 1-5, "reason": "..."}
//       (the 26 Nov 2026 Haiku review writes exactly this). --except names a file whose block ids are left alone:
//       any text with uuids in it, such as the review sheet's "Copy my ticks" output.
//   npm run hide-blocks -- --unhide <file> [--apply]
//       Bring back every block whose id is in the file.
//   npm run hide-blocks -- --status
//       How many blocks are hidden, by issue.
//
// Without --apply nothing is written: it says what would change. With --apply it writes, then rebuilds the wall's
// set (wall_shown) so the Blocks page shows the change at once. Environment: DATABASE_URL (platform/.env).

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";
import { refreshWall } from "./wall.js";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export interface ReviewAnswer { id: string; action: string; issue?: string; score?: number; reason?: string }
export interface HidePlan { hide: { id: string; reason: string }[]; excepted: number; notHide: number; invalid: number }

/** Review answers from JSONL text. Lines that are not an object with a block id and an action are counted, not thrown. */
export function parseAnswers(text: string): { answers: ReviewAnswer[]; invalid: number } {
  const answers: ReviewAnswer[] = [];
  let invalid = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const a = JSON.parse(line) as Partial<ReviewAnswer>;
      if (typeof a.id === "string" && new RegExp(`^${UUID.source}$`, "i").test(a.id) && typeof a.action === "string") answers.push(a as ReviewAnswer);
      else invalid += 1;
    } catch { invalid += 1; }
  }
  return { answers, invalid };
}

/** Every block id in a piece of text, lower-cased and once each. */
export function idsIn(text: string): Set<string> {
  return new Set((text.match(UUID) ?? []).map((id) => id.toLowerCase()));
}

/** What a hidden block records as its reason: short, and says it came from a review. */
export function reasonOf(a: ReviewAnswer): string {
  const score = typeof a.score === "number" ? ` (${a.score}/5)` : "";
  const why = (a.reason ?? "").replace(/\s+/g, " ").trim();
  return `review: ${a.issue || "hide"}${score}${why ? `: ${why}` : ""}`.slice(0, 300);
}

/** The blocks to hide: answered "hide", not in `except`. The last answer for a block wins. */
export function planHides(answers: ReviewAnswer[], except: Set<string> = new Set(), invalid = 0): HidePlan {
  const last = new Map(answers.map((a) => [a.id.toLowerCase(), a]));
  const hide: HidePlan["hide"] = [];
  let excepted = 0, notHide = 0;
  for (const [id, a] of last) {
    if (a.action !== "hide") { notHide += 1; continue; }
    if (except.has(id)) { excepted += 1; continue; }
    hide.push({ id, reason: reasonOf(a) });
  }
  return { hide, excepted, notHide, invalid };
}

/** A uuid[] parameter as a Postgres array literal (cast with ::uuid[]): with prepare: false a fresh pool sends sql.array() wrongly (web/src/server/db.ts, pgArray). */
export const uuidArray = (ids: string[]) => `{${ids.join(",")}}`;
/** A text[] parameter the same way, each value quoted (cast with ::text[]). */
export const textArray = (values: string[]) => `{${values.map((v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;

async function main() {
  try { process.loadEnvFile(resolve(import.meta.dirname, "../.env")); } catch {}
  const args = process.argv.slice(2);
  const option = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
  const apply = args.includes("--apply");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required (set it in platform/.env)");
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  const CHUNK = 1000;
  try {
    if (args.includes("--status")) {
      const rows = await sql`SELECT coalesce(substring(wall_hidden_reason FROM '^review: ([a-z-]+)'), 'other') AS issue, count(*)::int AS n
        FROM blocks WHERE wall_hidden GROUP BY 1 ORDER BY 2 DESC`;
      const total = rows.reduce((t, r) => t + (r.n as number), 0);
      console.log(`${total} blocks hidden from the Blocks page${rows.length ? `: ${rows.map((r) => `${r.issue} ${r.n}`).join(", ")}` : ""}`);
      return;
    }

    const unhideFile = option("unhide");
    if (unhideFile) {
      const ids = [...idsIn(await readFile(unhideFile, "utf8"))];
      const [{ n }] = await sql`SELECT count(*)::int AS n FROM blocks WHERE id = ANY(${uuidArray(ids)}::uuid[]) AND wall_hidden`;
      console.log(`${ids.length} ids in ${unhideFile} · ${n} of them hidden now${apply ? "" : " · dry run, nothing changed (add --apply)"}`);
      if (!apply) return;
      let changed = 0;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const part = ids.slice(i, i + CHUNK);
        const res = await sql`UPDATE blocks SET wall_hidden = false, wall_hidden_reason = NULL, wall_hidden_at = NULL
          WHERE id = ANY(${uuidArray(part)}::uuid[]) AND wall_hidden`;
        changed += res.count;
      }
      console.log(`Brought back ${changed} blocks.`);
      await refreshWall(sql);
      return;
    }

    const from = option("from");
    if (!from) throw new Error("say what to hide: --from <answers.jsonl> (or --unhide <file>, or --status)");
    const { answers, invalid } = parseAnswers(await readFile(from, "utf8"));
    const exceptFile = option("except");
    const except = exceptFile ? idsIn(await readFile(exceptFile, "utf8")) : new Set<string>();
    const plan = planHides(answers, except, invalid);
    const ids = plan.hide.map((h) => h.id);
    let found = 0, already = 0;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const [r] = await sql`SELECT count(*)::int AS found, count(*) FILTER (WHERE wall_hidden)::int AS already
        FROM blocks WHERE id = ANY(${uuidArray(ids.slice(i, i + CHUNK))}::uuid[])`;
      found += r.found; already += r.already;
    }
    console.log([
      `${answers.length} answers in ${from}${invalid ? ` (${invalid} unreadable lines)` : ""}`,
      `${plan.hide.length} to hide`, `${plan.notHide} keep or retake`, plan.excepted ? `${plan.excepted} left alone (--except)` : "",
      `${found} of the ${plan.hide.length} exist`, already ? `${already} already hidden` : "",
    ].filter(Boolean).join(" · "));
    if (!apply) { console.log("Dry run: nothing changed. Add --apply to hide them."); return; }
    let changed = 0;
    for (let i = 0; i < plan.hide.length; i += CHUNK) {
      const part = plan.hide.slice(i, i + CHUNK);
      const res = await sql`UPDATE blocks b SET wall_hidden = true, wall_hidden_reason = h.reason, wall_hidden_at = now()
        FROM unnest(${uuidArray(part.map((h) => h.id))}::uuid[], ${textArray(part.map((h) => h.reason))}::text[]) AS h(id, reason)
        WHERE b.id = h.id AND NOT b.wall_hidden`;
      changed += res.count;
    }
    console.log(`Hid ${changed} blocks from the Blocks page (they stay on their store's page).`);
    await refreshWall(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) await main();
