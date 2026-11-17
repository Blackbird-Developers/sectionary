// Re-names blocks captured before 10 Nov 2026 with the rules typeHintFor (src/page-script.ts) uses now:
//  - a Shopify section key that is only an ID (1148845a-a334-..., 16359276425da8ce) is no longer the type;
//  - a key's last plain word is kept (image_banner was "image", featured_collection was "featured");
//  - the block of a cart page that says the cart is empty is "empty-cart" (src/empty-cart.ts, since 17 Nov).
// Only what a capture stores can be used here: the element's id, classes, tag, height and heading.
// Nothing inside the block is stored, so a block that only said what it was further down becomes
// "unknown" here; the AI tagger (platform/src/tagger.ts) names those from the screenshot.
//
//   npm run retype-blocks              dry run: what would change, changes nothing
//   npm run retype-blocks -- --write   updates the blocks table and the manifests under data/, after
//                                      saving every old value to data/_retype/<time>.json
//
// Keep the rules below in step with typeHintFor in src/page-script.ts.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isEmptyCartBlock } from './empty-cart.js';

export type Stored = {
  typeHint: string;
  parentType: string | null;
  elementId: string | null;
  classes: string | null;
  headline: string | null;
  tag: string | null;
  height: number | null;
  /** The page's type (home, collection, product, cart ...) and the block's text, for the empty-cart rule. */
  pageType?: string | null;
  text?: string | null;
};

export function isIdKey(key: string): boolean {
  const k = key.toLowerCase().replace(/^(?:template|sections)--\d+__/, '');
  return (
    k === '' ||
    /^\d+$/.test(k) ||
    /^1\d{9}[0-9a-f]*$/.test(k) ||
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){1,3}(?:-[0-9a-f]+)?$/.test(k) ||
    /^(?=.*\d)[0-9a-f-]{12,}$/.test(k)
  );
}

/** The clean-up the crawler used until 10 Nov 2026: how a stored name was made from its key. */
export function oldNameFromKey(key: string): string {
  return key.replace(/_[A-Za-z0-9]{6,}$/, '').replace(/[-_]?\d+$/, '').replace(/_/g, '-').toLowerCase();
}

export function nameFromKey(key: string): string {
  return key
    .replace(/_(?=[A-Za-z0-9]*[A-Z0-9]|[b-df-hj-np-tv-xz]+$)[A-Za-z0-9]{6,}$/, '')
    .replace(/[-_]?\d+$/, '')
    .replace(/_/g, '-')
    .toLowerCase()
    .replace(/-(?:[0-9a-f]{8}(?:-[0-9a-f]{4}){1,3}(?:-[0-9a-f]*)?|1\d{9}[0-9a-f]*)$/, '')
    .replace(/(.)-sections?$/, '$1');
}

const notAName = /^(?:group-.*|template-.*|wrapper|padding.*|full-?width|container|inner|outer|content|default|new|spacing.*|spaced|index|home|page|main|custom|(?:custom-)?apps?(?:-wrapper)?|loaded|blocks?|theme-.*|light|dark|wide|narrow|.*bleed|bg-.*|colou?r.*|scheme.*|mobile|desktop|top|bottom|first|last|animate.*|visible|hidden|margin.*|gutter.*|no-.*|with-.*|has-.*|is-.*|vue|module|items?|wrap|global|shopify)$/;
export function nameFromClasses(cls: string): string | null {
  for (const c of cls.split(/\s+/)) {
    const m = /^(?:shopify-)?section-{1,2}([a-z][a-z0-9-]*[a-z0-9])$/.exec(c) || /^([a-z][a-z0-9-]*[a-z0-9])-section$/.exec(c);
    if (m && !notAName.test(m[1]) && !isIdKey(m[1])) return m[1];
  }
  return null;
}

