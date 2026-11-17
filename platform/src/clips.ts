// Clips (migration 0015): what the importer stores in blocks.clip for a block that moves by itself.
import type { ManifestBlock } from "../../web/src/contracts/manifest.js";

/** A block's clip as the image pipeline uploaded it (images.json `clips`, keyed by the manifest's clip.file). */
export type UploadedClip = { source: string; key: string; bytes: number };

/** blocks.clip: the manifest's clip with the uploaded MP4's public URL. The web API serves it as Block.clip. */
export type StoredClip = {
  kind: string;
  url: string;
  width: number;
  height: number;
  durationMs: number;
  bytes: number;
  rect: { x: number; y: number; width: number; height: number };
};

/**
 * The block's recording, or null when the block has no clip or its MP4 was not uploaded: a block never points at a
 * missing video. `toUrl` turns a storage key into the public URL (the importer's publicSrc).
 */
export function clipOf(block: Pick<ManifestBlock, "clip">, clips: Record<string, UploadedClip>, toUrl: (key: string) => string): StoredClip | null {
  const c = block.clip;
  const uploaded = c?.file ? clips[c.file] : undefined;
  if (!c || !uploaded) return null;
  return { kind: c.kind, url: toUrl(uploaded.key), width: c.width, height: c.height, durationMs: c.durationMs, bytes: c.bytes, rect: c.rect };
}
