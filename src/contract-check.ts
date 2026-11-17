// Compile-time guard for the capture manifest contract. Nothing here runs:
// `npm run typecheck` fails if what the crawler writes stops matching
// web/src/contracts/manifest.ts, which is what the platform's importer reads.
// Change the contract file first (in a `contract` pull request), then the crawler.
import type { BlockInfo, PageMeta, SiteInfo } from './page-script.js';
import type { CrawlerMoment } from './moments.js';
import type { ManifestBlock, ManifestMoment, ManifestPage, ManifestSite } from '../web/src/contracts/manifest.js';

type CrawlerBlock = BlockInfo & { viewport: 'desktop' | 'mobile'; file: string | null; error?: string; moment?: CrawlerMoment['kind'] };
type CrawlerSite = { host: string; origin: string } & Partial<SiteInfo>;
type CrawlerPage = { url: string; type: string; slug: string; capturedAt: string } & Partial<PageMeta>;

// Each assignment must compile in the direction the data flows: crawler -> contract.
export const _block = (b: CrawlerBlock): ManifestBlock => b;
export const _site = (s: CrawlerSite): ManifestSite => s;
export const _page = (p: CrawlerPage): ManifestPage => p;
export const _moment = (m: CrawlerMoment): ManifestMoment => m;