const keys: [string, string][] = [
  ['announcement', 'announcement'], ['hero', 'hero'], ['banner', 'banner'], ['slideshow', 'slideshow'], ['testimonial', 'testimonial'],
  ['review', 'review'], ['jdgm', 'review'], ['yotpo', 'review'], ['okendo', 'review'], ['loox', 'review'], ['stamped', 'review'],
  ['faq', 'faq'], ['newsletter', 'newsletter'], ['instafeed', 'instagram'], ['instagram', 'instagram'], ['pricing', 'pricing'],
  ['image-with-text', 'image-with-text'], ['rich-text', 'rich-text'], ['multicolumn', 'multicolumn'], ['multi-column', 'multicolumn'],
  ['collapsible-content', 'collapsible-content'], ['collage', 'collage'],
  ['featured-collection', 'featured-collection'], ['featured-product', 'featured-product'], ['feature', 'feature'], ['logo', 'logo'],
  ['video', 'video'], ['collection', 'collection'], ['product', 'product'], ['gallery', 'gallery'], ['cta', 'cta'], ['contact', 'contact'],
  ['team', 'team'], ['blog', 'blog'], ['footer', 'footer'], ['header', 'header'],
];
const keyIn = (words: string, skip: string[] = []): string | null => {
  const w = words.replace(/preview/g, ' ');
  for (const [k, type] of keys) if (!skip.includes(k) && w.includes(k)) return type;
  return null;
};
const headings: [RegExp, string][] = [
  [/\b(faqs?|frequently asked|questions)\b/i, 'faq'],
  [/\b(reviews?|testimonials?|what (our )?customers (say|are saying))\b/i, 'review'],
  [/\b(instagram|tiktok|follow us)\b|(^|\s)@[a-z0-9_.]{3,}/i, 'instagram'],
  [/\b(newsletter|mailing list|join our (list|community)|sign up for (our )?(emails?|updates|newsletter))\b/i, 'newsletter'],
  [/\b(blog|journal|articles)\b/i, 'blog'],
  [/\b(as seen (in|on)|featured in|in the press)\b/i, 'logo'],
  [/\b(you may also like|recommended for you|related products|complete the look)\b/i, 'product-recommendations'],
  [/\b(best ?sellers?|new arrivals?|top picks|trending now)\b/i, 'featured-collection'],
  [/\b(shop by (category|collection)|our collections)\b/i, 'collection-list'],
];

