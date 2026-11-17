// Compile-time guard for the capture manifest contract. Nothing here runs:
// `npm run typecheck` fails if what the crawler writes stops matching
// web/src/contracts/manifest.ts, which is what the platform's importer reads.
// Change the contract file first (in a `contract` pull request), then the crawler.
import type { BlockInfo, PageMeta, SiteInfo } from './page-script.js';
import type { BlockStyleC, OutlineNodeC, PageStylesC } from './style-script.js';
import type { BlockStyle, ManifestBlock, ManifestPage, ManifestSite, OutlineNode, PageStyles } from '../web/src/contracts/manifest.js';

type CrawlerBlock = BlockInfo & { viewport: 'desktop' | 'mobile'; file: string | null; error?: string; style?: BlockStyleC; outline?: OutlineNodeC[] };
type CrawlerSite = { host: string; origin: string } & Partial<SiteInfo>;
type CrawlerPage = { url: string; type: string; slug: string; capturedAt: string } & Partial<PageMeta>;

// Each assignment must compile in the direction the data flows: crawler -> contract.
export const _block = (b: CrawlerBlock): ManifestBlock => b;
export const _site = (s: CrawlerSite): ManifestSite => s;
export const _page = (p: CrawlerPage): ManifestPage => p;
// Design metadata (SEC-31): what style-script.ts measures must fit the contract.
export const _pageStyles = (p: PageStylesC): PageStyles => p;
export const _blockStyle = (s: BlockStyleC): BlockStyle => s;
export const _outline = (o: OutlineNodeC): OutlineNode => o;