/** typeHintFor's fallbacks for a block with no usable key, from its stored fields. */
function fromStoredClues(b: Stored, wrapper: boolean): string {
  const cls = (b.classes || '').toLowerCase();
  if (wrapper) {
    const named = nameFromClasses(cls);
    if (named) return named;
  }
  const tag = (b.tag || '').toLowerCase();
  if (tag === 'header') return 'header';
  if (tag === 'footer') return 'footer';
  if (tag === 'nav') return 'navigation';
  const group = /(?:^|\s)shopify-section-group-(\S+)/.exec(cls);
  const skip = (b.height ?? 0) > 200 ? ['announcement'] : [];
  const k = keyIn(cls.replace(/(?:^|\s)shopify-section-group-\S+/g, ' ') + ' ' + (b.elementId || '').toLowerCase(), skip);
  if (k) return k;
  const heading = (b.headline || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  for (const [re, type] of headings) if (re.test(heading)) return type;
  if (group && group[1].includes('header')) return 'header';
  if (group && group[1].includes('footer')) return 'footer';
  return 'unknown';
}

const idLike = (s: string) => isIdKey(s.replace(/-part$/, ''));

/** The type and parent type a block gets under the current rules. Names that came from anything but a key or an ID stay. */
export function retype(b: Stored): { typeHint: string; parentType: string | null } {
  const m = (b.elementId || '').match(/^shopify-section-(?:template--\d+__|sections--\d+__)?(.+)$/);
  const key = m ? m[1] : null;
  const named = key !== null && !isIdKey(key) && !isIdKey(nameFromKey(key)) ? nameFromKey(key) : null;
  let typeHint = b.typeHint;
  // The name was made from the key (a data-section-type, a tag or a class word would differ from it).
  if (key !== null && b.typeHint === oldNameFromKey(key)) typeHint = named ?? fromStoredClues(b, true);
  // An ID from somewhere else: a data-section-type that was an ID, or the piece of a section with an ID key.
  else if (idLike(b.typeHint)) typeHint = named ?? fromStoredClues(b, key !== null);
  if (isEmptyCartBlock(b.pageType, typeHint, b.text)) typeHint = 'empty-cart';
  const parentType = b.parentType !== null && idLike(b.parentType) ? null : b.parentType;
  return { typeHint, parentType };
}

// ---------------------------------------------------------------------------------------------------

type Change = { old: string; neu: string; oldParent: string | null; neuParent: string | null };

function summarise(label: string, all: { hint: string }[], changes: Change[]): void {
  const before = new Map<string, number>();
  for (const r of all) before.set(r.hint, (before.get(r.hint) || 0) + 1);
  const after = new Map(before);
  for (const c of changes) {
    after.set(c.old, (after.get(c.old) || 0) - 1);
    if (after.get(c.old) === 0) after.delete(c.old);
    after.set(c.neu, (after.get(c.neu) || 0) + 1);
  }
  const idCount = (m: Map<string, number>) => [...m].filter(([t]) => idLike(t)).reduce((s, [, n]) => s + n, 0);
  const typeChanges = changes.filter((c) => c.old !== c.neu);
  const fromId = typeChanges.filter((c) => idLike(c.old));
  const named = fromId.filter((c) => c.neu !== 'unknown');
  const emptyCarts = typeChanges.filter((c) => c.neu === 'empty-cart');
  const keyFixes = typeChanges.filter((c) => !idLike(c.old) && c.neu !== 'empty-cart');
  console.log(`\n=== ${label}: ${all.length} blocks, ${typeChanges.length} get a new type, ${changes.filter((c) => c.oldParent !== c.neuParent).length} lose an ID parent type`);
  console.log(`types that are IDs:    ${idCount(before)} -> ${idCount(after)}`);
  console.log(`  of those, named:     ${named.length}  (the rest become "unknown": ${fromId.length - named.length})`);
  console.log(`key names fixed:       ${keyFixes.length}  (image -> image-banner, footer-section -> footer ...)`);
  console.log(`empty carts labelled:  ${emptyCarts.length}`);
  console.log(`"unknown":             ${before.get('unknown') || 0} -> ${after.get('unknown') || 0}`);
  console.log(`distinct types:        ${before.size} -> ${after.size}`);
  const top = (list: Change[], f: (c: Change) => string) => {
    const n = new Map<string, number>();
    for (const c of list) n.set(f(c), (n.get(f(c)) || 0) + 1);
    return [...n].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => `${k} ${v}`).join(', ');
  };
  console.log(`names given to IDs:    ${top(named, (c) => c.neu)}`);
  console.log(`key names fixed (top): ${top(keyFixes, (c) => `${c.old} -> ${c.neu}`)}`);
  console.log(`empty carts, were:     ${top(emptyCarts, (c) => c.old)}`);
}

function manifestsUnder(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('_') || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...manifestsUnder(p));
    else if (e.name === 'manifest.json') out.push(p);
  }
  return out;
}

async function main(): Promise<void> {
  const write = process.argv.includes('--write');
  const at = process.argv.indexOf('--data');
  const dataDir = path.resolve(at > 0 && process.argv[at + 1] ? process.argv[at + 1] : 'data');

  // 1. The manifests on this PC: what a re-import would bring back if only the database were changed.
  const files = manifestsUnder(dataDir);
  const manifestChanges: { file: string; viewport: string; index: number; change: Change }[] = [];
  const manifestAll: { hint: string }[] = [];
  const patched = new Map<string, any>();
  for (const file of files) {
    const manifest = JSON.parse(readFileSync(file, 'utf8'));
    let touched = false;
    for (const b of manifest.blocks || []) {
      manifestAll.push({ hint: b.typeHint });
      const r = retype({ typeHint: b.typeHint, parentType: b.parentType ?? null, elementId: b.id ?? null, classes: b.classes ?? null, headline: b.headline ?? null, tag: b.tag ?? null, height: b.height ?? null, pageType: manifest.page?.type ?? null, text: b.text ?? null });
      if (r.typeHint === b.typeHint && r.parentType === (b.parentType ?? null)) continue;
      manifestChanges.push({ file, viewport: b.viewport, index: b.index, change: { old: b.typeHint, neu: r.typeHint, oldParent: b.parentType ?? null, neuParent: r.parentType } });
      b.typeHint = r.typeHint;
      b.parentType = r.parentType;
      touched = true;
    }
    if (touched) patched.set(file, manifest);
  }
  summarise(`manifests (${files.length} pages under ${dataDir})`, manifestAll, manifestChanges.map((c) => c.change));

  // 2. The database.
  const require = createRequire(new URL('../platform/package.json', import.meta.url));
  const postgres = require('postgres');
  const envLine = readFileSync(new URL('../platform/.env', import.meta.url), 'utf8').split(/\r?\n/).find((l) => /^\s*DATABASE_URL\s*=/.test(l)) || '';
  const sql = postgres(envLine.replace(/^\s*DATABASE_URL\s*=\s*/, '').trim().replace(/^["']|["']$/g, ''), { prepare: false, max: 1 });
  try {
    const rows: any[] = await sql`select b.id, b.type_hint, b.block_type, b.parent_type, b.element_id, b.classes, b.headline, b.tag, b.height, b.text, p.type as page_type
      from blocks b join captures c on c.id = b.capture_id join pages p on p.id = c.page_id`;
    const dbChanges: (Change & { id: string })[] = [];
    for (const row of rows) {
      const r = retype({ typeHint: row.type_hint, parentType: row.parent_type, elementId: row.element_id, classes: row.classes, headline: row.headline, tag: row.tag, height: row.height, pageType: row.page_type, text: row.text });
      if (r.typeHint !== row.type_hint || r.parentType !== row.parent_type) dbChanges.push({ id: row.id, old: row.type_hint, neu: r.typeHint, oldParent: row.parent_type, neuParent: r.parentType });
    }
    // block_type (the AI tagger's answer) wins over type_hint everywhere the app shows a type.
    const tagged = new Set(rows.filter((r) => r.block_type).map((r) => r.id));
    summarise('database (blocks table)', rows.map((r) => ({ hint: r.block_type || r.type_hint })), dbChanges.filter((c) => !tagged.has(c.id)));
    const samples = dbChanges.filter((c) => idLike(c.old)).sort(() => Math.random() - 0.5).slice(0, 12);
    console.log('\nsamples (old -> new):');
    for (const s of samples) console.log(`  ${s.old.slice(0, 44).padEnd(44)} -> ${s.neu}`);

    if (!write) {
      console.log('\nDry run: nothing was changed. Run with --write to update the database and the manifests.');
      return;
    }

    // 3. Save every old value first, then write.
    mkdirSync(path.join(dataDir, '_retype'), { recursive: true });
    const backup = path.join(dataDir, '_retype', `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    writeFileSync(backup, JSON.stringify({
      note: 'Old block types before retype-blocks. db: blocks.id -> old type_hint/parent_type; manifests: file + viewport + index.',
      db: dbChanges.map((c) => ({ id: c.id, type_hint: c.old, parent_type: c.oldParent })),
      manifests: manifestChanges.map((c) => ({ file: path.relative(dataDir, c.file), viewport: c.viewport, index: c.index, typeHint: c.change.old, parentType: c.change.oldParent })),
    }), 'utf8');
    console.log(`\nold values saved to ${backup}`);

    let updated = 0;
    await sql.begin(async (tx: any) => {
      for (let i = 0; i < dbChanges.length; i += 1000) {
        const batch = dbChanges.slice(i, i + 1000).map((c) => [c.id, c.neu, c.neuParent ?? '', c.old]);
        const res = await tx`update blocks set type_hint = v.t, parent_type = nullif(v.p, '')
          from (values ${tx(batch)}) as v(id, t, p, old) where blocks.id = v.id::uuid and blocks.type_hint = v.old`;
        updated += res.count;
      }
    });
    console.log(`database: ${updated} of ${dbChanges.length} blocks updated (a block whose type changed in the meantime is left alone)`);

    for (const [file, manifest] of patched) writeFileSync(file, JSON.stringify(manifest, null, 2), 'utf8');
    console.log(`manifests: ${patched.size} files rewritten (${manifestChanges.length} blocks)`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
